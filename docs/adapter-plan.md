# Adapter Layer Plan

This document outlines a plan to decouple `@my-lib/utils` from `discord.js` so the library can eventually support `@discordjs/core` (and other backends) without rewriting Menu, Panel, and Wizard.

## Goal

Introduce an adapter interface that captures the Discord operations the library actually needs. discord.js remains the default adapter; a core adapter can be added later without changing public APIs.

## Current discord.js usage

Audited from `src/`:

- **Menu** (`src/menu/Menu.ts`, `src/menu/types.ts`): message editing/deletion, component collectors, button/select builders, interaction replies/defers, webhooks, embeds, text channels.
- **Wizard** (`src/wizard/Wizard.ts`, `src/wizard/types.ts`): same delivery/controller patterns plus interaction fetch replies.
- **Panel** (`src/panel/Panel.ts`, `src/panel/PanelManager.ts`, `src/panel/types.ts`): client, interactions, messages, channels, message components, embeds.

## Proposed adapter interface

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
