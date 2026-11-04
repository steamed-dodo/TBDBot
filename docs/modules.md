# Module Designs

How each module of the framework works. Companion to
[`design.md`](./design.md), which holds the goals, the invariants, and the
decisions, and to [`discord-notes.md`](./discord-notes.md), which holds the
facts about Discord and `@discordjs/core`.

---

## Core client

Owns `REST`, `WebSocketManager`, and core's `Client`. Responsibilities:

- Token handling, `connect()` / `destroy()` lifecycle.
- Translation of raw gateway dispatches into friendly typed events.
- Shutdown ordering: stop accepting interactions → flush metrics → destroy
  gateway → destroy HTTP server. Must complete within the K8s grace period.
- Reconnect and resume behaviour delegated to `@discordjs/ws`.

The gateway and the `REST` instance are **injected**, which is what makes the
whole framework testable without a network.

## Event router

Translates `GatewayDispatchEvents.*` into typed, named events:

```ts
client.on('interactionCreate', (interaction) => { ... });
client.on('messageCreate', (message) => { ... });
client.on('ready', (info) => { ... });
```

Each event carries the raw payload plus a small typed accessor layer. The
router is where per-guild/per-channel event filters belong, so that handlers
are not all woken for every event.

### Two tiers

The router's scope is explicit rather than incidental:

- **Tier 1 — the events the framework itself needs.** A closed list, exported
  as `TIER_ONE_EVENTS`: `InteractionCreate`, `Ready`, `Resumed`, the guild
  lifecycle, the guild role events, the guild member events, the channel
  events, the message events, `UserUpdate`, `PresenceUpdate`, `TypingStart`,
  `VoiceStateUpdate`, `WebhooksUpdate`, the thread events, and the audit log
  entry event.
- **Tier 2 — passthrough.** Every other dispatch is re-emitted under its raw
  dispatch name with the raw payload. A user who wants `GUILD_BAN_ADD` or
  `APPLICATION_COMMAND_PERMISSIONS_UPDATE` gets it, without the framework
  having typed it.

The cache invalidation depends on four specific events being typed, so they
are a **requirement** on the router rather than a description of what it
happens to do. `CACHE_INVALIDATION_EVENTS` names them, and a test asserts
that they are all in Tier 1.

## Interaction helpers

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

An interaction also exposes:

- **`expiresAt`** — the moment the interaction token stops being valid.
  After that the interaction can no longer be responded to, and an ephemeral
  message can no longer be edited.
- **`responded`** — whether the interaction has been answered. The widget
  router uses it to notice a handler that never acknowledged, and answers on
  its behalf.

## Interactive UI

The central new idea. Two layers:

**The widget** — a unit of state plus how to display it:

```ts
interface Widget<S> {
    readonly id: string;
    readonly routingId: string;
    render(state: S): RenderedContent | Promise<RenderedContent>;
    onAction?(action: string, ctx: ActionContext<S>): void | Promise<void>;
    onNavigation?(action: string, ctx: ActionContext<S>): void | Promise<void>;
}
```

**The router** — resolves an incoming `custom_id` to a widget and an action,
then hands control to the widget.

```
                    ┌───────────────────────────┐
  interaction ─────▶│  router                    │
  (custom_id)       │  custom_id → widget + action│
                    └─────────────┬─────────────┘
                                  │ update(nextState)
                                  ▼
   state ──▶ render(state) ──▶ { content, embeds, components } ──▶ message
```

### State ownership

**The framework holds the state. The widget does not.**

The widget never exposes a `state` property and never reads one
implicitly: the framework holds the one true value and hands it back to
`render(state)` on every repaint. `update(nextState)` replaces the value and
repaints.

This matters because the alternative — a widget that owns its state and reads
it in `render()` — is only correct if the user mutates the state *in place*.
Replacing it, which is what `useState`-style code does, silently renders the
old value. With the state passed in, replacement is always safe: `render` is
called with the value that was passed to `update`, never with a stale copy.

Persistent widgets add two hooks, so the framework can persist and rebuild
them without the widget holding a second copy:

