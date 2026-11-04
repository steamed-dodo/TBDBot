# Fixes and Touchups

Companion to [`design.md`](./design.md). This document lists the problems
found in the design after it was written, and what to do about each one.

Nothing here contradicts the design's decisions. These are gaps, ambiguities,
and sequencing problems — the kind that are cheap to fix in a document and
expensive to fix in code.

**Status of each item:**

The first nine were found while reviewing the *design* and have all been
applied. The commit that applied each one is named in the table, and the
design documents record where it landed — see
[design.md § Fixes applied](./design.md#fixes-applied).

| ID | Severity | Status | Applied in |
|---|---|---|---|
| [F1](#f1-ephemeral-messages-have-a-15-minute-edit-window) | **High** | Applied | `1f9cf7d` |
| [F2](#f2-no-vertical-slice-in-the-roadmap) | **High** | Applied | `e3899d3` |
| [F3](#f3-widget-state-ownership-is-contradictory) | **High** | Applied | `ce66527` |
| [F4](#f4-widget-tests-must-assert-on-request-shape) | **High** | Applied | `eb2b32e` |
| [F5](#f5-the-design-needs-an-invariants-section) | Medium | Applied | `dfb7b19` |
| [F6](#f6-one-menuwizard-class-may-become-a-mode-flag) | Medium | Applied | `ce66527` |
| [F7](#f7-the-event-router-scope-is-undefined) | Medium | Applied | `b124c7d` |
| [F8](#f8-persistent-widgets-should-not-hold-a-message-object) | Low | Applied | `ce66527` |
| [F9](#f9-design-doc-is-long-and-hard-to-navigate) | Low | Applied | `3a5333b` |

A **second pass** over the implementation found twelve further defects
(F10–F21). Those are all open and are documented in
[Second pass](#second-pass-defects-found-in-the-implementation).

---

## F1: Ephemeral messages have a 15-minute edit window

**Severity: high. This is a correctness constraint, not a preference.**

### The problem

The design's central promise is that `update()` can be called from anywhere —
a timer, a Redis message, a queue worker — and the widget repaints. That
promise is only true for messages sent to a channel.

An ephemeral message is **not addressable by channel + message ID**. It lives
on the interaction webhook, and the only way to edit it is:

```
PATCH /webhooks/{application_id}/{interaction_token}/messages/@original
```

The `interaction_token` is valid for **15 minutes**. After that, the ephemeral
message cannot be edited at all — by the framework or by anyone else.

The design acknowledges the webhook-vs-channel distinction for *editing*, but
never confronts what it means for *lifetime*. The current text says:

> The important property is that `update()` can be called from **anywhere** —
> a component interaction, a timer, a Redis pub/sub message, a queue worker,
> another bot instance.

For an ephemeral session widget, that is true for the first 15 minutes and
silently false afterwards.

The failure mode is nasty: `update()` throws a 404 from Discord, or the
message silently stops changing. A long-running ephemeral widget — a live
leaderboard, a status display — would break after a quarter of an hour with
no obvious cause.

### The fix

Three parts.

**1. Track the editability window explicitly.** The widget should know when
its message can no longer be edited, rather than discovering it via a failed
HTTP request. Record the interaction's expiry at creation time:

```ts
interface MessageTarget {
    readonly channelId: string;
    readonly messageId: string;
    /** Present only for interaction-delivered (ephemeral) messages. */
    readonly webhook?: { applicationId: string; token: string };
    /** Absolute expiry for webhook-backed messages. */
    readonly expiresAt?: number;
}
```

**2. Make `update()` fail loudly and specifically.** When the widget's target
has expired, `update()` should throw a typed error — say `MessageExpiredError`
— rather than making a doomed HTTP request. The error should say what
happened and what the user can do about it (send a new message instead).

**3. Document the constraint, and offer the escape hatch.** The honest
statement is:

> Ephemeral messages can only be edited for 15 minutes after the interaction
> that created them. For anything that must be updated over a longer period,
> send the message to a channel instead.

The framework should make that easy to choose — a widget that needs
long-lived updates should be a channel-delivered widget, and the design
should say so rather than leaving it as a trap.

### Related

This also affects the **cold-start queue** (design §Cold-start routing).
Queued interactions are bounded by the same 15-minute window, which the
design already states — good. But it means a persistent widget that was
delivered ephemerally is not actually persistent, which reinforces that
persistent widgets should be channel-delivered by default.

---

## F2: No vertical slice in the roadmap

**Severity: high. This is a sequencing problem that affects everything
downstream.**

### The problem

All twelve roadmap steps in `design.md` are horizontal layers:

```
1. Foundation      5. Panel          9. Metrics
2. Permissions     6. Commands       10. Modals
3. Widget engine   7. Cache          11. Stores
4. Menu / Wizard   8. Config         12. Testing utilities
```

Nothing works end-to-end until step 4 at the earliest. The first moment the
framework demonstrably talks to Discord is several steps away.

Three consequences:

- **Mistakes compound silently.** The foundation is built against an imagined
  consumer. If the core client's shape is wrong — and it *is* unusual:
  `Client` has no `login()`, no `destroy()`, and events are raw
  `GatewayDispatchEvents.*` dispatches rather than friendly names — every
  layer above inherits the mistake.
- **The hard integration problems surface late.** Ephemeral editing,
  interaction deadlines, `custom_id` collisions, and the 3-second
  acknowledgment window are all *integration* problems. They cannot be found
  by unit tests against mocks. They can only be found by talking to Discord.
- **There is no working artifact to show.** After eight steps of work, there
  is still nothing a user could run.

### The fix

**Insert a vertical slice as step 0**, before the horizontal layers:

> Connect to Discord with `@discordjs/core`, register one slash command,
> respond to it, edit the response, attach one button, handle the button
> click, and edit the message again.

Deliberately written with **no abstractions** — direct `core` usage, no event
router, no widget engine, no DI. It is a spike, and its purpose is to
answer:

- What does `core`'s client lifecycle actually look like in practice?
- How do we get `applicationId` for the webhook path, and when is it
  available relative to Ready?
- What does editing an ephemeral message require, in practice?
- What does `GatewayDispatchEvents.InteractionCreate` actually deliver?
- What does the 3-second deadline feel like in practice, and where does the
  deadline bite?

The output is a **short write-up of the answers**, and the abstractions in
steps 1–3 should then be *extracted from* the spike rather than designed
ahead of it.

Rough sizing: 150–250 lines, throwaway, plus notes. It is the cheapest
insurance in the whole plan.

**Then** re-order the remaining steps slightly:

| # | Step | Change |
|---|---|---|
| 0 | Vertical spike | **New** |
| 1 | Foundation | Keep, but informed by the spike |
| 2 | Permissions | Keep |
| 3 | Widget engine | Keep |
| 4–12 | As before | Unchanged |

---

## F3: Widget state ownership is contradictory

**Severity: high. This is the core of the widget model.**

### The problem

The design defines the widget as:

```ts
interface Widget<S> {
    readonly id: string;
    readonly state: S;
    render(): RenderedContent | Promise<RenderedContent>;
    onAction?(action: string, ctx: ActionContext): void | Promise<void>;
}
```

and then, in the prose, says:

> you mutate your own state and call `update()`

These contradict each other. `state` is declared `readonly` on the interface,
so the widget does not own it. But the user "mutates their own state" — so
the user owns it. If the widget also holds a `state` reference, there are two
references to the same object and they only stay in sync if the user mutates
in place rather than replacing it.

Worse, `render()` takes no arguments. So `render()` must read `this.state` —
the widget's copy. If the user replaces their state object rather than
mutating it, `render()` reads a stale one and the widget silently renders
the wrong thing.

### Why it matters

This is not a typing nitpick. It is the difference between two incompatible
models, and picking wrong means either:

- **Framework owns state** → `update(patch)` or `update(reducer)` must merge
  or apply, so the framework needs to know the shape, and persistent widgets
  need a serialization contract anyway.
- **User owns state** → the widget holds no state at all, only a `render`
  closure that reads whatever the user has. Simpler, but then persistent
  widgets need somewhere else to keep their state for serialization.

### The fix

**Resolve to: the widget holds state, but `render()` receives it as an
argument and the framework never reads `widget.state` implicitly.**

```ts
interface Widget<S> {
    readonly id: string;
    render(state: S): RenderedContent | Promise<RenderedContent>;
    onAction?(action: string, ctx: ActionContext): void | Promise<void>;
}
```

- The widget does **not** expose `state` as a property at all. State lives in
  a closure the user controls, or in a `WidgetInstance<S>` that holds it.
- `update()` takes a full state value, not a patch:

  ```ts
  await widget.update(nextState);
  ```

  The user computes `nextState` however they like — `useState`-style
  reducer, plain mutation, an event-sourced store. The framework does not
  need to know the shape, and replacement is safe because `render` is called
  with the value passed to `update`, never with a stale copy.
- For **persistent** widgets, the framework needs the state to serialize it.
  So the persistent flavour adds a `serialize()` hook and the framework
  holds the current state value it was last given:

  ```ts
  interface PersistentWidget<S> extends Widget<S> {
      serialize(): unknown;          // JSON-serializable snapshot
      restore(data: unknown): S;      // rebuild state from a snapshot
  }
  ```

  The framework keeps the last state it was given for persistence purposes,
  and hands it back to `render()` on every call. One source of truth: the
  value the user passed to `update()`.

### Also update

The design's diagram shows `state ──▶ render() ──▶ ...` with `update()` as
the arrow into `state`. Under the fix, `update(nextState)` replaces the
state *and* triggers a render, so the diagram becomes:

```
   update(nextState) ──▶ state ──▶ render(state) ──▶ message
```

---

## F4: Widget tests must assert on request shape

**Severity: high. This is the testing strategy for the riskiest component.**

### The problem

The design says the widget engine gets "full test coverage", but does not say
what kind. Left undefined, this will be written as:

```ts
expect(mockRest.post).toHaveBeenCalled();
// or
expect(fakeMessage.edit).toHaveBeenCalled();
```

Such tests pass regardless of whether the framework called the *right*
endpoint. They encode the framework's own understanding, not Discord's
behaviour.

The specific trap: **the ephemeral edit path.** Editing an ephemeral message
must go to `PATCH /webhooks/{app_id}/{token}/messages/@original`. Editing a
channel message must go to `PATCH /channels/{channel_id}/messages/{message_id}`.
These are easy to confuse, and the mistake is invisible to a test that only
checks "an edit happened". In production it produces a 404 for ephemeral
messages and a silent no-op for channel ones.

The same class of bug: forgetting `flags: 64` for ephemeral, sending
`applicationId` where `interactionId` belongs, using `POST` where `PATCH` is
required.

### The fix

**The mock REST must assert on request shape**, and the test suite should
cover the paths explicitly.

The mock records requests as `{ method, route, body }`, where `route` is the
resolved Discord route (`/webhooks/{app_id}/{token}/messages/@original`), not
just the method. Then:

```ts
it('edits an ephemeral message through the webhook path', async () => {
    // ... deliver widget ephemerally, trigger an update ...

    expect(rest.requests).toContainEqual(
        expect.objectContaining({
            method: 'PATCH',
            route: '/webhooks/{application_id}/{interaction_token}/messages/@original',
        }),
    );
    expect(rest.requests).not.toContainEqual(
        expect.objectContaining({ route: expect.stringContaining('/channels/') }),
    );
});
```

**Required test cases** for the widget engine:

| Case | Asserts |
|---|---|
| Ephemeral delivery | `POST /interactions/{id}/{token}/callback` with `flags: 64` |
| Channel delivery | `POST /channels/{id}/messages` |
| Ephemeral update | `PATCH /webhooks/{app_id}/{token}/messages/@original` |
| Channel update | `PATCH /channels/{channel_id}/messages/{message_id}` |
| Deferred reply | callback type `5` (`DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE`) |
| Component update | callback type `7` (`UPDATE_MESSAGE`) |
| Ephemeral delete | `DELETE /webhooks/{app_id}/{token}/messages/@original` |
| Cold-start queue | interaction is deferred **before** the queue wait, not after |
| `custom_id` length | generated IDs never exceed 100 characters |
| Expired ephemeral | `update()` throws `MessageExpiredError`, makes no HTTP call |

**Additionally: fixture fidelity.** Hand-written interaction payloads will
encode *our* understanding of Discord's payloads. Where a payload field
matters (member roles, `app_permissions`, resolved entities), fixtures
should be taken from real captured payloads or from the documented shapes,
not invented. A fixture missing `member.roles` makes permission tests pass
while production breaks.

---

## F5: The design needs an invariants section

**Severity: medium. Cheap to fix, high leverage.**

### The problem

The design is ~850 lines. The facts most likely to be violated — and most
expensive to debug — are scattered across it, sometimes in different
subsections. The `bigint` requirement appears under Permissions and again
under Caching; the ephemeral/webhook rule appears under Interaction responses
and again under Rendering pipeline.

An implementer working on the widget engine might not encounter the
`bigint` rule for hours. A reader who knows the rules can spot violations
quickly; a reader who does not, cannot.

### The fix

Add an **Invariants** section near the top of `design.md`, immediately after
the goals. Short, numbered, and each one with a one-line rationale and a
pointer to where it is discussed in detail.

```markdown
## Invariants

These hold everywhere in the framework. Violating one is a bug that is
usually silent.

1. **Permission values are strings.** Discord v10 returns permission
   bitfields as decimal strings, and 64-bit values exceed
   `Number.MAX_SAFE_INTEGER`. Parse with `BigInt()`. Never use `Number`.
   → §Permissions

2. **Ephemeral messages are edited via the webhook path.** They are not
   addressable by channel + message ID. Use
   `api.interactions.editReply(appId, token, …)`, never
   `api.channels.editMessage`. → §Interaction responses

3. **An interaction must be acknowledged within 3 seconds.** Defer or reply
   immediately; do all slow work afterwards. → §Interaction responses

4. **Interaction tokens expire after 15 minutes.** Ephemeral messages cannot
   be edited beyond that point. → §Interaction responses

5. **`custom_id` is at most 100 characters.** The framework generates these;
   it must reject or truncate rather than let Discord reject the message.
   → §Custom ID scheme

6. **`allowed_mentions` defaults to suppressing `everyone`, `roles`, and
   `users`.** Rendering user-supplied content without opting in is a ping
   bug. → §Rendering pipeline

7. **The bot's global rate limit is 50 requests/second.** Interaction
   endpoints are exempt. Long-running work must not sit in the interaction
   path. → §Rate limits
```

Point 6 is new — the design mentions `allowed_mentions` defaults in the
rendering pipeline but never states it as a rule, and it is the kind of thing
that gets missed.

---

## F6: One Menu/Wizard class may become a mode flag

**Severity: medium. A design risk, not a current defect.**

### The problem

Decision 8 says Menu and Wizard become "configurations of one exported
class". The step models differ in more than configuration:

| | Menu | Wizard |
|---|---|---|
| Navigation | Linear, index-based chrome | Branching by `next` |
| Answer capture | None | `answers[stepId]` |
| Back behaviour | Previous page | Previous step, **clearing abandoned answers** |
| Completion | None | `onComplete` fires |

The design resolves this by giving `Step` optional members — `next?`,
`choices?` — so a Menu step simply omits them. That works, but it means the
class carries both code paths with runtime checks:

```ts
// illustrative, not proposed
if (this.mode === 'wizard') {
    this.answers[step.id] = value;
    if (step.next === undefined) await this.complete();
} else {
    this.pageIndex += 1;
}
```

Over time this accumulates: a `mode` flag, conditional branches in rendering,
in action handling, in back-navigation, in serialization. The design's own
decision 8 anticipates this ("if i see it get annoying i can make a factory
for both").

### The fix

**Keep one class, but make the difference structural rather than a flag.**
Two options, both compatible with the widget engine:

- **(a) Composition** — `Menu` and `Wizard` are separate *definitions* built
  on a shared `Flow` engine. The engine knows about steps and navigation;
  `Menu` and `Wizard` are thin builders that produce a definition. The
  public API is `new Menu(...)` / `new Wizard(...)` either way.
- **(b) Separate classes over a shared base** — an abstract `Flow` holds the
  step machinery; `Menu` and `Wizard` extend it and override navigation and
  answer capture.

Both avoid the mode flag. **(a) is probably better**, because it keeps
`Menu` and `Wizard` as *data* rather than classes, which composes more
cleanly with the widget model and keeps each one's surface small.

The fix to the design is mostly editorial: note that the two should be
separate definitions rather than one class with a mode, and leave the choice
between (a) and (b) to implementation.

---

## F7: The event router scope is undefined

**Severity: medium. Affects the size and shape of step 1.**

### The problem

The design says the event router "translates `GatewayDispatchEvents.*` into
typed, named events", and the caching section leans on it for invalidation
(`GUILD_ROLES_UPDATE`, `CHANNEL_UPDATE`, `GUILD_MEMBER_UPDATE`,
`GUILD_MEMBERS_CHUNK`).

`core`'s `MappedEvents` covers roughly **60 dispatch events**. Typing all of
them is a large chunk of work, and most of it would be typed against payloads
the framework never uses. More importantly, the cache invalidation story
depends on the router covering four specific events — so if the router is
built narrowly around "whatever is convenient" and those four are missing,
the cache silently serves stale permissions.

### The fix

**Scope the router explicitly, in two tiers.**

- **Tier 1 — the events the framework itself needs.** Defined as a closed
  list, not "whatever comes up":

  | Event | Used for |
  |---|---|
  | `InteractionCreate` | Routing every interaction |
  | `Ready` | Capturing `application.id`, `session_id`, shard count |
  | `GuildCreate` / `GuildDelete` | Cache priming and invalidation |
  | `GuildUpdate` | Cache invalidation |
  | `GuildRolesUpdate` | Cache invalidation |
  | `GuildMemberUpdate` | Cache invalidation |
  | `GuildMembersChunk` | Cache population |
  | `ChannelCreate` / `ChannelUpdate` / `ChannelDelete` | Cache invalidation |
  | `MessageCreate` | User-facing events |

- **Tier 2 — passthrough.** Everything else is re-emitted under its raw
  dispatch name with the raw payload, untyped. A user who wants
  `GUILD_BAN_ADD` gets it, without the framework having typed it.

The point: the framework types what it needs and passes the rest through
untouched, so the router's scope is bounded and the cache invalidation
events are guaranteed present rather than incidental.

**Also worth stating:** the design's cache invalidation table should become
a *requirement* on the router, not a description of what it happens to do.
"If the router does not emit `GUILD_ROLES_UPDATE`, the role cache does not
invalidate" is a bug, so those four events belong in Tier 1 by definition.

---

## F8: Persistent widgets should not hold a message object

**Severity: low. A simplification that removes a REST call and a stale-state
risk.**

### The problem

The current `Panel` implementation fetches the panel message at restore and
stores it on the panel (`panel.message = message`). The design's Panel
section says restoration should "re-bind messages" without saying what is
bound.

Holding a message object is a liability:

- It goes stale. The message may be edited or deleted by another client.
- It is a cache the framework does not need to maintain — and the framework
  has deliberately chosen to have no cache.
- In core there is no `Message` class to hold anyway, so this would be a raw
  `APIMessage` payload.

### The fix

**A persistent widget holds only identifiers.**

```ts
interface MessageTarget {
    readonly channelId: string;
    readonly messageId: string;
}
```

Editing a message needs only `channelId` + `messageId`, so no fetch is
required to edit. The widget does not need to know the message's current
content, because it renders from its own state.

The one place a fetch *is* needed is **restoration**, to confirm the message
still exists — the current implementation does this, and it is correct. That
fetch should be explicit and its result used only for validation, not
retained.

The design's Panel section should say this, since "re-bind messages" is
ambiguous in a way that invites reintroducing the object.

---

## F9: The design doc is long and hard to navigate

**Severity: low. Polish.**

### The problem

`design.md` is ~850 lines. It is thorough and well-factored, but it is a lot
to hold in mind, and it mixes three kinds of content:

1. **Facts about Discord and core** — reference material.
2. **Decisions** — the settled choices.
3. **Implementation detail** — how each module works.

(1) never changes and is worth keeping. (2) and (3) will change as
implementation reveals things.

### The fix

**Split into three documents, keeping `design.md` as the entry point:**

| Document | Contents | Stability |
|---|---|---|
| `design.md` | Goals, invariants, decisions table, roadmap, links | The entry point; changes most |
| `discord-notes.md` | Verified facts about the Discord API and `core` — payload shapes, endpoint semantics, limits, rate limits | Stable; a reference |
| `modules.md` | Per-module implementation detail | Changes most; written as each module is built |

`discord-notes.md` is the one worth extracting first, because it is the
material most likely to be consulted while writing code and least likely to
change. It also keeps the F5 invariants section honest, because the notes
will be where the underlying evidence lives.

---

## Summary of recommended order

1. **F2** first — the vertical spike. It may invalidate parts of the design,
   which is exactly why it should come before implementation.
2. **F3** and **F1** next — they are genuine ambiguities in the core model,
   and F1 is a correctness constraint that must shape the widget engine.
3. **F5** — cheap, and do it before anyone writes code against the design.
4. **F4** — write the mock REST with request-shape assertions *as part of*
   the widget engine, not after.
5. **F6**, **F7**, **F8**, **F9** — fold into implementation as each module
   is built.

### What actually happened

The implementation had already been built when this document was written, so
the order above could not be followed literally. The fixes were applied
afterwards, in the order the work turned out to depend on:

- **F3** and **F6** together, because the Menu/Wizard split changes the
  widget's state transitions and the state model changes what a transition
  returns. **F8** came with them: a persistent widget now holds only
  identifiers.
- **F4** next, because the mock transport had to record a route before the
  request-shape assertions could be written.
- **F1** on top of that, since the expired-message test needs the route
  assertions to be in place.
- **F7** after the event router was in place, because scoping it means
  moving it onto the gateway dispatch.
- **F2** last, because the slice is only meaningful once the framework it
  exercises exists — and it found two real problems: an interaction that a
  handler left unanswered, and a widget that had no way to be delivered.
- **F5** and **F9** were already applied to the design documents before the
  code was touched.

The dependency order held: the state model was settled before the tests were
written, and the tests were written before the expiry was implemented.

---

# Second pass: defects found in the implementation

The first nine items were found while reviewing the *design*. The items below
were found by reading the *implementation* once it existed, and each one was
reproduced with an executable test before being written down. The evidence in
each entry is the captured output of that test.

**Status: all open.** None of these have been fixed yet.

| ID | Severity | Area | Summary |
|---|---|---|---|
| [F10](#f10-buttons-without-a-style-render-an-invalid-payload) | **High** | `ui/render` | A button with no explicit `style` renders without the `style` field, which Discord requires. The message is rejected with a 400. |
| [F11](#f11-the-reserved-action-prefix-can-be-spoofed) | **High** | `ui/ids` | The reserved marker is only validated by the `button()`/`select()` helpers, so a hand-built spec can mint a custom id that impersonates a navigation action. |
| [F12](#f12-permissionbitfield-resolve-leaks-objectprototype-keys) | Medium | `permissions` | `resolve('constructor')` returns a function rather than a `bigint`, because the lookup uses `in` and therefore walks the prototype chain. |
| [F13](#f13-the-router-acknowledges-the-interaction-after-the-handler) | **High** | `ui/router` | The router defers *after* the handler runs, so a slow handler misses the three-second deadline. The spike notes state the opposite was intended. |
| [F14](#f14-required-options-of-sibling-subcommands-are-cross-checked) | **High** | `commands/args` | A command with two subcommands that each have a required option always throws, whichever subcommand was used. |
| [F15](#f15-required-options-nested-two-levels-deep-are-never-checked) | Medium | `commands/args` | Required options inside a subcommand inside a subcommand group are never enforced. |
| [F16](#f16-invalidateguild-leaves-the-guilds-cached-channels-behind) | **High** | `cache` | `invalidateGuild` does not clear the channel cache, so stale permission overwrites survive and channels leak. |
| [F17](#f17-invalidateguild-uses-a-member-key-that-is-never-written) | Medium | `cache` | `invalidateGuild` deletes `guildMember:{guildId}`, but members are stored as `guildMember:{guildId}:{userId}`. The deletion never matches. |
| [F18](#f18-getfocusedtrue-never-returns-the-focused-option) | Low | `commands/options` | `getFocused(true)` returns the bare value; the `getFull` parameter has no effect. |
| [F19](#f19-the-access-policy-does-not-cover-custom-actions) | **High** | `ui/menu` | The `access` policy is checked for navigation but not for custom action handlers, so anyone can trigger a step's own action. |
| [F20](#f20-register-accepts-a-missing-state-and-stores-undefined) | Medium | `ui/router` | `register(widget)` without a state stores `undefined`, which crashes later with an unrelated-looking error. |
| [F21](#f21-the-redis-store-uses-the-blocking-keys-command) | Medium | `store` | `RedisStore.keys()` issues Redis `KEYS`, which blocks the server, and the cache sweeps the whole keyspace on a timer. |

The proof tests used to produce the evidence below were scratch files. They are
reproduced inline so that each finding can be re-checked independently.

---

## F10: Buttons without a style render an invalid payload

**Severity: high. Every button created without an explicit style produces a
message Discord rejects.**

### The problem

`button()` makes `style` optional:

```ts
export function button(
    action: string,
    label: string,
    options: { readonly style?: ComponentButtonStyle; ... } = {},
): ButtonSpec
```

and `renderButton()` omits the field when it is absent:

```ts
return {
    type: ComponentType.Button,
    custom_id: customId,
    label: spec.label,
    ...(spec.style === undefined ? {} : { style: spec.style }),
    ...(spec.emoji === undefined ? {} : { emoji: toEmoji(spec.emoji) }),
    ...(spec.disabled === undefined ? {} : { disabled: spec.disabled }),
} as APIButtonComponent;
```

But Discord requires it. `APIButtonBase` declares `style: Style` as a
**required** field:

```ts
export interface APIButtonBase<Style extends ButtonStyle> {
    style: Style;
    disabled?: boolean;
}
```

The `as APIButtonComponent` cast hides the mismatch from the compiler — the
object literal is missing a required property, and the cast suppresses the
error rather than fixing it.

### Evidence

```
rendered button: {"type":2,"custom_id":"ui:widget1:act","label":"Press"}
has style? false
```

A message containing that button is rejected by Discord with a 400 for a
missing `style`.

### The fix

**Make `style` required in the framework's own types and give it a default.**

The natural default is `ButtonStyle.Primary` (value 1), which is what the
Discord documentation shows as the primary button style. Two changes:

1. `ButtonSpec.style` becomes required, and `button()` defaults it:

   ```ts
   export interface ButtonSpec {
       readonly type: 'button';
       readonly action: string;
       readonly label: string;
       readonly style: ComponentButtonStyle;   // no longer optional
       ...
   }
   ```

2. `renderButton()` always emits the field, and the `as APIButtonComponent`
   cast can be dropped:

   ```ts
   return {
       type: ComponentType.Button,
       custom_id: customId,
       label: spec.label,
       style: spec.style,
       ...(spec.emoji === undefined ? {} : { emoji: toEmoji(spec.emoji) }),
       ...(spec.disabled === undefined ? {} : { disabled: spec.disabled }),
   };
   ```

The same cast appears in `renderSelect()`; it should be checked for the same
class of problem.

---

## F11: The reserved action prefix can be spoofed

**Severity: high. The design states the split "cannot be spoofed"; it can.**

### The problem

The design's action scheme relies on a reserved marker (`~`) that "cannot
appear in a user-defined action, so the split between the reserved part and
the user part is unambiguous and cannot be spoofed."

The marker is validated in exactly one place — the convenience helpers:

```ts
export function button(action: string, label: string, options = {}): ButtonSpec {
    assertValidAction(action);
    ...
}
```

But `ButtonSpec` and `SelectSpec` are plain interfaces, so a user can write
the object literal directly. `renderButton()` then calls `createCustomId()`,
which validates the namespace and the widget id but **not** the action:

```ts
export function createCustomId(namespace, widgetId, action): string {
    assertValidNamespace(namespace);
    // widget id checked
    const customId = `${namespace}:${widgetId}:${action}`;
    ...
}
```

The result is a custom id whose action segment starts with the reserved
marker. On the way back in, `splitAction()` treats it as reserved and routes
it to `onNavigation` instead of `onAction`.

### Evidence

```
spoofed custom id: ui:widget1:~spoofed
navigation calls: 1
action calls: 0
```

The user's action never reaches their own handler; it is silently
reinterpreted as framework navigation.

### The fix

**Validate the action at the point where the custom id is minted**, not only
in the convenience helper. `createCustomId()` is the single choke point every
framework-rendered component passes through, so the check belongs there:

```ts
export function createCustomId(namespace, widgetId, action): string {
    assertValidNamespace(namespace);
    // ... widget id checks ...

    assertValidAction(action);   // <-- add

    const customId = `${namespace}:${widgetId}:${action}`;
    ...
}
```

`assertValidAction` must accept the reserved form as well, since the
framework itself mints `~next`, `~previous` and so on. The simplest rule is
that an action may contain the marker **only** as its first character:

```ts
export function assertValidAction(action: string): void {
    if (typeof action !== 'string' || action.length === 0) {
        throw new TypeError('Action must be a non-empty string.');
    }

    if (action.includes(RESERVED_ACTION_PREFIX)) {
        // The framework reserves a leading marker; a user action may not
        // contain one anywhere, because a hand-built spec bypasses the
        // helper that checks it.
        throw new TypeError(...);
    }
}
```

That keeps the rule in one place and makes it impossible to bypass by
constructing a spec literal.

---

## F12: `PermissionsBitField.resolve` leaks `Object.prototype` keys

**Severity: medium. A user-supplied permission name can produce a
non-`bigint` bitfield.**

### The problem

`resolve()` looks a string up in the flags table with `in`:

```ts
if (typeof permission === 'string') {
    if (permission in PermissionFlagsBits) {
        return PermissionFlagsBits[permission as keyof typeof PermissionFlagsBits];
    }
    return parsePermissions(permission);
}
```

`in` walks the prototype chain, and `PermissionFlagsBits` is a plain object
literal, so every `Object.prototype` member matches. `'constructor'`,
`'toString'`, `'valueOf'` and `'hasOwnProperty'` all satisfy the check and
resolve to a *function* rather than a permission bit.

The result is a `PermissionsBitField` whose `bits` is a function, and every
bitwise operation on it then throws.

### Evidence

```
typeof resolve("constructor"): function
typeof field.bitfield: function
constructor -> function
toString -> function
valueOf -> function
hasOwnProperty -> function
```

and `new PermissionsBitField('constructor').has('SendMessages')` throws
`TypeError: Cannot mix BigInt and other types`.

### The fix

**Use `Object.hasOwn` instead of `in`.** It checks own properties only, so
prototype members no longer match:

```ts
if (typeof permission === 'string') {
    if (Object.hasOwn(PermissionFlagsBits, permission)) {
        return PermissionFlagsBits[permission as keyof typeof PermissionFlagsBits];
    }
    return parsePermissions(permission);
}
```

`Object.hasOwn` is available from Node 16.9, and the framework targets
Node 20.

The same `in`-on-a-plain-object pattern should be checked elsewhere in the
codebase.

---

## F13: The router acknowledges the interaction after the handler

**Severity: high. A handler that takes more than three seconds fails, and
the framework cannot tell the user why.**

### The problem

The spike notes record the intended behaviour explicitly:

> The widget engine has to defer before it dispatches. The first draft
> deferred inside the menu's transition, which meant a custom widget could
> forget to. **Deferring in the router, before the action handler runs, is
> the only place it cannot be forgotten.**

The router does the opposite. `dispatch()` runs the handler first and only
then acknowledges:

```ts
try {
    const { reserved, name } = splitAction(action);

    if (reserved) {
        await registration.widget.onNavigation?.(name, context);
    } else {
        await registration.widget.onAction?.(action, context);
    }
} catch (error) {
    await safeReply(interaction, 'Something went wrong while handling that action.');
    throw error;
}

await acknowledgeIfNeeded(interaction);   // <-- after the handler
```

`Flow.onNavigation()` does defer first, so menus and wizards are protected —
but only because the subclass remembers to. `Flow.onAction()` does not defer
at all, and a custom widget registered directly with the router never gets a
deferral. The guarantee the spike identified as "the only place it cannot be
forgotten" is therefore not in place.

### Evidence

```
responded while handler ran: false
requests: [ 'POST /interactions/{interaction_id}/{interaction_token}/callback' ]
```

The interaction was still unacknowledged while the handler ran.

### The fix

**Defer in the router, before dispatching**, and drop the now-redundant
defer from `Flow.onNavigation()`:

```ts
private async dispatch(registration, action, interaction): Promise<void> {
    // Acknowledge first: the interaction token is only valid for three
    // seconds, and the handler may take longer than that.
    await acknowledgeIfNeeded(interaction);

    const context = { ... };

    try {
        const { reserved, name } = splitAction(action);
        if (reserved) {
            await registration.widget.onNavigation?.(name, context);
        } else {
            await registration.widget.onAction?.(action, context);
        }
    } catch (error) {
        await safeReply(interaction, 'Something went wrong while handling that action.');
        throw error;
    }
}
```

`acknowledgeIfNeeded` already checks `interaction.responded`, so a handler
that wants to reply itself is unaffected — the router simply acknowledges
first when the handler has not.

`Flow.onNavigation()`'s own `deferUpdate()` becomes redundant but harmless;
it can stay or be removed.

---

## F14: Required options of sibling subcommands are cross-checked

**Severity: high. Any command with two subcommands that each declare a
required option is completely unusable.**

### The problem

`collectRequired()` gathers required options from the whole schema tree
without regard to which subcommand was invoked:

```ts
function collectRequired(schema: CommandSchema): OptionSchema[] {
    const required: OptionSchema[] = [];

    for (const option of schema.options) {
        if (option.required) required.push(option);
        if (option.options) {
            for (const nested of option.options) {
                if (nested.required) required.push(nested);
            }
        }
    }

    return required;
}
```

`resolveArgs()` then requires *all* of them to be present:

```ts
for (const option of collectRequired(schema)) {
    if (!(option.name in args)) {
        throw new Error(`Required option "${option.name}" is missing for command "${schema.name}".`);
    }
}
```

`args` only contains the options of the subcommand that was actually
invoked, so the required options of the *other* subcommand are always
missing.

### Evidence

A command with two subcommands, `add` (requires `url`) and `remove`
(requires `id`):

```
thrown: Required option "id" is missing for command "test".
```

The user invoked `add` and supplied `url`. The framework demanded `id`,
which belongs to `remove`. The command can never succeed.

### The fix

**Only require the options of the subcommand that was invoked.**

The resolver already knows which subcommand was used — `CommandOptionResolver`
exposes `getSubcommand()` and `leafOptions`. The required check should be
scoped to the same subtree the arguments came from.

The cleanest fix is to derive the required set from the *invoked* path rather
than the whole schema:

```ts
function collectRequiredFor(schema: CommandSchema, options: CommandOptionResolver): OptionSchema[] {
    // Walk the schema alongside the resolver's hoisted subcommand so that
    // only the invoked branch contributes required options.
}
```

Concretely: find the schema node matching `options.getSubcommand()`, then
collect its required options (recursively, which also fixes F15).

---

## F15: Required options nested two levels deep are never checked

**Severity: medium. The required check is silently skipped for the deepest
nesting level.**

### The problem

`collectRequired()` walks exactly two levels: `schema.options`, then
`option.options`. A subcommand group contains subcommands, which contain
options:

```
schema.options[0]           = subcommand group
schema.options[0].options[0] = subcommand
schema.options[0].options[0].options[0] = the actual option   <-- never reached
```

So a required option inside a group is never collected, and never checked.

Note the inconsistency with `findSchemaOption()`, which recurses without
limit — the same file resolves options to arbitrary depth but validates
requiredness to two.

### Evidence

A group containing a subcommand `run` with a required option `target`,
invoked with that option missing:

```
leaf option names: []
args: {}
thrown: undefined
```

No error. The command ran without its required argument.

### The fix

The same fix as F14: collect the required options from the invoked branch,
recursively. `findSchemaOption()` already shows the recursive pattern to
follow.

---

## F16: `invalidateGuild` leaves the guild's cached channels behind

**Severity: high. Stale permission overwrites survive, and channels leak.**

### The problem

`invalidateGuild()` deletes three keys:

```ts
public async invalidateGuild(guildId: string): Promise<void> {
    await this.store.delete(this.key('roles', guildId));
    await this.store.delete(this.key('guild', guildId));
    await this.store.delete(this.key('guildMember', guildId));
}
```

The `channel` kind is **not** among them — and `channel` is one of the two
kinds enabled by default:

```ts
export const MINIMAL_TIER_KINDS: readonly CacheKind[] = ['roles', 'channel'];
```

Channel entries hold the `permission_overwrites` that permission resolution
depends on. Because channels are keyed by channel id rather than guild id,
there is no way to enumerate "the channels of guild X" from the cache keys,
so `invalidateGuild` cannot clear them.

The consequences:

- `guildDelete` leaves the departed guild's channels cached forever — the
  `channel` kind has no TTL, so they are never reclaimed.
- `guildUpdate` and the role events leave stale `permission_overwrites` in
  place, which permission resolution will keep reading.

### Evidence

```
roles after invalidate: undefined
channel after invalidate: {"id":"channel-1","permission_overwrites":[]}
```

The role entry was cleared; the channel entry survived.

### The fix

**Track which channels belong to which guild**, so that a guild
invalidation can reach them.

The cache already keeps a per-kind index for messages (`messageKeys`). The
same approach works for channels: index channel ids by guild id when a
channel is written, and delete the whole set on guild invalidation.

```ts
private readonly guildChannels = new Map<string, Set<string>>();

// in set(), for kind === 'channel':
//   record the channel id under the channel's guild id

// in invalidateGuild():
for (const channelId of this.guildChannels.get(guildId) ?? []) {
    await this.store.delete(this.key('channel', channelId));
}
this.guildChannels.delete(guildId);
```

The channel payload contains `guild_id`, so the mapping is available at write
time.

---

## F17: `invalidateGuild` uses a member key that is never written

**Severity: medium. Guild members are never cleared by a guild invalidation.**

### The problem

Two different key formats are used for the same kind.

`invalidateGuild()` deletes `guildMember:{guildId}`:

```ts
await this.store.delete(this.key('guildMember', guildId));
```

but the invalidation listeners — and any caller — use
`guildMember:{guildId}:{userId}`:

```ts
on('guildMemberUpdate', (event) => {
    void cache.delete('guildMember', `${event.guildId}:${event.userId}`);
});
```

`Cache.set()` builds the key as `${kind}:${id}`, so a member stored with the
id `guild-1:user-1` lives at `guildMember:guild-1:user-1`. The key
`guildMember:guild-1` is never written, so the deletion never matches
anything.

`guildMembersChunk` calls `invalidateGuild()`, intending to clear the
guild's members. It does not.

### Evidence

```
member 1 after invalidate: {"user":{"id":"user-1"}}
member 2 after invalidate: {"user":{"id":"user-2"}}
```

Both members survived.

### The fix

**Pick one key format and use it everywhere.**

The natural choice is the one the listeners already use,
`guildMember:{guildId}:{userId}`, which means `invalidateGuild` must delete
*all* members of the guild — which needs the same guild→members index that
F16 needs for channels.

Both fixes therefore want the same piece of machinery: **a guild→entries
index**, maintained per kind. It is worth building once:

```ts
private readonly guildIndex = new Map<string, Map<CacheKind, Set<string>>>();
```

---

## F18: `getFocused(true)` never returns the focused option

**Severity: low. The `getFull` parameter has no effect.**

### The problem

The resolver looks for a `choices` array on the focused option:

```ts
const choice = focused.options?.find(
    (option) => option.value === focused.value,
);

return choice ?? focused.value;
```

But the focused option in an autocomplete payload is
`{ name, type, value }` — it has no `options` array. The `options` array
holds the *declared* choices of the command option, not the focused one.

So `choice` is always `undefined`, and `getFocused(true)` returns
`focused.value` — a string — exactly as `getFocused(false)` does.

### Evidence

```
getFocused(): "search"
getFocused(true): "search"
typeof getFocused(true): string has name? false
```

The documented contract is "Whether the full choice object is returned". It
never is.

### The fix

**Return the focused option itself**, which is the object that carries
`name`, `type` and `value`:

```ts
public getFocused(getFull = false): string | CommandDataOption | null {
    if (!this.focused) {
        return null;
    }

    return getFull ? this.focused : (this.focused as { value: string }).value;
}
```

The `getFull` return type should be `CommandDataOption` rather than
`APIApplicationCommandOptionChoice`, because the focused option is not a
choice.

---

## F19: The access policy does not cover custom actions

**Severity: high. The `access` policy is a security control, and it does not
apply to the buttons it is supposed to protect.**

### The problem

`Flow` checks the access policy in `onNavigation()`:

```ts
public async onNavigation(action, context): Promise<void> {
    if (!(await this.canInteract(context.interaction))) {
        await this.denyAccess(context.interaction);
        return;
    }
    ...
}
```

but `onAction()` does not:

```ts
public async onAction(action, context): Promise<void> {
    const step = this.stepOf(context.state.currentStepId);

    if (!step.onAction) {
        return;
    }

    await step.onAction(action, this.context(context.state, context.interaction));
}
```

So the built-in navigation chrome is protected by `access`, while the
step's **own custom action buttons** are not. A user who is not the owner can
press any custom button on the menu.

This is exactly the case the access policy exists for: a custom button is
usually the one that mutates state.

### Evidence

A menu with `access: { type: 'caller-only' }`, owned by `owner-1`, with a
custom action handler. The interaction comes from `intruder-1`:

```
custom action ran for a non-owner: true
current step after a denied navigation: one
```

The custom action ran for the intruder. The navigation action was correctly
denied — the state did not advance past `one`.

### The fix

**Check the access policy in `onAction()` as well.**

```ts
public async onAction(action, context): Promise<void> {
    if (!(await this.canInteract(context.interaction))) {
        await this.denyAccess(context.interaction);
        return;
    }

    const step = this.stepOf(context.state.currentStepId);
    ...
}
```

Better still, move the check into the **router**, so that the policy applies
to every widget uniformly rather than to the two entry points of `Flow` — a
custom widget registered directly with the router currently has no access
control at all.

---

## F20: `register()` accepts a missing state and stores `undefined`

**Severity: medium. The failure surfaces far from its cause.**

### The problem

`WidgetRouter.register()` takes the state as an optional parameter:

```ts
public async register<S>(
    widget: Widget<S>,
    target: MessageTarget | null = null,
    state: S | undefined = undefined,
): Promise<void> {
    this.widgets.set(widget.routingId, {
        widget,
        state: state as S,
        target,
    });
```

Registering a widget without a state stores `undefined`. The widget's
`render(state)` then receives `undefined`, and any code that reads a
property of it throws.

The `state as S` cast hides the mismatch from the compiler.

### Evidence

Registering a `Menu` without a state and dispatching an action to it:

```
TypeError: Cannot read properties of undefined (reading 'currentStepId')
 ❯ Menu.onAction src/ui/menu/Flow.ts:206:48
 ❯ WidgetRouter.dispatch src/ui/router.ts:396:43
```

The error points at the menu's action handler, but the cause was the
registration.

### The fix

**Make the state required.** A widget always has state — that is the
definition of the model — so the parameter should not be optional:

```ts
public async register<S>(
    widget: Widget<S>,
    state: S,
    target: MessageTarget | null = null,
): Promise<void> {
```

Reordering the parameters so `state` comes before the optional `target`
avoids a breaking change for callers that pass all three, and makes the
mistake a compile error rather than a runtime one.

---

## F21: The Redis store uses the blocking `KEYS` command

**Severity: medium. A production hazard on a shared Redis instance.**

### The problem

`RedisStore.keys()` issues the Redis `KEYS` command:

```ts
async keys(): Promise<string[]> {
    const keys = await this.client.keys(`${this.prefix}*`);
    return keys.map((key) => key.slice(this.prefix.length));
}
```

`KEYS` is O(N) over the entire keyspace and **blocks the Redis server** for
the duration of the scan. Redis's own documentation warns against it in
favour of `SCAN`, which is cursor-based and non-blocking.

The cache calls it on a timer. `Cache.sweep()` runs every hour by default:

```ts
for (const key of await this.store.keys()) {
    const raw = await this.store.get(key);
    ...
}
```

That is one blocking `KEYS` over the whole keyspace, plus one `GET` per
key, every hour — against a Redis server that may be shared with other
services. `Cache.clear(kind)` has the same shape.

### The fix

**Use `SCAN`.**

The `Store` interface's `keys()` method forces a full listing, which is the
wrong shape for a large keyspace. It should become a cursor:

```ts
export interface Store<TValue = unknown> {
    ...
    /**
     * Lists keys in batches, using a cursor.
     */
    scan(cursor: string): Promise<{ keys: string[]; cursor: string }>;
}
```

and `RedisStore` implements it with `SCAN`/`MATCH`/`COUNT`, which never
blocks the server.

For stores that genuinely cannot scan incrementally — the in-memory one — the
method can be implemented trivially.

The cache's `sweep()` then walks the cursor rather than materialising every
key at once, which also removes the N+1 round trips.

---

## Summary

The order in which these should be fixed:

1. **F10** — a button without a style produces a message Discord rejects.
   Any user of `button()` without an explicit style hits it immediately.
2. **F19** — the access policy does not cover custom actions. This is a
   security control that does not do what it says.
3. **F14** — a command with two subcommands that each have a required option
   can never be invoked.
4. **F13** — the router acknowledges after the handler, defeating the
   three-second deadline guarantee the spike identified.
5. **F16** and **F17** — together, since both need the guild→entries index.
6. **F11**, **F12**, **F15**, **F18**, **F20** — independent and small.
7. **F21** — a production concern for anyone using a shared Redis.

F10, F13, F14, F19 and F20 are all cases where a cast (`as APIButtonComponent`,
`state as S`) or an optional parameter hid a real problem from the compiler.
That is the common thread, and it is worth a general look at where the
codebase casts past the type system.
