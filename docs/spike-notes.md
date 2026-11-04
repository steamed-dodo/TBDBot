# Vertical Slice Notes

The write-up that [`fixes.md` §F2](./fixes.md#f2-no-vertical-slice-in-the-roadmap)
asks for: the answers to the integration questions that unit tests against
mocks cannot answer.

The runnable artefact is [`examples/vertical-slice.ts`](../examples/vertical-slice.ts).
It connects to Discord, registers one slash command, responds to it, edits
the response, attaches one button, handles the button click, and edits the
message again.

```sh
DISCORD_TOKEN=... DISCORD_APPLICATION_ID=... npm run example:vertical-slice
```

---

## What does `core`'s client lifecycle actually look like in practice?

`@discordjs/core`'s `Client` is thin, and thinner than a framework wants:

- It has **no `login()` and no `destroy()`**. The token is set on the `REST`
  instance, and the connection is opened by the gateway — which is a
  `WebSocketManager` from `@discordjs/ws@2` and not part of `core` at all.
- It is constructed from `{ rest, gateway }` and exposes `rest`, `gateway`
  and `api`. The `api` facade is built *from* the `REST` instance, so the
  two cannot disagree.
- Shutdown is the framework's problem. The order that matters is: stop
  accepting interactions → flush framework state → destroy the gateway →
  destroy the HTTP server.

The framework therefore owns the lifecycle rather than delegating it:
`FrameworkClient.connect()` sets the token and connects the gateway, and
`FrameworkClient.destroy()` runs the registered shutdown tasks in reverse
registration order before destroying the gateway.

**Consequence:** the gateway is injected rather than constructed, which is
what makes the whole framework testable without a network.

## How do we get `applicationId`, and when is it available?

From the `READY` dispatch, at `data.application.id`. It arrives with the
first `READY`, before any interaction can be handled.

The important detail is that **`application_id` is also on every interaction
payload**. The webhook-based operations — `followUp`, `editReply`,
`getOriginalReply`, `deleteReply` — need it, and an interaction handler
never has to wait for `READY` to have them: the framework reads it from the
payload it was given.

The framework also stores the `READY` value on the client, so a bot that
registers global commands at startup has it.

## What does editing an ephemeral message require?

A `PATCH` to the interaction webhook:

```
PATCH /webhooks/{application_id}/{interaction_token}/messages/@original
```

Not `api.channels.editMessage` — an ephemeral message is not addressable by
channel and message ID. The two paths are easy to confuse, and the mistake
is invisible to a test that only checks "an edit happened"; see
[`fixes.md` §F4](./fixes.md#f4-widget-tests-must-assert-on-request-shape).

The second detail is the one that bit: **the interaction token is valid for
only fifteen minutes.** After that the ephemeral message cannot be edited at
all. The framework records the expiry on the message target and throws
`MessageExpiredError` rather than making a doomed request — see
[`fixes.md` §F1](./fixes.md#f1-ephemeral-messages-have-a-15-minute-edit-window).

## What does `InteractionCreate` actually deliver?

The raw payload, with no rich object anywhere:

```jsonc
{
    "id": "…",
    "application_id": "…",
    "type": 3,
    "token": "…",
    "version": 1,
    "locale": "en-US",
    "app_permissions": "8",
    "guild_id": "…",
    "member": { "roles": ["…"], "permissions": "…", "user": { … } },
    "channel": { "id": "…", "type": 0 },
    "message": { … },
    "data": { "custom_id": "…", "component_type": 2 }
}
```

Two things to internalise:

- **Permissions are strings.** `app_permissions` and `member.permissions` are
  decimal strings, and 64-bit values exceed `Number.MAX_SAFE_INTEGER`. They
  have to be parsed with `BigInt()`.
- **`member.roles` is there.** The member's role list usually arrives with
  the interaction, so the only things a permission check needs to fetch are
  the guild's role *definitions* and the channel's overwrites — which is
  exactly what the minimal cache tier holds.

## Where does the three-second deadline bite?

Everywhere a handler does work before acknowledging. The concrete cases
found while building the slice:

- A command handler that fetches something from the REST API before
  replying. The fetch has to happen *after* the acknowledgement.
- A widget that computes its next state before deferring. The computation
  has to happen after the deferral.
- A cold-start interaction that waits for a persistent widget to be
  restored. The framework defers it **before** it queues it, because the
  wait can be long.

The rule the framework follows is therefore: acknowledge first, work
afterwards. `interaction.defer()`, `interaction.deferUpdate()` and
`interaction.reply()` are the three ways to do it, and the widget engine
defers before it dispatches an action.

## What the slice changed in the framework

Three things came out of writing it that the abstractions did not anticipate:

1. **The widget engine has to defer before it dispatches.** The first draft
   deferred inside the menu's transition, which meant a custom widget could
   forget to. Deferring in the router, before the action handler runs, is
   the only place it cannot be forgotten.
2. **A custom widget needs a way to be delivered.** The slice registers a
   widget that is not a menu and not a panel. `router.register(widget, target,
   state)` is the API it needs, and the target is the thing that says where
   the message lives.
3. **The state has to be handed to the widget.** The counter widget reads
   its state from the argument of `render(state)`, not from a property. See
   [`fixes.md` §F3](./fixes.md#f3-widget-state-ownership-is-contradictory).
