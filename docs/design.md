# Framework Design

Status: **implemented.** Codename: **TBDBot** (a pun on the name
being TBD). The package is renamed from `@my-lib/utils` to
`.../framework` when it is ready to be published; `tbd-bot` and `tbdframework`
are both available on npm.

This document replaces the earlier `docs/adapter-plan.md`, which proposed a
`DiscordAdapter` interface with parallel `discord.js` and `@discordjs/core`
implementations. That plan is scrapped. See [Background](#background) for why,
and [Decisions](#decisions) for the list of settled choices.

**Known gaps in this document are tracked in
[`fixes.md`](./fixes.md).** Read that alongside this one — in particular
[F1 (ephemeral edit window)](./fixes.md#f1-ephemeral-messages-have-a-15-minute-edit-window),
which is a correctness constraint, and
[F3 (widget state ownership)](./fixes.md#f3-widget-state-ownership-is-contradictory),
which is an ambiguity in the core model.

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

## Invariants

These hold everywhere in the framework. Violating one is a bug that is
usually silent, so they are worth internalising before writing any code.

1. **Permission values are strings.** Discord v10 returns permission
   bitfields as decimal strings, and 64-bit values exceed
   `Number.MAX_SAFE_INTEGER`. Parse with `BigInt()`. Never use `Number`.
   → [Permissions](#permissions)

2. **Ephemeral messages are edited via the webhook path.** They are not
   addressable by channel + message ID. Use
   `api.interactions.editReply(appId, token, …)`, never
   `api.channels.editMessage`.
   → [Interaction responses](#interaction-responses)

3. **An interaction must be acknowledged within 3 seconds.** Defer or reply
   immediately and do all slow work afterwards.
   → [Interaction responses](#interaction-responses)

4. **Interaction tokens expire after 15 minutes.** An ephemeral message
   cannot be edited beyond that point. This bounds the widget engine's
   "update from anywhere" promise — see
   [F1](./fixes.md#f1-ephemeral-messages-have-a-15-minute-edit-window).

5. **`custom_id` is at most 100 characters.** The framework generates these,
   so it must reject or truncate rather than let Discord reject the message.
   → [Custom ID scheme](#custom-id-scheme)

6. **`allowed_mentions` defaults to suppressing `everyone`, `roles`, and
   `users`.** Rendering user-supplied content without opting in is a ping
   bug.
   → [Rendering pipeline](#rendering-pipeline)

7. **The bot's global rate limit is 50 requests/second.** Interaction
   endpoints are exempt from it. Long-running work must not sit in the
   interaction path.
   → [Rate limits](#rate-limits)

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
  permissions/   bigint-backed bitfield and permission resolution
  ui/            Widget engine, router, renderers, custom-id minting
    menu/        Menu, Wizard (built on the widget engine)
    panel/       Panel (persistent widget)
    modal/       Modal widgets
  commands/      Command definitions, registration, middleware, option parsing
  config/        Schema-based, environment-aware configuration
  cache/         Two-tier cache with pluggable stores
  store/         Persistence backends (memory, JSON file, Redis)
  metrics/       Counters, gauges, histograms, Prometheus exposition
  testing/       Mock client, interaction factories, payload builders
```

Single package with one entry point, per decisions 4 and 26. The public API
is re-exported from `src/index.ts`. Subpath exports (`.../ui`,
`.../commands`, `.../metrics`) can be added later without breaking the main
export, so there is no need to design for them now.

`permissions/` is a separate module because it is self-contained and has a
hard requirement — the `bigint`-backed bitfield — that other modules depend
on. It is the kind of thing that benefits from being written and tested in
isolation.

---

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Build on `@discordjs/core` + `@discordjs/builders`, drop `discord.js` | Control and runtime memory; builders give identical DX without the client |
| 2 | Public API may break freely | Private, unpublished, single consumer |
| 3 | No dual-backend adapter layer | One backend; the hard problem (routing) is backend-independent |
| 4 | Single package | Simplest imports, one build, one `dist` |
| 5 | Package stays `@my-lib/utils` for now, becomes `.../framework` on publish | Codename `TBDBot`; `tbd-bot` and `tbdframework` are free on npm |
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
| 20 | Two cache tiers: minimal on by default, inclusive opt-in | Permission checks need role and overwrite lookups; everything else is a deliberate cost |
| 21 | Cache invalidation driven by the event router | Permission inputs each have a corresponding gateway event |
| 22 | Command option schema derived from the builder; typed resolver provided | The builder retains the full declaration, so no parallel schema is needed |
| 23 | Components V1 only for now; V2 deferred | V2 changes the message contract; both shapes in one renderer is premature |
| 24 | Modals are in scope, as widgets | Same routing machinery, different render target |
| 25 | File attachments deferred | Capability exists in core; not worth carrying until the API settles |
| 26 | Single package with one entry point for now | Subpath exports can be added without breaking the main export |
| 27 | Package becomes `.../framework`; codename `TBDBot` | "utils" undersells the scope; the codename is a placeholder until publishing |
| 28 | Inclusive cache tier uses `discord.js`'s own defaults | A user opting into the extra memory may reasonably expect parity; the defaults are read from discord.js's source |
| 29 | Command arguments are runtime-validated plain objects; builder stays the source of truth | The builder's type does not accumulate options, so full compile-time inference is impossible without a parallel schema |

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

**Components V1 only, for now.** The rendering pipeline targets legacy
messages: `content`, up to 10 `embeds`, and up to 5 action rows of buttons
and selects. Components V2 (`IS_COMPONENTS_V2`, flag `1 << 15`) allows 40
total components and replaces `content`/`embeds` with `TextDisplay`,
`Container`, `Section`, and `MediaGallery` builders.

V2 is explicitly deferred. The builders are available in
`discord-api-types@0.38.57` and `@discordjs/builders@1.15.0`, so adding
support later is a matter of widening the renderer's output type and the
message flags — not a redesign. The reason to defer is that V2 changes the
message contract (no `content`, no `embeds`), and supporting both shapes
simultaneously in one renderer is more complexity than it is worth before the
API has stabilised. Deferring also keeps the widget output type simple
during the period when it is most likely to change.

**File attachments are deferred** for the same reason. `@discordjs/core`
supports attachments on both channel messages (`files`) and interaction
responses (`withFiles`), so the capability is there when it is needed, but
the rendering pipeline will not carry attachment state until the API is
stable.

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

#### Option parsing

The framework **does** derive an option schema from the command builder, and
**also** exposes a discord.js-style typed accessor. Both are possible because
the builder retains enough structure to reconstruct the schema.

`SlashCommandBuilder` and `SharedSlashCommand` expose a readonly `options`
array of `ToAPIApplicationCommandOptions[]`, which carries the full
declaration: `type`, `name`, `description`, `required`, `choices`,
`min_value` / `max_value`, `min_length` / `max_length`, `channel_types`, and
`autocomplete`. This is the same shape that is sent to Discord when the
command is registered, so the schema can be derived from it without the
framework maintaining a parallel description of the command.

The design has two layers:

**A derived schema**, built once at registration time and stored on the
command definition. It describes each option's type, whether it is required,
its bounds, and its choices.

**A runtime resolver**, modelled on `discord.js`'s
`CommandInteractionOptionResolver`, which provides:

```ts
options.getString('name', required?)
options.getInteger('name', required?)
options.getNumber('name', required?)
options.getBoolean('name', required?)
options.getUser('name', required?)
options.getMember('name')
options.getRole('name', required?)
options.getChannel('name', required?, channelTypes?)
options.getMentionable('name', required?)
options.getAttachment('name', required?)
options.getSubcommand(required?)
options.getSubcommandGroup(required?)
options.getFocused(getFull?)
```

Each accessor checks the option's runtime type against the expected type and
throws on a mismatch, and throws when `required` is set and the option is
absent. This mirrors discord.js's behaviour, which is familiar and does the
right thing.

Two details worth carrying over from discord.js's implementation:

- **Subcommand hoisting.** The raw options array nests subcommand and
  subcommand-group options. The resolver must hoist through them so that
  `getString` looks in the leaf option list, and expose `getSubcommand()` and
  `getSubcommandGroup()` separately.
- **Resolved entities.** `options.getUser()` and friends return the
  *resolved* entities from `interaction.data.resolved`, not just IDs. The
  resolver should expose `resolved` directly for the cases the typed
  accessors do not cover.

The resolver is created per interaction and is cheap: it holds the raw
options array and does linear lookups by name. No schema lookup is needed at
runtime for the accessors themselves — the type check is against the runtime
option's own `type` field, which is what makes the mismatch check meaningful.

**Where the derived schema earns its keep.** The accessors work from runtime
data alone, but the schema enables things the accessors cannot do:

- **Validation before Discord sees it.** Required-ness, bounds, and choice
  membership can be checked at registration time, so a malformed command
  fails at boot rather than when a user invokes it.
- **Typed command arguments.** A command can declare a schema and receive a
  typed arguments object, rather than a resolver the user has to unwrap. This
  is the strongest reason to keep the schema, and it is the shape most
  frameworks converge on.
- **Autocomplete.** The schema records which options have `autocomplete`
  enabled, so the autocomplete router can validate that the focused option
  is one that supports it.

The schema is therefore a first-class part of the command definition, not an
implementation detail of the resolver.

#### Typed command arguments

**Resolved: runtime-validated, with compile-time inference where the builder
allows it.**

There is a hard constraint here that determines the whole answer. The
`SlashCommandBuilder` type does **not** carry the option list in its type.
`addStringOption()` and friends return `this`, so the builder's type is the
same regardless of which options were added. The options exist only in the
runtime `options` array.

That means a fully-typed `args` object cannot be inferred from the builder
chain. If a user writes:

```ts
new SlashCommandBuilder()
    .setName('ban')
    .addUserOption(o => o.setName('target'))
    .addIntegerOption(o => o.setName('days'))
```

there is no way for TypeScript to know that `target` is a user and `days` is
an integer. The information is not in the type system. Any framework that
promises fully-typed arguments from a builder chain is either using a
different builder whose types *do* accumulate, or is doing type-level
inference over a separately-declared schema.

That gives three possible designs:

| Design | DX | Runtime complexity |
|---|---|---|
| **A. Separate typed schema** — options declared as a typed object, builder generated from it | Best: `args.days` is `number`, not `number \| undefined` | Schema must be kept in sync with the builder, or the builder is generated from the schema |
| **B. Builder only, runtime resolver** — `options.getInteger('days')` | Mediocre: every access is a method call returning `number \| null` | Lowest |
| **C. Builder + runtime-validated typed args** — builder is the source of truth, args are validated at runtime and typed as best-effort | Good: `args.days` is `number \| undefined`, no method call | Moderate |

**The chosen design is C**, with the resolver from the previous section
available as the escape hatch for the cases it handles better.

Concretely:

- **The builder remains the source of truth.** The user writes a normal
  `SlashCommandBuilder`. This matters for familiarity and because
  `discord.js` users already know it.
- **At registration time, the framework derives the schema** from
  `builder.options` and stores it on the command definition.
- **At invocation time, the framework validates the incoming options against
  that schema** and produces a plain `args` object, keyed by option name.
- **The `args` object's type is derived from the schema**, so
  `args.days` is `number | undefined` and `args.target` is `string | undefined`
  (a user option's value is a user ID string; the resolved user is in
  `args.resolved`).

The `args` object is a plain record, so it is trivially serializable, easy to
log, and simple to test. It replaces the resolver for the common case.

**Why not A.** A separately-declared typed schema would give better types, but
it means the user declares options twice — once in the schema for the types,
once in the builder for Discord — or the framework generates the builder from
the schema, which means abandoning `SlashCommandBuilder` and maintaining a
parallel builder with accumulating types. That is a significant chunk of work
and a significant DX departure, for a benefit that only shows up in
`strictNullChecks` on optional options.

**Why not B alone.** `options.getInteger('days')` returning `number | null`
on every access is exactly the friction the framework is trying to remove. It
also forces the user to unwrap every option at every use site.

**What C gives up.** Option types are not known at compile time, so
`args.days` is `number | undefined` rather than `number`, and the framework
cannot statically reject `args.days.foo`. The framework compensates with
**runtime validation**, which is stronger than nothing and matches what
Discord itself enforces — Discord rejects out-of-range values and unknown
options before the interaction reaches the bot, so in practice the runtime
schema is a second line of defence rather than the only one.

**A pragmatic middle path for later.** A `defineCommand()` helper that takes
an options object and generates the builder would give full type inference
without abandoning `SlashCommandBuilder` — the framework would call
`addStringOption` and friends internally. The option descriptor types would
carry the type, and the handler's `args` type would be computed from them.
This is worth doing if the runtime-validated approach proves frustrating in
practice, but it is not required to ship a usable framework, so it is not in
the initial scope. It is recorded here because it is the natural evolution
and the schema infrastructure needed for it is already in place.

#### Modals

Modals are **in scope** and are part of the widget model from the start.

A modal is the same idea as a widget, with a different target and a different
interaction type:

- It is opened in response to an interaction, and its contents are a set of
  text inputs rather than a rendered message.
- It is submitted, producing a `MODAL_SUBMIT` interaction, which is routed
  back to the widget that opened it.
- The `custom_id` of the modal itself is the routing key.

So the modal is a widget with `renderModal()` instead of `render()`, and the
router handles the `MODAL_SUBMIT` interaction type. The framework should
provide a builder helper for constructing modal components, since
`TextInputBuilder` must live inside a `Label` (or an action row) and getting
that nesting right is fiddly.

Because modals are widgets, they inherit the same routing machinery — the
same `custom_id` scheme, the same action dispatch — which is a good reason to
get the widget engine right before building them.

### Config

Schema-based, environment-aware, and validated once at startup. Fail loudly
at boot rather than at first use. This replaces the `process.exit(1)` pattern
in the current testbot config with something reusable, and it should support:

- Required vs. optional values, with defaults.
- Type coercion and bounds.
- Secrets that are redacted when the config is logged or exported.
- Multiple sources (environment, file) with an explicit precedence.

### Caching

Two tiers, both with pluggable stores. The tiering exists because the two use
cases have genuinely different requirements, and conflating them would either
under-serve permission checks or over-serve a bot that only wants to look up
a username.

**Tier 1 — minimal, on by default.** Holds only what is needed to avoid
routine rate-limit pressure:

- Guild roles (`GET /guilds/{id}/roles`) — needed to resolve a member's
  effective permissions.
- Channel permission overwrites (`GET /channels/{id}`) — needed for the same
  calculation.

These are the two lookups that permission checks require, and they are
bounded: a guild has tens of roles and a channel has a handful of overwrites.
This tier is small enough to keep on by default without undermining the
memory win.

**Tier 2 — opt-in, inclusive.** Adds the caches a bot may want for
convenience or features:

- Guilds, channels, members, users.
- Message content, if the bot needs to read history.

This tier is where the memory cost lives, so it is never enabled implicitly.
The user chooses what goes in it.

**Tier 2 defaults match `discord.js`.** A user who opts into the inclusive
tier is explicitly accepting the extra memory, and at that point they may
reasonably expect parity with `discord.js` — so the defaults are `discord.js`'s
defaults, read from `discord.js/src/util/Options.js` and
`discord.js/src/util/Sweepers.js`:

| Kind | `discord.js` default | Meaning |
|---|---|---|
| Messages | `MessageManager: 200` | Max 200 cached messages per channel, as a `LimitedCollection` |
| Threads | `interval: 3600`, `lifetime: 14400` | Swept hourly, dropping threads archived more than 4 hours ago |
| Invites | `lifetime: 14400` | Expired invites dropped after 4 hours |
| Messages (sweeper) | `lifetime: 3600` | Messages swept after 1 hour of inactivity, when a message sweeper is enabled |

The rest of `discord.js`'s swept kinds (`bans`, `emojis`, `guildMembers`,
`presences`, `stickers`, `voiceStates`, `reactions`, `applicationCommands`,
`autoModerationRules`, `entitlements`, `stageInstances`, `threadMembers`,
`users`) are **not swept by default** — `discord.js` only enables the
`threads` sweeper out of the box, and leaves everything else in the cache
indefinitely until the process exits.

That last detail is worth being explicit about, because it changes the
shape of the default. `discord.js`'s effective behaviour is:

- **Bounded by count:** messages, 200 per channel.
- **Bounded by age:** threads (4h), invites (4h).
- **Unbounded:** everything else — guilds, channels, members, users, presences
  — retained for the lifetime of the process.

So "parity with `discord.js`" does **not** mean "every kind has a TTL". It
means the same per-kind limits where `discord.js` has them, and indefinite
retention where it does not. The framework should match this exactly rather
than inventing a uniform TTL policy, because a user comparing behaviour
against `discord.js` would otherwise find the difference surprising.

The practical consequence: the inclusive tier's memory footprint is bounded
by the number of guilds, channels, and members the bot is in, not by any
time-based policy. That is the trade the user is opting into, and the
framework should say so plainly in the docs rather than implying the
inclusive tier is self-limiting.

**TTL support.** Where a kind has a lifetime, the framework applies it. TTLs
are per-kind and configurable, and the defaults are the table above.

**Eviction.** Two mechanisms, matching `discord.js`:

- **Count-based**, for kinds with a maximum size (messages: 200 per
  channel). This is an LRU-style bounded collection, not a sweep.
- **Age-based**, for kinds with a lifetime. `discord.js` sweeps on an
  interval (hourly for threads) and drops items whose lifetime has elapsed.
  The framework can expire on read instead, which avoids a periodic timer,
  or sweep on an interval for parity. Sweeping on an interval is closer to
  `discord.js` behaviour and keeps memory genuinely bounded rather than
  relying on access patterns, so the framework should sweep.

Where the sweep runs and how long it takes to reclaim memory is a
framework-internal detail; the observable contract is that a cached item
lives no longer than its lifetime plus one sweep interval.

**Invalidation.** The event router's typed events drive cache invalidation
directly, which is the natural consequence of building the event layer:

| Event | Invalidates |
|---|---|
| `GUILD_ROLES_UPDATE` | That guild's roles |
| `GUILD_UPDATE` | That guild |
| `CHANNEL_UPDATE` | That channel's overwrites |
| `GUILD_MEMBER_UPDATE` | That member |
| `GUILD_MEMBERS_CHUNK` | That member |

This is the answer to the permission-resolution question. Effective
permissions depend on guild roles, member roles, and channel overwrites, and
each of those has a corresponding gateway event. Cache invalidation is
therefore not a special mechanism — it is a few lines of event handlers.

**Resolution algorithm.** To compute a member's effective permissions in a
channel:

1. Start with `@everyone`'s permissions from the guild's role list.
2. Add the permissions of every role the member holds.
3. Apply channel overwrites: `@everyone` overwrite, then the union of role
   overwrites for the member's roles, then the member-specific overwrite.
   Denies always win over allows, and role overwrites are unioned before the
   member overwrite is applied.

The interaction payload already contains `member.roles` and
`app_permissions`, so the member's role list is usually available without a
fetch. The guild's role *definitions* and the channel's overwrites are the
two things that need caching.

**Note on permission values.** As established earlier, Discord v10 returns
permission bitfields as **strings**, and 64-bit permission values exceed
`Number.MAX_SAFE_INTEGER`. The framework's own bitfield type must therefore
be `bigint`-backed, and all parsing of permission values from payloads must
go through `BigInt(...)`. This applies to `APIRole.permissions`,
`APIGuildMember.permissions`, `interaction.member.permissions`,
`interaction.app_permissions`, and `APIOverwrite.allow` / `.deny`.

**Stores.** Both tiers use the same `Store` interface as
[Stores](#stores) — memory, JSON file, Redis — so a user can run a shared
cache across pods if they want. A cache entry is keyed by kind and id, e.g.
`roles:{guildId}`, `channel:{channelId}`.

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
The permission module is early for a different reason — it is self-contained,
has a hard `bigint` requirement, and is needed by the command middleware.

**Step 0 is a vertical spike** — see
[F2](./fixes.md#f2-no-vertical-slice-in-the-roadmap). It is a throwaway
end-to-end path against the real Discord API, written with no abstractions,
whose purpose is to answer the integration questions that unit tests cannot.
The abstractions in steps 1–3 should be extracted from it rather than
designed ahead of it.

| # | Step | Notes |
|---|---|---|
| 0 | **Vertical spike** | Connect, register one command, respond, edit, add a button, handle the click, edit again. Throwaway code, plus a short write-up of what was learned. |
| 1 | Foundation | Package scaffolding on core, `core` client wrapper, typed event router, REST helpers, interaction helpers — informed by the spike. |
| 2 | Permissions | `bigint`-backed bitfield, role/overwrite resolution. Self-contained and independently testable. |
| 3 | Widget engine | Widget interface, router, routing-id generation, custom-id minting and parsing, action splitting, rendering pipeline, message editing for both channel and ephemeral targets, cold-start queue. Full test coverage, asserting on request shape. |
| 4 | Menu / Wizard | Rebuilt on the widget engine, with the dynamic step model. |
| 5 | Panel | Persistent widgets, store interface and implementations, registry, restoration. |
| 6 | Commands + middleware | Definitions, registration, option schema derivation and typed resolver, permission and cooldown middleware, error handling. |
| 7 | Cache | Two tiers, store interface, memory implementation, event-driven invalidation. |
| 8 | Config | Schema, loading, validation, redaction. |
| 9 | Metrics | Registry, Prometheus exposition, handler and optional server. |
| 10 | Modals | Modal widgets, `MODAL_SUBMIT` routing, builder helpers. |
| 11 | Stores | Redis implementation, command-cooldown store. |
| 12 | Testing utilities | Mock client, payload factories, exported for consumers. |

Steps 7, 8, and 9 are independent of the others and can land in any order.
Step 10 depends on the widget engine being right, which is why it sits after
the menu and panel work has validated the model.

### Implementation status

Every step of the roadmap above has been implemented. The modules map onto
the roadmap like this:

| Step | Module |
|---|---|
| 1. Foundation | `src/core`, `src/api`, `src/interaction` |
| 2. Permissions | `src/permissions` |
| 3. Widget engine | `src/ui` (`ids`, `render`, `router`, `messages`) |
| 4. Menu / Wizard | `src/ui/menu` |
| 5. Panel | `src/ui/panel` |
| 6. Commands + middleware | `src/commands` |
| 7. Cache | `src/cache` |
| 8. Config | `src/config` |
| 9. Metrics | `src/metrics` |
| 10. Modals | `src/ui/modal` |
| 11. Stores | `src/store` (including the Redis implementation) |
| 12. Testing utilities | `src/testing` |

Two decisions were settled during implementation, and both follow from the
rules already stated above:

- **The reserved action marker is `~`.** It is a character that cannot
  appear in a user-defined action, so the split between the reserved part and
  the user part is unambiguous and cannot be spoofed. Only the first two
  separators of a custom id are significant, so a user's action may contain
  `:` freely.
- **The derived schema is validated at registration time.** A command whose
  options are malformed fails at boot rather than when a user invokes it.

The `defineCommand()` helper and the typed-schema builder variant recorded in
the open questions are still out of scope: the schema infrastructure they
would need is in place, but they are not required to ship a usable
framework.

---

## Open questions

All of the previously open questions are now resolved and folded into the
design above. The remaining items are small enough to settle as they are
encountered during implementation:

- Whether the `Store` interface needs TTL and CAS semantics, or whether
  those belong to the cache layer on top of it. Given that the inclusive tier
  needs per-kind TTLs, this probably belongs on the cache layer, with the
  `Store` interface staying a plain key-value contract.
- The exact shape of the `metrics.handler()` response, and whether it should
  serve anything beyond `/metrics` (a health check, for instance).
- Whether a `defineCommand()` helper that generates a builder from a typed
  option descriptor is worth building. The schema infrastructure it needs is
  already in place; the question is whether the DX gain justifies the extra
  surface.
- Whether the framework should offer a `SlashCommandBuilder` variant that
  takes a typed schema directly, rather than deriving the schema from a
  hand-written builder. This is the same question as the one above, and
  should be answered together.
