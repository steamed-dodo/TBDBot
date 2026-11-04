# Discord and `@discordjs/core` Notes

Reference material for [`design.md`](./design.md). Everything here was
verified against the published packages and the live API, not against
documentation prose.

It is the material most likely to be consulted while writing code and least
likely to change, which is why it lives in its own document.

---

## Versions

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

## Dependency shape

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

## No cache

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
REST-per-lookup is untenable — see
[Caching](./modules.md#caching).

## No collectors

`@discordjs/core` has no `createMessageComponentCollector`. This is the
single biggest piece of work in the port, and the reason the UI layer is
redesigned rather than transliterated. See
[Interactive UI](./modules.md#interactive-ui).

## Client shape

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

## Events

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

The gateway itself emits `('dispatch', payload, shardId)`, where `payload` is
the raw `GatewayDispatchPayload`. The framework's router listens there rather
than on the core client, which is what makes the raw passthrough possible.

## Interaction responses

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

`core` wraps the body for you: `reply` sends
`{ type: ChannelMessageWithSource, data }`, `defer` sends
`{ type: DeferredChannelMessageWithSource, data }`, and so on. The framework
must **not** add a `type` of its own.

The response types are worth writing down, because the numbers are not the
obvious ones:

| Response | `InteractionResponseType` |
|---|---|
| `CHANNEL_MESSAGE_WITH_SOURCE` | 4 |
| `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` | 5 |
| `DEFERRED_MESSAGE_UPDATE` | 6 |
| `UPDATE_MESSAGE` | 7 |
| `APPLICATION_COMMAND_AUTOCOMPLETE_RESULT` | 8 |
| `MODAL` | 9 |

Two consequences:

- **`applicationId` is required** for the webhook-based operations
  (`followUp`, `editReply`, `getOriginalReply`, `deleteReply`). It is
  available from the Ready dispatch: `data.application.id`, and it is also on
  every interaction payload as `application_id`.
- **Ephemeral responses must be edited through the webhook path.** An
  ephemeral message is not addressable by channel + message ID, so
  `api.channels.editMessage` cannot reach it. The existing
  `createWebhookController` / `createMessageController` split in `Menu.ts`
  maps directly onto this and should be preserved in the new design.

Interaction tokens are valid for 15 minutes, and an initial response must be
sent within 3 seconds of the interaction or the token is invalidated. The
15-minute window is what bounds the widget engine's "update from anywhere"
promise — see [`fixes.md` §F1](./fixes.md#f1-ephemeral-messages-have-a-15-minute-edit-window).

## Permissions

`PermissionsBitField` exists **only inside `discord.js`**
(`discord.js/src/util/PermissionsBitField.js`). It is not in
`discord-api-types`, not in `@discordjs/builders`, and not in core.
`discord-api-types` exports `PermissionFlagsBits` as a plain constant object
of `bigint`s and a `Permissions` type.

Additionally, **Discord's v10 API returns permission bitfields as
strings**, not numbers:

```json
{ "permissions": "2248473465835073" }
```

This applies to `APIRole.permissions`, `APIGuildMember.permissions`,
`interaction.member.permissions`, and `interaction.app_permissions`. Any
permission arithmetic in the framework must parse these strings, and 64-bit
permission values exceed `Number.MAX_SAFE_INTEGER`, so they must be handled
as `bigint`.

The framework needs its own permission helpers. This is a known, bounded piece
of work: a `bigint`-backed bitfield with `has`/`add`/`remove`, plus resolution
of guild role + channel overwrites + member roles.

## Component constraints

- `custom_id`: 1–100 characters, unique per message.
- Message: up to 5 action rows; each row up to 5 buttons, or 1 select.
- Up to 10 embeds per message.
- Components V2 (`IS_COMPONENTS_V2`, flag `1 << 15`) allows 40 total
  components and replaces `content`/`embeds` with `TextDisplay` /
  `Container` / `Section` builders. `discord-api-types@0.38.57` and
  `@discordjs/builders@1.15.0` both include the V2 builders.

## Rate limits

- Global ceiling: **50 requests/second per bot**.
- Interaction endpoints are **not** bound to the global limit.
- Per-route limits vary; the framework must parse `X-RateLimit-*` headers
  rather than hard-code limits. `@discordjs/rest` already does this.

## Command payloads

`SlashCommandBuilder` and `SharedSlashCommand` expose a readonly `options`
array of `ToAPIApplicationCommandOptions[]`, which carries the full
declaration: `type`, `name`, `description`, `required`, `choices`,
`min_value` / `max_value`, `min_length` / `max_length`, `channel_types`, and
`autocomplete`. This is the same shape that is sent to Discord when the
command is registered, so the schema can be derived from it without the
framework maintaining a parallel description of the command.

The builder's **type** does not carry the option list: `addStringOption()`
and friends return `this`, so the builder's type is the same regardless of
which options were added. Any framework that promises fully-typed arguments
from a builder chain is either using a different builder whose types *do*
accumulate, or is doing type-level inference over a separately-declared
schema. See [`design.md` §Decisions](./design.md#decisions).
