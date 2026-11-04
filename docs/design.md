# Framework Design

Status: **implemented.** Codename: **TBDBot** (a pun on the name
being TBD). The package is renamed from `@my-lib/utils` to
`.../framework` when it is ready to be published; `tbd-bot` and `tbdframework`
are both available on npm.

This is the entry point. The other documents hold the detail:

| Document | Contents | Stability |
|---|---|---|
| **this file** | Goals, invariants, the decisions table, the roadmap | Changes most |
| [`discord-notes.md`](./discord-notes.md) | Verified facts about the Discord API and `@discordjs/core` | Stable; a reference |
| [`modules.md`](./modules.md) | Per-module implementation detail | Changes most |
| [`spike-notes.md`](./spike-notes.md) | The answers to the integration questions unit tests cannot answer | Stable; a reference |
| [`fixes.md`](./fixes.md) | The problems found in this design after the fact, and what was done about each; plus a second pass of defects found in the implementation | Historical for F1–F9; **open** for F10–F21 |

A second pass over the implementation found twelve further defects, recorded
as F10–F21 in
[`fixes.md` § Second pass](./fixes.md#second-pass-defects-found-in-the-implementation).
Several of them contradict rules stated in this document — the access policy
does not cover custom actions (F19), and the router acknowledges an
interaction after the handler rather than before it (F13).

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

## Invariants

These hold everywhere in the framework. Violating one is a bug that is
usually silent, so they are worth internalising before writing any code.

1. **Permission values are strings.** Discord v10 returns permission
   bitfields as decimal strings, and 64-bit values exceed
   `Number.MAX_SAFE_INTEGER`. Parse with `BigInt()`. Never use `Number`.
   → [Permissions](./discord-notes.md#permissions)

2. **Ephemeral messages are edited via the webhook path.** They are not
   addressable by channel + message ID. Use
   `api.interactions.editReply(appId, token, …)`, never
   `api.channels.editMessage`.
   → [Interaction responses](./discord-notes.md#interaction-responses)

3. **An interaction must be acknowledged within 3 seconds.** Defer or reply
   immediately and do all slow work afterwards.
   → [Interaction responses](./discord-notes.md#interaction-responses)

4. **Interaction tokens expire after 15 minutes.** An ephemeral message
   cannot be edited beyond that point. This bounds the widget engine's
   "update from anywhere" promise — see
   [F1](./fixes.md#f1-ephemeral-messages-have-a-15-minute-edit-window).

5. **`custom_id` is at most 100 characters.** The framework generates these,
   so it must reject or truncate rather than let Discord reject the message.
   → [Custom ID scheme](./modules.md#custom-id-scheme)

6. **`allowed_mentions` defaults to suppressing `everyone`, `roles`, and
   `users`.** Rendering user-supplied content without opting in is a ping
   bug.
   → [Rendering pipeline](./modules.md#rendering-pipeline)

7. **The bot's global rate limit is 50 requests/second.** Interaction
   endpoints are exempt from it. Long-running work must not sit in the
   interaction path.
   → [Rate limits](./discord-notes.md#rate-limits)

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
| 6 | Menu and Wizard share one step model | The steps are the same; only the traversal differs |
| 7 | Menus become dynamic (`render()` instead of static `embed`) | Needed for live/derived content; enables the unified step model |
| 8 | Menu and Wizard are separate classes over a shared `Flow` base | **Superseded.** One exported class with a mode flag was the original choice; [F6](./fixes.md#f6-one-menuwizard-class-may-become-a-mode-flag) showed the flag spreading through rendering, action handling, back-navigation and serialization. The public API is `new Menu(...)` and `new Wizard(...)` either way. |
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

## Roadmap

Ordered by dependency and by risk. The widget engine is deliberately early:
it is the piece most likely to be wrong, and everything else builds on it.
The permission module is early for a different reason — it is self-contained,
has a hard `bigint` requirement, and is needed by the command middleware.

**Step 0 is a vertical slice** — see
[F2](./fixes.md#f2-no-vertical-slice-in-the-roadmap). It is an end-to-end path
against the real Discord API, whose purpose is to answer the integration
questions that unit tests cannot. The abstractions in steps 1–3 are extracted
from it rather than designed ahead of it.

The slice is [`examples/vertical-slice.ts`](../examples/vertical-slice.ts),
and the write-up is [`spike-notes.md`](./spike-notes.md).

| # | Step | Notes |
|---|---|---|
| 0 | **Vertical slice** | Connect, register one command, respond, edit, add a button, handle the click, edit again — plus a short write-up of what was learned. |
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
| 0. Vertical slice | `examples/vertical-slice.ts`, `docs/spike-notes.md` |
| 1. Foundation | `src/core`, `src/api`, `src/interaction` |
| 2. Permissions | `src/permissions` |
| 3. Widget engine | `src/ui` (`ids`, `render`, `router`, `messages`, `errors`) |
| 4. Menu / Wizard | `src/ui/menu` (`Flow`, `Menu`, `Wizard`) |
| 5. Panel | `src/ui/panel` |
| 6. Commands + middleware | `src/commands` |
| 7. Cache | `src/cache` |
| 8. Config | `src/config` |
| 9. Metrics | `src/metrics` |
| 10. Modals | `src/ui/modal` |
| 11. Stores | `src/store` (including the Redis implementation) |
| 12. Testing utilities | `src/testing` |

Three decisions were settled during implementation, and all three follow from
the rules already stated above:

- **The reserved action marker is `~`.** It is a character that cannot
  appear in a user-defined action, so the split between the reserved part and
  the user part is unambiguous and cannot be spoofed. Only the first two
  separators of a custom id are significant, so a user's action may contain
  `:` freely.
- **The derived schema is validated at registration time.** A command whose
  options are malformed fails at boot rather than when a user invokes it.
- **The framework holds the widget state.** See
  [F3](./fixes.md#f3-widget-state-ownership-is-contradictory): the widget
  receives the state as an argument, so replacing it is always safe.

The `defineCommand()` helper and the typed-schema builder variant recorded in
the open questions are still out of scope: the schema infrastructure they
would need is in place, but they are not required to ship a usable
framework.

---

## Open questions

All of the previously open questions are now resolved and folded into the
design above and in [`modules.md`](./modules.md). The remaining items are
small enough to settle as they are encountered during implementation:

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


---

## Fixes applied

The problems found in this design after it was written are recorded in
[`fixes.md`](./fixes.md). Each one has been applied; the notes below say
where it landed.

| ID | Applied as |
|---|---|
| [F1](./fixes.md#f1-ephemeral-messages-have-a-15-minute-edit-window) | A message target records its expiry, and updating an expired message throws `MessageExpiredError` before any HTTP request is made. See [Modules → Interactive UI](./modules.md#interactive-ui). |
| [F2](./fixes.md#f2-no-vertical-slice-in-the-roadmap) | `examples/vertical-slice.ts` is the runnable end-to-end path, and [`spike-notes.md`](./spike-notes.md) is the write-up. |
| [F3](./fixes.md#f3-widget-state-ownership-is-contradictory) | The framework holds the state; `render(state)` receives it and `update(nextState)` replaces it. See [Modules → State ownership](./modules.md#state-ownership). |
| [F4](./fixes.md#f4-widget-tests-must-assert-on-request-shape) | The mock transport records the route template of every request, and the widget tests assert on the route. |
| [F5](./fixes.md#f5-the-design-needs-an-invariants-section) | The [Invariants](#invariants) section below. |
| [F6](./fixes.md#f6-one-menuwizard-class-may-become-a-mode-flag) | `Menu` and `Wizard` are separate classes over a shared `Flow` base. See [Modules → Menu and Wizard](./modules.md#menu-and-wizard). |
| [F7](./fixes.md#f7-the-event-router-scope-is-undefined) | The router has two tiers: a closed list of typed events, and a raw passthrough for everything else. See [Modules → Event router](./modules.md#event-router). |
| [F8](./fixes.md#f8-persistent-widgets-should-not-hold-a-message-object) | A persistent widget holds only identifiers. See [Modules → Panel](./modules.md#panel). |
| [F9](./fixes.md#f9-design-doc-is-long-and-hard-to-navigate) | This document is the entry point; the detail lives in [`discord-notes.md`](./discord-notes.md) and [`modules.md`](./modules.md). |
