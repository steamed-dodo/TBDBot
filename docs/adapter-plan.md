# Framework and Adapter Plan

This document outlines a plan to evolve `@my-lib/utils` from a Discord.js utility library into a full Discord bot framework built on `@discordjs/core`, while keeping the current public APIs usable during the transition.

## Long-term vision

- A framework, not just utilities: command registration, event routing, configuration, and lifecycle management.
- Built on `@discordjs/core` + `@discordjs/rest` + `@discordjs/ws` for performance and control.
- Public APIs (Menu, Panel, Wizard) remain stable; internals move to core-based implementations.

## Transition strategy

The discord.js adapter is an **internal** implementation detail, not a public API. It exists only to let Menu/Panel/Wizard keep working while the framework migrates. Consumers never interact with it directly.

## Current discord.js usage

Audited from `src/`:

- **Menu** (`src/menu/Menu.ts`, `src/menu/types.ts`): message editing/deletion, component collectors, button/select builders, interaction replies/defers, webhooks, embeds, text channels.
- **Wizard** (`src/wizard/Wizard.ts`, `src/wizard/types.ts`): same delivery/controller patterns plus interaction fetch replies.
- **Panel** (`src/panel/Panel.ts`, `src/panel/PanelManager.ts`, `src/panel/types.ts`): client, interactions, messages, channels, message components, embeds.

## Proposed internal adapter interface

Create `src/adapter/DiscordAdapter.ts`:

```ts
export interface DiscordAdapter {
    // Messages
    sendMessage(channel: ChannelHandle, options: MessageOptions): Promise<MessageHandle>;
    editMessage(message: MessageHandle, options: MessageOptions): Promise<MessageHandle>;
    deleteMessage(message: MessageHandle): Promise<void>;

    // Interactions
    reply(interaction: InteractionHandle, options: ReplyOptions): Promise<MessageHandle>;
    editReply(interaction: InteractionHandle, options: MessageOptions): Promise<MessageHandle>;
    deferUpdate(interaction: InteractionHandle): Promise<void>;
    fetchReply(interaction: InteractionHandle): Promise<MessageHandle>;

    // Collectors
    createComponentCollector(
        message: MessageHandle,
        options: CollectorOptions,
    ): ComponentCollector;

    // Handles are opaque tokens; adapters map them to native objects.
}
```

Handles (`MessageHandle`, `InteractionHandle`, `ChannelHandle`) are opaque strings or branded objects so core code never touches native Discord objects.

## Migration order

1. **Define the interface** and a `DiscordJsAdapter` implementation behind it. No behavior changes.
2. **Refactor Menu delivery** (`reply`, `followUp`, `send`, `setPage`, interactions) to use the adapter.
3. **Refactor Wizard delivery** similarly.
4. **Refactor PanelManager** to use the adapter for sending, editing, restoring, and routing interactions.
5. **Add a `DiscordJsCoreAdapter`** implementing the same interface.
6. **Update testbot** to select an adapter via configuration.

## Rollback points

- Each step is a separate commit.
- The discord.js adapter remains the default until the core adapter passes the full test suite.
- Public APIs (Menu, Panel, Wizard constructors) stay unchanged; only internal delivery changes.

## Risks

- Component collectors in `@discordjs/core` require manual gateway handling; the adapter must hide this.
- Interaction webhooks and ephemeral replies differ between backends.
- Embed/component builders may need adapter-specific conversion.

## Open questions

- Should handles be branded objects or strings?
- Should the adapter own component builders, or should builders stay in the library?
- How to expose adapter selection to consumers (constructor option vs. global config)?

## Framework features (future)

- **Command framework**: declarative command definitions, permission checks, and automatic registration.
- **Event router**: typed event handlers with middleware.
- **Configuration**: validated, environment-aware config (already partially present in testbot).
- **Persistence**: pluggable stores (memory, JSON, database) for panels and framework state.
- **Observability**: structured logging and metrics hooks.
- **Testing utilities**: mock adapters and interaction factories for unit tests.

## Phased rollout

1. Internal adapter interface + discord.js implementation (no public changes).
2. Migrate Menu, Wizard, Panel to the adapter.
3. Add core adapter and switch testbot to it.
4. Introduce framework-level command/event/config features on top of the core adapter.
5. Deprecate discord.js peer dependency once core adapter reaches parity.
