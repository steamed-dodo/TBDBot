# Framework Design

Status: **draft, for discussion.** Codename and final package name TBD.

This document replaces the earlier `docs/adapter-plan.md`, which proposed a
`DiscordAdapter` interface with parallel `discord.js` and `@discordjs/core`
implementations. That plan is scrapped. See [Background](#background) for why,
and [Decisions](#decisions) for the list of settled choices.

---

## Background

The starting point was a small utility library, `@my-lib/utils@0.1.1`, containing
three primitives built on `discord.js@^14`:

- **`Menu`** — paginated message menus with several navigation styles.
- **`Wizard`** — session-only, choice-driven flows that record answers.
- **`Panel`** — persistent messages that survive bot restarts, routed by
  message ID.

The original plan was to keep those public APIs stable while migrating the
internals to `@discordjs/core` behind an internal adapter, on the theory that a
future adapter layer would let the package support both backends.

That plan did not survive scrutiny, for three reasons:

1. **The public API was already saturated with `discord.js` types.**
   `MenuPage.embed` is an `EmbedBuilder`; `PanelContent.embeds` is
   `EmbedBuilder[]`; `PanelManager` takes a `Client`; `Panel.message` is a
   `Message`; access filters receive a `MessageComponentInteraction`. None of
   these exist in `@discordjs/core`. An adapter with "opaque handles" could not
   be introduced without rewriting every consumer's code, which contradicts
   "public APIs stay unchanged".

2. **Two backends were never actually wanted.** The goal is a framework for
   building bots, not a library that runs on two Discord clients. Supporting
   both would roughly double the surface area of every module for no
   practical benefit.

3. **The adapter would have been the wrong seam anyway.** The genuinely hard
   part of the port is not "call REST instead of discord.js" — it is
   *interaction routing*, because `@discordjs/core` has no component
   collectors. That problem needs solving regardless of backend, and it is
   better solved once, directly.

The user is the only consumer of this package, the repository is private, and
the package has never been published. The public API is therefore explicitly
**allowed to break**. That removes the main constraint the old plan was
negotiating around, and it means the framework can be designed around the
target architecture rather than around compatibility with a previous shape.

---

## Goals

- A **complete framework** for building Discord bots: client lifecycle, typed
  events, commands, middleware, configuration, caching, persistence, metrics,
  and interactive UI primitives.
- Built on **`@discordjs/core`** for control and a smaller runtime memory
  footprint.
- **No implicit cache.** Memory is spent only when the user asks for it.
- **Testable without a network.** Every layer that touches Discord is
  exercised through raw payloads and an injectable transport.
- **Publishable later.** The public surface should be coherent enough to
  release, even though the initial name and scope are still placeholders.

## Non-goals

- Voice support. `@discordjs/core` provides `updateVoiceState`, but a full
  voice stack is a separate project and is out of scope for now.
- Multi-provider abstraction. This is a Discord framework, not a generic
  bot framework. Do not design for Slack or Telegram.
- Backwards compatibility with `@my-lib/utils@0.1.x`. The API may break freely.

---

## Verified facts about `@discordjs/core`

These were confirmed against the published packages, not documentation prose.
They constrain the design and several of them invalidate assumptions from the
old plan.

### Versions

| Package | Version | Notes |
|---|---|---|
| `@discordjs/core` | `2.7.0` | Latest **stable**. `3.0.0-dev.*` prereleases exist but are not usable as a dependency. |
| `@discordjs/builders` | `1.15.0` | Separate package. `discord.js@14.28.0` depends on the same `^1.15.0`. |
| `@discordjs/rest` | `2.6.3` | |
| `@discordjs/ws` | `2.0.4` | Note: `discord.js@14` uses `ws@^1.2.3`. Core is on `ws@2`. |
| `discord-api-types` | `^0.38.50` | |

The v2 → v3 export surface of `@discordjs/core` was diffed and is currently
**identical** (zero differences in exported names). `discord.js@15` is also
dev-only and tracks the same `3.0.0-dev` generation of `rest`/`ws`/`util`.
Targeting core v2 stable is therefore low-risk; the API is not churning
underneath us.

### Dependency shape

`@discordjs/core@2.7.0` depends on `@discordjs/ws`, `@discordjs/rest`,
`@discordjs/util`, `discord-api-types`, `@sapphire/snowflake`, and
`@vladfrangu/async_event_emitter`. It does **not** depend on
`@discordjs/builders`.

`@discordjs/builders` is independently publishable and provides `EmbedBuilder`,
`ActionRowBuilder`, `ButtonBuilder`, `StringSelectMenuBuilder`,
`SlashCommandBuilder`, `ModalBuilder`, `TextInputBuilder`, and the rest. Its
own dependency tree is small (`tslib`, `ts-mixer`, `@discordjs/util`,
`fast-deep-equal`, `discord-api-types`, `@sapphire/shapeshift`,
`@discordjs/formatters`).

**Decision:** depend on `@discordjs/core` + `@discordjs/builders` +
`discord-api-types` directly. Do not depend on `discord.js` at all. The
builders are the same classes `discord.js` re-exports, so there is no
behavioural difference — only a much smaller dependency tree.

### No cache

`@discordjs/core` has **no cache manager, no sweepers, and no `Collection`**.
`discord.js` maintains guild, channel, user, member, presence, and message
caches with default sweeper intervals of 3600 seconds.

This is the source of the memory-footprint win, and it is a *runtime heap*
win, not an install-size one. Measured install sizes are nearly identical:

| Dependency set | Runtime deps |
|---|---|
| `discord.js@14.28.0` | ~14.9 MB |
| `@discordjs/core` + `@discordjs/builders` | ~14.6 MB |

`discord-api-types` (3.3 MB) and `undici` dominate both. The real saving is
that a long-running bot no longer accumulates a guild/member graph. The
framework must therefore also provide an **opt-in** cache for the cases where
REST-per-lookup is untenable — see [Caching](#caching).

### No collectors

`@discordjs/core` has no `createMessageComponentCollector`. This is the
single biggest piece of work in the port, and the reason the UI layer is
redesigned rather than transliterated. See [Interactive UI](#interactive-ui).

### Client shape

`core`'s `Client` is thin:

```ts
new Client({ rest, gateway })   // -> { rest, gateway, api }
```

There is **no `login()` method** and **no `destroy()` method**. The gateway is
a `WebSocketManager` from `@discordjs/ws@2`, which has `connect()`,
`destroy()`, `setToken()`, and `getShardCount()`. The framework owns token
handling and the connect/destroy lifecycle.

`client.api` is a facade over REST with per-domain sub-APIs:
`api.channels`, `api.interactions`, `api.guilds`, `api.webhooks`,
`api.applicationCommands`, `api.users`, and so on.

### Events

Core emits **raw gateway dispatch events**, keyed by `GatewayDispatchEvents`:

```ts
client.on(GatewayDispatchEvents.InteractionCreate, ({ data, api, shardId }) => { ... })
```

`data` is the raw payload (`GatewayInteractionCreateDispatchData`), not a rich
`Interaction` object. There is no `interactionCreate`, no `clientReady`, no
`messageCreate`. The framework must supply friendly, typed events on top.

The event payload includes `api` (the REST facade) and `shardId`. Note that in
`core@2.7.0` the `api` instance is shared across shards — it is not
shard-scoped — so shard-aware REST routing is not something core provides.

### Interaction responses

`api.interactions` exposes:

| Method | Endpoint |
|---|---|
| `reply(id, token, body)` | `POST /interactions/{id}/{token}/callback` |
| `defer(id, token, body?)` | as above, deferred variant |
| `deferMessageUpdate(id, token, body?)` | as above, deferred update variant |
| `updateMessage(id, token, body)` | component update response (type 7) |
| `followUp(appId, token, body)` | `POST /webhooks/{app_id}/{token}` |
| `editReply(appId, token, body, messageId?)` | `PATCH /webhooks/{app_id}/{token}/messages/{id}` |
| `getOriginalReply(appId, token)` | `GET /webhooks/{app_id}/{token}/messages/@original` |
| `deleteReply(appId, token, messageId?)` | `DELETE /webhooks/{app_id}/{token}/messages/{id}` |
| `createModal(id, token, body)` | modal response (type 9) |
| `createAutocompleteResponse(id, token, body)` | autocomplete response (type 8) |

Two consequences:

- **`applicationId` is required** for the webhook-based operations
  (`followUp`, `editReply`, `getOriginalReply`, `deleteReply`). It is
  available from the Ready dispatch: `data.application.id`.
- **Ephemeral responses must be edited through the webhook path.** An
  ephemeral message is not addressable by channel + message ID, so
  `api.channels.editMessage` cannot reach it. The existing
  `createWebhookController` / `createMessageController` split in `Menu.ts` maps
  directly onto this and should be preserved in the new design.

Interaction tokens are valid for 15 minutes, and an initial response must be
sent within 3 seconds of the interaction or the token is invalidated.

### Permissions

`PermissionsBitField` exists **only inside `discord.js`**
(`discord.js/src/util/PermissionsBitField.js`). It is not in
`discord-api-types`, not in `@discordjs/builders`, and not in core.
`discord-api-types` exports `PermissionFlagsBits` as a plain constant object
and a `Permissions` type.

Additionally, **Discord's v10 API returns permission bitfields as
strings**, not numbers:

```json
{ "permissions": "2248473465835073" }
```

This applies to `APIRole.permissions`, `APIGuildMember.permissions`,
`interaction.member.permissions`, and `interaction.app_permissions`. Any
permission arithmetic in the framework must parse these strings, and
64-bit permission values exceed `Number.MAX_SAFE_INTEGER`, so they must be
handled as `bigint`.

The framework needs its own permission helpers. This is a known, bounded piece
of work: a `bigint`-backed bitfield with `has`/`add`/`remove`, plus resolution
of guild role + channel overwrites + member roles.

### Component constraints

- `custom_id`: 1–100 characters, unique per message.
- Message: up to 5 action rows; each row up to 5 buttons, or 1 select.
- Up to 10 embeds per message.
- Components V2 (`IS_COMPONENTS_V2`, flag `1 << 15`) allows 40 total
  components and replaces `content`/`embeds` with `TextDisplay` /
  `Container` / `Section` builders. `discord-api-types@0.38.57` and
  `@discordjs/builders@1.15.0` both include the V2 builders.

### Rate limits

- Global ceiling: **50 requests/second per bot**.
- Interaction endpoints are **not** bound to the global limit.
- Per-route limits vary; the framework must parse `X-RateLimit-*` headers
  rather than hard-code limits. `@discordjs/rest` already does this.

---

## Architecture

```
src/
  core/          Client lifecycle, gateway wiring, typed event router
  api/           Thin, typed helpers over core's REST facade
  interaction/   Interaction payload helpers (reply/defer/edit/modal)
  ui/            Widget engine, router, renderers, custom-id minting
    menu/        Menu, Wizard (built on the widget engine)
    panel/       Panel (persistent widget)
  commands/      Command definitions, registration, middleware, permissions
  config/        Schema-based, environment-aware configuration
  cache/         Opt-in cache with pluggable stores
  store/         Persistence backends (memory, JSON file, Redis)
  metrics/       Counters, gauges, histograms, Prometheus exposition
  testing/       Mock client, interaction factories, payload builders
```

Single package. The public API is re-exported from `src/index.ts`, with
subpath exports for the larger modules if the surface grows.

---

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Build on `@discordjs/core` + `@discordjs/builders`, drop `discord.js` | Control and runtime memory; builders give identical DX without the client |
| 2 | Public API may break freely | Private, unpublished, single consumer |
| 3 | No dual-backend adapter layer | One backend; the hard problem (routing) is backend-independent |
| 4 | Single package | Simplest imports, one build, one `dist` |
| 5 | Package name stays `@my-lib/utils` for now | Rename when going public; codename TBD |
| 6 | Menu and Wizard unify behind one step model | Wizard is a Menu with branching and answer capture |
| 7 | Menus become dynamic (`render()` instead of static `embed`) | Needed for live/derived content; enables the unified step model |
| 8 | One exported class for Menu/Wizard; factory added later if it hurts | Class now, factory if ergonomics demand it |
| 9 | Routing by `custom_id`, framework-owned namespaced IDs | Works for ephemeral and persistent flows alike; enables persistent menus |
| 10 | UI is a widget engine: state + render + action handlers | State changes come from anywhere, not just collectors |
| 11 | Panels become a separate module built on the widget engine | Shares rendering and routing; differs in lifetime |
| 12 | Cache is opt-in, pluggable stores | Core has no cache; the win only survives if caching is deliberate |
| 13 | Metrics hand-rolled in Prometheus text format | No dependency; exact control over label sets |
| 14 | Metrics server is opt-in; framework exposes a mountable handler | The framework should not own a port by default |
| 15 | Interaction layer exposes raw payloads plus helper methods | Testability without reimplementing discord.js |
| 16 | Config is schema-based and environment-aware | Replaces ad-hoc `process.exit(1)` validation |
| 17 | Widget routing id is a separate short framework-generated id | Keeps the 100-char `custom_id` budget usable; separates routing identity from the public panel id |
| 18 | Action payloads are hybrid: reserved prefix for built-in navigation, raw string for user actions | Framework internals stay private without constraining the user's vocabulary |
| 19 | Cold-start interactions are queued, deferred, and bounded | Preserves the persistent-widget guarantee without an unbounded memory risk |

---

## Module designs

### Core client

Owns `REST`, `WebSocketManager`, and core's `Client`. Responsibilities:

- Token handling, `connect()` / `destroy()` lifecycle.
- Translation of raw gateway dispatches into friendly typed events.
- Shutdown ordering: stop accepting interactions → flush metrics → destroy
  gateway → destroy HTTP server. Must complete within the K8s grace period.
- Reconnect and resume behaviour delegated to `@discordjs/ws`.

### Event router

Translates `GatewayDispatchEvents.*` into typed, named events:

```ts
client.on('interactionCreate', (interaction) => { ... });
client.on('messageCreate', (message) => { ... });
client.on('ready', (info) => { ... });
```

Each event carries the raw payload plus a small typed accessor layer. The
router is where per-guild/per-channel event filters belong, so that handlers
are not all woken for every event.

### Interaction helpers

Raw payload plus helpers, per decision 15. A `MessageComponentInteraction`
in the framework is:

```ts
{
    raw: APIInteraction,          // the payload Discord sent
    id, token, applicationId,
    guildId, channelId, userId,
    componentType, customId, values,
    member?, user?,
    reply(...), defer(...), deferUpdate(...), editReply(...), followUp(...),
}
```

No class hierarchy, no cache, no `guild.channels.cache.get(...)`. Payloads are
plain data and stay plain data.

### Interactive UI

The central new idea. Two layers:

**The widget** — a unit of state plus how to display it:

```ts
interface Widget<S> {
    readonly id: string;
    readonly state: S;
    render(): RenderedContent | Promise<RenderedContent>;
    onAction?(action: string, ctx: ActionContext): void | Promise<void>;
}
```

`RenderedContent` is `{ content?, embeds?, components? }`.

**The router** — resolves an incoming `custom_id` to a widget and an action,
then hands control to the widget.

```
                    ┌───────────────────────────┐
  interaction ─────▶│  router                    │
  (custom_id)       │  custom_id → widget + action│
                    └─────────────┬─────────────┘
                                  │ mutate state
                                  ▼
   state ──▶ render() ──▶ { content, embeds, components } ──▶ message
      ▲                                        │
      └──────────── update() ◀──── any code path ─┘
```

The important property is that `update()` can be called from **anywhere** — a
component interaction, a timer, a Redis pub/sub message, a queue worker,
another bot instance. Collectors scoped state to "one message, while the
process lives". The widget model does not: it separates *what is displayed*
from *what caused a change*.

Lifetimes differ, the engine does not:

| Lifetime | Survives restart | Timeout | State source |
|---|---|---|---|
| Session | No | Yes | In memory |
| Persistent | Yes | No | Store-backed, restored at boot |

A persistent **menu** — a paginated menu that survives a restart — falls out
of this for free, and is not something the current library can do.

#### Custom ID scheme

Framework-owned, namespaced, and documented.

```
<namespace>:<widgetId>:<action>
```

- `namespace` — reserved prefixes owned by the framework, e.g. `ui`. User
  components must not use them; the framework validates and throws on
  collision (as `Menu.ts` already does for `menu:navigation`).
- `widgetId` — stable identity of the widget instance. For persistent widgets
  this must be stable across restarts, since it is what routes an incoming
  interaction back to the right widget after a cold start.
- `action` — passed to `onAction`. See [Action payloads](#action-payloads).

Total length must fit in 100 characters. The framework should provide a helper
that truncates or rejects over-long actions rather than letting Discord reject
the message.

**Consequence, stated plainly:** custom IDs on framework-rendered components
are framework-owned strings. User-supplied components are namespaced by the
framework, so a user cannot set an arbitrary `custom_id` and expect it to
survive routing. This must be documented clearly, and the API should make
the correct thing easy — for example a `button('confirm')` helper rather than
raw `ButtonBuilder` usage.

#### Widget identity

**Resolved:** the widget's routing identity is a separate, short, framework-
generated id, stored alongside the widget's own identity.

This is a deliberate departure from reusing the panel's id. The panel id is
already a snowflake or UUID and is part of the public API and the persisted
record; the routing id is an implementation detail of the custom-id scheme
and should be optimised for a different constraint.

The reasons for a separate id:

- **Length budget.** A UUID is 36 characters; a snowflake is 19. The routing
  id needs to be short because it shares a 100-character field with the
  namespace and the action. A short base-36 or base-62 id (say 10-12
  characters) leaves the majority of the budget for user-defined actions.
- **Separation of concerns.** The routing id has one job: resolve an incoming
  interaction to a widget instance. The panel id has another: identify a
  persisted panel to a human reading the store, and to the panel's own
  factory. Coupling them means every change to either is a breaking change to
  the other.
- **Avoiding collisions.** Session-scoped widgets also need routing ids, and
  they have no user-facing id at all. A single scheme covering both lifetimes
  is simpler than two.

The routing id is generated once, at widget creation, persisted with the
widget's record for persistent widgets, and reused unchanged across restarts.
It is opaque to users but exposed on the widget for debugging.

#### Action payloads

**Resolved:** hybrid. Framework-parsed structured actions for built-in
navigation, raw string for everything the user defines.

The framework needs to emit and recognise its own actions — `next`,
`previous`, `back`, `select` — and it must do so without colliding with
user-defined actions. But the framework cannot anticipate every action a user
might want, so it must not constrain the action vocabulary.

The scheme:

```
<namespace>:<widgetId>:<action>
```

- The **action** segment is split by the framework into a reserved part and a
  user part.
- The framework reserves a leading segment for built-in navigation. Actions
  beginning with the reserved marker are interpreted by the framework and
  never reach `onAction`.
- All other actions are passed to `onAction` as the raw string, exactly as
  the user defined them.

Concretely, the router exposes to `onAction`:

```ts
onAction(action: string, ctx: ActionContext): void | Promise<void>;
```

where `action` is the user's action string with the reserved prefix already
stripped, and `ctx.raw` carries the untouched original `custom_id` for
anyone who needs it.

The rationale for the hybrid: a purely structured scheme would force users
into a fixed vocabulary or into inventing an encoding, and a purely raw scheme
would make the framework's own navigation indistinguishable from user
actions, forcing every widget to hand-parse its own `custom_id` and
reimplement prefix matching. The hybrid keeps the framework's internals
private and leaves the user's namespace theirs.

The reserved prefix should be a character that cannot appear in a
user-defined action under the framework's own rules, so the split is
unambiguous and cannot be spoofed.

#### Cold-start routing

**Resolved:** queue the interaction.

When an interaction arrives for a widget that is not yet in memory — because
restoration is still running after a process start — the router queues it
rather than dropping it, and drains the queue as each widget is restored.

Details that matter:

- **The queue is per widget id**, so a restored widget drains only its own
  queued interactions.
- **Queued interactions still need acknowledging within 3 seconds.** The
  interaction token is invalidated if the initial response is not sent in
  time. So on queueing, the router must immediately `defer()` the
  interaction, then process it once the widget is available. Deferring is
  also the right UX: the user sees the loading state rather than an error.
- **The queue is bounded.** An unbounded queue is a memory leak and a
  potential denial-of-service vector against a bot that is being spammed
  during a cold start. The queue should have a per-widget limit and an
  overall limit, and drop the oldest entries when full.
- **Queued interactions expire.** Interaction tokens are valid for 15
  minutes. A queued interaction older than that can no longer be responded
  to, so it should be discarded rather than replayed.
- **Restoration failure must drain the queue.** If the widget never
  restores — its record is gone, or its factory throws — the queued
  interactions must be failed rather than left pending forever.

Dropping the interaction outright would be simpler but would silently break
the "persistent menu survives a restart" property that motivates persistent
widgets in the first place.

#### Rendering pipeline

1. Widget renders to `RenderedContent`.
2. Framework converts to Discord message options (`EmbedBuilder` →
   `APIEmbed`, components → API rows).
3. Framework applies the accessibility and safety defaults: `allowed_mentions`
   (default: suppress `everyone`/`roles`/`users` unless opted in),
   `flags`, `tts`.
4. Framework sends or edits the message.

Editing a widget's message is a `PATCH` on the channel message, or on the
interaction webhook for ephemeral responses. The distinction must be tracked
per widget, because ephemeral messages are not addressable by channel + ID.

### Menu and Wizard

One step model for both:

```ts
interface Step {
    id: string;
    render(ctx: StepContext): StepContent | Promise<StepContent>;
    next?: string | null;          // branching; absent = linear
    choices?: Choice[];            // auto-rendered buttons or select
    onAction?(action, ctx): void;  // custom components
}
```

- **Menu** — linear steps, previous/next/select chrome.
- **Wizard** — branching steps, answer capture keyed by step ID, back clears
  abandoned answers.

Both become configurations of one exported class, per decision 8. The `Step`
type differs only in which optional members are populated.

### Panel

A panel is a persistent widget. Its module owns:

- The store interface and implementations (memory, JSON file, Redis).
- A registry mapping panel type → factory, for restoration.
- Boot-time restoration: load records, rebuild widgets, re-bind messages.
- Serialization of widget state.

The current `PanelManager` already does most of this. The refactor is to
express it in terms of the widget engine so that panels and menus share
rendering, routing, and custom-id handling.

Two panel-specific consequences of the shared engine:

- The persisted record must carry the widget's **routing id** in addition to
  the panel's own id, so that restoration can re-register the correct custom
  ids. See [Widget identity](#widget-identity).
- Restoration is a long-running operation at boot, and interactions for
  persistent widgets can arrive before it finishes. The router's queue
  behaviour in [Cold-start routing](#cold-start-routing) covers this.

### Commands and middleware

Command definitions carry a `SlashCommandBuilder` (or raw command JSON),
an execute handler, and declarative metadata: required permissions, cooldown,
guild-only, owner-only, and so on.

Middleware is a pipeline around command execution:

```ts
type Middleware = (ctx: CommandContext, next: () => Promise<void>) => Promise<void>;
```

Middleware is how permissions, cooldowns, logging, and error handling are
composed. This is the highest-value piece for real bots — it is what replaces
the hand-rolled per-command `if` ladders.

Registration should support both global and per-guild commands, with a
dev/prod distinction, since guild-scoped registration propagates faster.

### Config

Schema-based, environment-aware, and validated once at startup. Fail loudly
at boot rather than at first use. This replaces the `process.exit(1)` pattern
in the current testbot config with something reusable, and it should support:

- Required vs. optional values, with defaults.
- Type coercion and bounds.
- Secrets that are redacted when the config is logged or exported.
- Multiple sources (environment, file) with an explicit precedence.

### Caching

Opt-in, with pluggable stores. The framework provides the cache *interface*
and a memory implementation; a Redis implementation is a natural extension and
the user's other bots already run Redis.

The cache should be bounded and explicit about what it holds. The point of
moving to core is that memory is spent deliberately. A cache that silently
accumulates guild members would undo the entire benefit.

### Stores

A general `Store` interface (`get`, `set`, `delete`, `keys`) with memory, JSON
file, and Redis implementations. Panel persistence is one consumer; command
cooldowns and other framework state are others.

### Metrics

Hand-rolled Prometheus text exposition, per decision 13.

```ts
bot_interactions_total{type="messageComponent"} 42
bot_commands_total{name="ping",outcome="success"} 3
bot_command_duration_seconds_bucket{name="ping",le="0.1"} 2
bot_errors_total{source="ui"} 0
bot_rest_requests_total{route="channels.createMessage",status="200"} 120
bot_rest_rate_limited_total 0
bot_gateway_latency_seconds 0.043
bot_gateway_reconnects_total 0
bot_heap_used_bytes 4.2e7
bot_event_loop_lag_seconds 0.002
bot_uptime_seconds 3600
```

Label sets must be bounded — no user IDs, no guild IDs as labels. That is a
hard rule, not a preference: unbounded label cardinality will take down the
Prometheus server.

**HTTP server, per decision 14:** the framework exposes
`metrics.handler()` returning a plain Node `(req, res)` listener that the
user can mount on any existing server, and `metrics.serve({ port })` as a
convenience for the simple case. Neither starts automatically. The framework
should not own a port unless asked to, because in K8s the bot container and
the metrics scraper are often separate concerns.

### Testing

Because interactions are raw payloads and the REST transport is injectable,
the whole framework is testable without a network:

- A mock client that records REST calls and returns canned payloads.
- Interaction factories that build valid `APIInteraction` payloads for each
  interaction type.
- Payload builders for messages, guilds, members, and roles.

This is a direct dividend of decision 15 and of doing the routing work
ourselves. It is also why the widget engine must be careful to keep its
inputs as plain data.

---

## Roadmap

Ordered by dependency and by risk. The widget engine is deliberately early:
it is the piece most likely to be wrong, and everything else builds on it.

1. **Foundation** — package scaffolding on core, `core` client wrapper, typed
   event router, REST helpers, interaction helpers.
2. **Widget engine** — widget interface, router, routing-id generation,
   custom-id minting and parsing, action splitting, rendering pipeline,
   message editing for both channel and ephemeral targets, cold-start queue.
   Full test coverage.
3. **Menu / Wizard** — rebuilt on the widget engine, with the dynamic step
   model.
4. **Panel** — persistent widgets, store interface and implementations,
   registry, restoration.
5. **Commands + middleware** — definitions, registration, permission and
   cooldown middleware, error handling.
6. **Config** — schema, loading, validation, redaction.
7. **Cache** — interface, memory implementation, policy helpers.
8. **Metrics** — registry, Prometheus exposition, handler and optional server.
9. **Stores** — Redis implementation, command-cooldown store.
10. **Testing utilities** — mock client, payload factories, exported for
    consumers.

Steps 6, 7, and 8 are independent of the others and can land in any order.

---

## Open questions

Questions 1–3 were resolved during design and are now settled in
[Decisions](#decisions) and the corresponding sections above. The remainder
are still open and worth settling before the relevant module is built.

1. **Permission resolution and caching interaction.** Resolving effective
   permissions needs guild roles, member roles, and channel overwrites — up
   to three REST calls. How aggressively should the cache hold these, and who
   invalidates on role updates? A `GUILD_MEMBER_UPDATE` /
   `GUILD_ROLES_UPDATE` driven invalidation hook seems necessary.

2. **Command argument parsing.** Should the framework parse and type command
   options into a typed object, or pass the raw option array through and let
   the user parse? Typed parsing is much nicer but requires a schema
   convention, and Discord's option model is awkward for subcommand trees.

3. **Component V2 support.** `discord-api-types@0.38.57` and
   `@discordjs/builders@1.15.0` include the V2 builders (`Container`,
   `Section`, `TextDisplay`, `MediaGallery`). Should the widget rendering
   pipeline support V2 output from the start, or only legacy embeds and
   action rows initially?

4. **Modals in scope?** Modals are a distinct interaction type with their own
   routing and a `ModalSubmit` payload. They are not mentioned in the
   current library, but they are common in real bots. Include them in the
   widget model now, or defer?

5. **File attachments.** `core` supports `withFiles` for interactions and
   `files` on channel messages. Does the framework expose an attachment
   helper, and does the widget rendering pipeline support them?

6. **Name and scope.** `@my-lib/utils` is a placeholder. The final name
   should reflect that this is a bot framework rather than a utility
   collection.

7. **Subpath exports.** If the package grows, should `ui`, `commands`, and
   `metrics` be separately importable (`@my-lib/x/ui`) to keep bundle size
   down for consumers who only want part of it?
