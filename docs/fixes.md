# Fixes and Touchups

Companion to [`design.md`](./design.md). This document lists the problems
found in the design after it was written, and what to do about each one.

Nothing here contradicts the design's decisions. These are gaps, ambiguities,
and sequencing problems — the kind that are cheap to fix in a document and
expensive to fix in code.

**Status of each item:**

All nine items have been applied. The commit that applied each one is named
in the table, and the design documents record where it landed — see
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