```ts
interface PersistentWidget<S> extends Widget<S> {
    serialize(state: S): unknown;   // JSON-serializable snapshot
    restore(data: unknown): S;       // rebuild the state from a snapshot
}
```

The important property of the model is that `update()` can be called from
**anywhere** — a component interaction, a timer, a Redis pub/sub message, a
queue worker, another bot instance. Collectors scoped state to "one message,
while the process lives". The widget model does not: it separates *what is
displayed* from *what caused a change*.

Lifetimes differ, the engine does not:

| Lifetime | Survives restart | Timeout | State source |
|---|---|---|---|
| Session | No | Yes | In memory |
| Persistent | Yes | No | Store-backed, restored at boot |

A persistent **menu** — a paginated menu that survives a restart — falls out
of this for free, and is not something the current library can do.

### Custom ID scheme

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

Only the first two separators are significant, so a user's action may contain
`:` freely. Total length must fit in 100 characters. The framework provides a
helper that rejects over-long actions rather than letting Discord reject the
message.

**Consequence, stated plainly:** custom IDs on framework-rendered components
are framework-owned strings. User-supplied components are namespaced by the
framework, so a user cannot set an arbitrary `custom_id` and expect it to
survive routing. This must be documented clearly, and the API should make
the correct thing easy — for example a `button('confirm')` helper rather than
raw `ButtonBuilder` usage.

### Widget identity

**Resolved:** the widget's routing identity is a separate, short, framework-
generated id, stored alongside the widget's own identity.

This is a deliberate departure from reusing the panel's id. The panel id is
already a snowflake or UUID and is part of the public API and the persisted
record; the routing id is an implementation detail of the custom-id scheme
and should be optimised for a different constraint.

The reasons for a separate id:

- **Length budget.** A UUID is 36 characters; a snowflake is 19. The routing
  id needs to be short because it shares a 100-character field with the
  namespace and the action. A short base-36 id (10–12 characters) leaves the
  majority of the budget for user-defined actions.
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

### Action payloads

**Resolved:** hybrid. Framework-parsed structured actions for built-in
navigation, raw string for everything the user defines.

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
stripped, and `ctx.rawCustomId` carries the untouched original `custom_id` for
anyone who needs it.

The rationale for the hybrid: a purely structured scheme would force users
into a fixed vocabulary or into inventing an encoding, and a purely raw
scheme would make the framework's own navigation indistinguishable from user
actions, forcing every widget to hand-parse its own `custom_id` and
reimplement prefix matching. The hybrid keeps the framework's internals
private and leaves the user's namespace theirs.

The reserved prefix is `~` — a character that cannot appear in a user-defined
action under the framework's own rules, so the split is unambiguous and
cannot be spoofed.

**The two paths are separate, not merely validated.** `createCustomId()`
accepts user actions only and rejects the marker anywhere; the framework
mints its own actions through `createReservedCustomId()`, which accepts only
the closed set in `RESERVED_ACTIONS` (`next`, `previous`, `back`, `select`,
`choice`). Component specifications carry an explicit `reserved?: boolean`
that only the framework's own chrome sets, so a hand-built specification
cannot enter the reserved namespace at all. See
[`fixes.md` §F11](./fixes.md#f11-the-reserved-action-prefix-can-be-spoofed).

### Cold-start routing

**Resolved:** queue the interaction.

When an interaction arrives for a widget that is not yet in memory — because
restoration is still running after a process start — the router queues it
rather than dropping it, and drains the queue as each widget is restored.

Details that matter:

- **The queue is per widget id**, so a restored widget drains only its own
  queued interactions.
- **Queued interactions still need acknowledging within 3 seconds.** The
  interaction token is invalidated if the initial response is not sent in
  time. So on queueing, the router immediately `defer()`s the interaction,
  then processes it once the widget is available. Deferring is also the right
  UX: the user sees the loading state rather than an error.
- **The queue is bounded.** An unbounded queue is a memory leak and a
  potential denial-of-service vector against a bot that is being spammed
  during a cold start. The queue has a per-widget limit and an overall
  limit, and drops the oldest entries when full.
- **Queued interactions expire.** Interaction tokens are valid for 15
  minutes. A queued interaction older than that can no longer be responded
  to, so it should be discarded rather than replayed.
- **Restoration failure must drain the queue.** If the widget never restores
  — its record is gone, or its factory throws — the queued interactions must
  be failed rather than left pending forever.

Dropping the interaction outright would be simpler but would silently break
the "persistent menu survives a restart" property that motivates persistent
widgets in the first place.

### Rendering pipeline

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

**An ephemeral message can only be edited for 15 minutes** after the
interaction that created it. The widget records the expiry with the message
target, and an update past that point throws `MessageExpiredError` rather
than making a doomed request. A widget that needs long-lived updates should
be delivered to a channel instead.

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
simultaneously in one renderer is more complexity than it is worth before
the API has stabilised. Deferring also keeps the widget output type simple
during the period when it is most likely to change.

**File attachments are deferred** for the same reason. `@discordjs/core`
supports attachments on both channel messages (`files`) and interaction
responses (`withFiles`), so the capability is there when it is needed, but
the rendering pipeline will not carry attachment state until the API is
stable.

### Acknowledgement

An interaction must be acknowledged within 3 seconds. The router arms a
deadline when it dispatches an action and, if the handler has not answered
by then, acknowledges on its behalf — a component interaction with
`deferUpdate`, a modal submission with `defer`.

The deadline is deliberately not "defer before dispatching": a deferral is a
response, and Discord rejects a second one, so a handler that opens a modal
would break. Answering at 2.5 seconds instead keeps the guarantee for a slow
handler and leaves a fast one — including a modal-opening one — untouched.
The deadline is the `acknowledgeAfter` router option, so a test can set it
to a few milliseconds. See
[`fixes.md` §F13](./fixes.md#f13-the-router-acknowledges-the-interaction-after-the-handler).

### Access policy

`access` lives on the widget (`Widget.access`) and the router applies it
before dispatching **any** action — the framework's own navigation and a
step's custom buttons alike. A widget registered directly with the router
gets the same protection, which was not true while the check lived in the
flow. See
[`fixes.md` §F19](./fixes.md#f19-the-access-policy-does-not-cover-custom-actions).

## Menu and Wizard

A menu and a wizard are **separate classes over a shared `Flow` base**, not
one class with a mode flag. What separates them is how their steps are
traversed, so the difference lives in the state transitions:

| | Menu | Wizard |
|---|---|---|
| Navigation | Linear, index-based chrome | Branching by `next` |
| Answer capture | None | `answers[stepId]` |
| Back behaviour | Previous page | Previous step, **clearing abandoned answers** |
| Completion | None | `onComplete` fires |

One step model serves both:

```ts
interface Step {
    readonly id: string;
    render(ctx: StepContext): StepContent | Promise<StepContent>;
    readonly next?: string | null;          // branching; absent = linear
    readonly choices?: readonly Choice[];    // auto-rendered buttons or select
    readonly onAction?(action, ctx): void;   // custom components
}
```

The `Step` type differs only in which optional members are populated. The
public API is `new Menu(...)` and `new Wizard(...)` either way.

## Panel

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

### A persistent widget holds only identifiers

A persistent widget holds `channelId`, `messageId`, and `guildId` — never a
message object. Holding one is a liability:

- It goes stale. The message may be edited or deleted by another client.
- It is a cache the framework does not need to maintain — and the framework
  has deliberately chosen to have no cache.
- In core there is no `Message` class to hold anyway, so this would be a raw
  `APIMessage` payload.

Editing a message needs only `channelId` + `messageId`, so no fetch is
required to edit. The widget does not need to know the message's current
content, because it renders from its own state.

The one place a fetch *is* needed is **restoration**, to confirm the message
still exists. That fetch should be explicit and its result used only for
validation, not retained.

## Commands and middleware

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

### Option parsing

The framework **does** derive an option schema from the command builder, and
**also** exposes a discord.js-style typed accessor. Both are possible because
the builder retains enough structure to reconstruct the schema.

`SlashCommandBuilder` and `SharedSlashCommand` expose a readonly `options`
array of `ToAPIApplicationCommandOptions[]`, which carries the full
declaration: `type`, `name`, `description`, `required`, `choices`,
`min_value` / `max_value`, `min_length` / `max_length`, `channel_types`, and
`autocomplete`.

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
absent.

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
  typed arguments object, rather than a resolver the user has to unwrap.
- **Autocomplete.** The schema records which options have `autocomplete`
  enabled, so the autocomplete router can validate that the focused option
  is one that supports it.

### Typed command arguments

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
  `SlashCommandBuilder`.
- **At registration time, the framework derives the schema** from
  `builder.options` and stores it on the command definition.
- **At invocation time, the framework validates the incoming options against
  that schema** and produces a plain `args` object, keyed by option name.
- The `args` object's type is derived from the schema, so `args.days` is
  `number | undefined` and `args.target` is `string | undefined` (a user
  option's value is a user ID string; the resolved user is in `args.resolved`).

The `args` object is a plain record, so it is trivially serializable, easy to
log, and simple to test. It replaces the resolver for the common case.

**The required check follows the invoked branch.** A command with two
subcommands that each declare a required option must not demand both: the
options of the branch that was not taken are not missing, they are irrelevant.
The check therefore walks the schema alongside the resolver's hoisted
subcommand, recursively, so a required option inside a group is enforced too.
See [`fixes.md` §F14](./fixes.md#f14-required-options-of-sibling-subcommands-are-cross-checked)
and [§F15](./fixes.md#f15-required-options-nested-two-levels-deep-are-never-checked).

**Why not A.** A separately-declared typed schema would give better types, but
it means the user declares options twice — once in the schema for the types,
once in the builder for Discord — or the framework generates the builder from
the schema, which means abandoning `SlashCommandBuilder` and maintaining a
parallel builder with accumulating types.

**What C gives up.** Option types are not known at compile time, so `args.days`
is `number | undefined` rather than `number`. The framework compensates with
**runtime validation**, which is stronger than nothing and matches what
Discord itself enforces.

**A pragmatic middle path for later.** A `defineCommand()` helper that takes
an options object and generates the builder would give full type inference
without abandoning `SlashCommandBuilder`. It is recorded here because the
schema infrastructure needed for it is already in place.

### Modals

Modals are **in scope** and are part of the widget model from the start.

A modal is the same idea as a widget, with a different target and a different
interaction type:

- It is opened in response to an interaction, and its contents are a set of
  text inputs rather than a rendered message.
- It is submitted, producing a `MODAL_SUBMIT` interaction, which is routed
  back to the widget that opened it.
- The `custom_id` of the modal itself is the routing key.

So the modal is a widget with `renderModal()` instead of `render()`, and the
router handles the `MODAL_SUBMIT` interaction type. The framework provides a
builder helper for constructing modal components, since `TextInputBuilder`
must live inside a `Label` (or an action row) and getting that nesting right
is fiddly.

## Config

Schema-based, environment-aware, and validated once at startup. Fail loudly
at boot rather than at first use. This replaces the `process.exit(1)` pattern
in the current testbot config with something reusable, and it should support:

- Required vs. optional values, with defaults.
- Type coercion and bounds.
- Secrets that are redacted when the config is logged or exported.
- Multiple sources (environment, file) with an explicit precedence.

## Caching

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

The rest of `discord.js`'s swept kinds are **not swept by default** — it only
enables the `threads` sweeper out of the box, and leaves everything else in
the cache indefinitely until the process exits.

That last detail is worth being explicit about, because it changes the shape
of the default. `discord.js`'s effective behaviour is:

- **Bounded by count:** messages, 200 per channel.
- **Bounded by age:** threads (4h), invites (4h).
- **Unbounded:** everything else — guilds, channels, members, users, presences
  — retained for the lifetime of the process.

So "parity with `discord.js`" does **not** mean "every kind has a TTL". It
means the same per-kind limits where `discord.js` has them, and indefinite
retention where it does not. The framework should match this exactly rather
than inventing a uniform TTL policy.

The practical consequence: the inclusive tier's memory footprint is bounded
by the number of guilds, channels, and members the bot is in, not by any
time-based policy. That is the trade the user is opting into, and the
framework should say so plainly in the docs.

**TTL support.** Where a kind has a lifetime, the framework applies it. TTLs
are per-kind and configurable, and the defaults are the table above.

**Eviction.** Two mechanisms, matching `discord.js`:

- **Count-based**, for kinds with a maximum size (messages: 200 per
  channel). This is an LRU-style bounded collection, not a sweep.
- **Age-based**, for kinds with a lifetime. `discord.js` sweeps on an
  interval (hourly for threads) and drops items whose lifetime has elapsed.

The observable contract is that a cached item lives no longer than its
lifetime plus one sweep interval.

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

**A guild invalidation must reach everything the guild owns.** Channels are
keyed by channel ID and members by `{guildId}:{userId}`, so neither can be
found from the guild ID alone. The cache keeps a guild index — the entries
of each kind that belong to a guild — and `invalidateGuild` walks it. Without
it, a departed guild's channels held their `permission_overwrites` forever
and `guildMembersChunk` cleared nothing. See
[`fixes.md` §F16](./fixes.md#f16-invalidateguild-leaves-the-guilds-cached-channels-behind)
and [§F17](./fixes.md#f17-invalidateguild-uses-a-member-key-that-is-never-written).

The index is in memory. A cache backed by a shared store therefore only
knows the entries this process wrote; a process that has just started
invalidates by key and cannot reach another process's entries. That is
acceptable for the caches the framework keeps, and it is worth stating.

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

**Note on permission values.** Discord v10 returns permission bitfields as
**strings**, and 64-bit permission values exceed `Number.MAX_SAFE_INTEGER`.
The framework's own bitfield type must therefore be `bigint`-backed, and all
parsing of permission values from payloads must go through `BigInt(...)`.

**Stores.** Both tiers use the same `Store` interface as
[Stores](#stores) — memory, JSON file, Redis — so a user can run a shared
cache across pods if they want. A cache entry is keyed by kind and id, e.g.
`roles:{guildId}`, `channel:{channelId}`.

## Stores

A general `Store` interface (`get`, `set`, `delete`, `scan`, `has`, `clear`)
with memory, JSON file, and Redis implementations. Panel persistence is one
consumer; command cooldowns and other framework state are others.

The interface is deliberately plain: TTL and compare-and-set semantics belong
to the cache layer built on top of it, not to the store itself.

Listing is **cursor-based** rather than a single full listing. A remote store
must not be asked for its whole keyspace: Redis's `KEYS` is O(N) and blocks
the server while it runs, while `SCAN` walks the keyspace in batches. The
cache sweeps, clears and enforces its per-kind limits through the cursor, so
nothing in the framework issues a blocking listing. See
[`fixes.md` §F21](./fixes.md#f21-the-redis-store-uses-the-blocking-keys-command).

## Metrics

Hand-rolled Prometheus text exposition, per decision 13.

```
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

## Testing

Because interactions are raw payloads and the REST transport is injectable,
the whole framework is testable without a network:

- A mock client that records REST calls and returns canned payloads.
- Interaction factories that build valid `APIInteraction` payloads for each
  interaction type.
- Payload builders for messages, guilds, members, and roles.

The mock transport records the **route template** of every request — not just
the method — so a test can assert that the framework called the right
endpoint. This matters most for the ephemeral edit path, where the webhook
path and the channel path are easy to confuse and the mistake is invisible to
a test that only checks "an edit happened".

This is a direct dividend of decision 15 and of doing the routing work
ourselves. It is also why the widget engine must be careful to keep its
inputs as plain data.

**The tests are type-checked.** `npm run typecheck` covers `src`, the tests
and the examples. Excluding the tests from `tsconfig` let two defects hide in
plain sight: a component specification that was missing a field Discord
requires, and a registration that accepted no state at all. Both were cast or
defaulted past the compiler and only failed at runtime, so the suite now
fails at the type level too.
