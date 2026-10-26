import type {
    EmbedBuilder,
    ActionRow,
    MessageActionRowComponent,
    MessageComponentInteraction,
    MessageCreateOptions,
    InteractionReplyOptions,
    InteractionEditReplyOptions,
} from 'discord.js';
import type { Menu } from './Menu';

/**
 * Represents a single page within a {@link Menu}.
 *
 * A page consists of an embed, optional interactive components, and an
 * optional interaction handler. Pages are displayed in the order in which
 * they are supplied to the menu.
 */
export interface MenuPage {
    /** Unique name identifying the page within its menu. */
    readonly name: string;

    /** Embed displayed when this page is active. */
    readonly embed: EmbedBuilder;

    /**
     * Optional custom component rows displayed alongside the page.
     *
     * A maximum of four custom rows is permitted because the menu reserves
     * one additional row for its built-in navigation buttons.
     */
    readonly components?: readonly ActionRow<MessageActionRowComponent>[];

    /**
     * Handles interactions originating from this page's custom components.
     *
     * The handler is responsible for acknowledging the interaction, for
     * example by replying, deferring, updating the message, or opening a modal.
     *
     * This handler is not invoked for the menu's built-in navigation buttons.
     *
     * @param interaction - The component interaction to handle.
     * @param menu - The menu instance associated with the interaction.
     * @returns A promise that resolves when the handler has finished, or
     *          nothing if the handler completes synchronously.
     */
    readonly onInteraction?: (
        interaction: MessageComponentInteraction,
        menu: Menu,
    ) => void | Promise<void>;
}

/**
 * Configuration options used to construct a {@link Menu}.
 */
export interface MenuOptions {
    /** Discord user ID of the menu's owner. */
    readonly userId: string;

    /**
     * Pages available in the menu, in display order.
     *
     * Must contain at least one page. Page names must be non-empty and unique.
     */
    readonly pages: readonly MenuPage[];

    /**
     * Maximum duration of the component collector, in milliseconds.
     *
     * @defaultValue 180000
     */
    readonly timeout?: number;

    /**
     * Whether to delete the menu message when the collector ends.
     *
     * @defaultValue false
     */
    readonly deleteOnTimeout?: boolean;

    /**
     * Callback invoked after the initial page is initialized and whenever
     * a page change has been successfully applied to the message.
     *
     * @param page - The page that is now active.
     * @param index - The zero-based index of the active page.
     */
    readonly onPageChange?: (
        page: MenuPage,
        index: number,
    ) => void | Promise<void>;

    /**
     * Policy controlling which users may interact with the menu.
     *
     * @defaultValue { type: 'caller-only' }
     */
    readonly access?: MenuAccess;
}

/**
 * Controls which users may interact with a menu.
 *
 * - `caller-only`: Only the user who owns the menu may interact.
 * - `everyone`: Any user may interact.
 * - `custom`: Access is determined by a user-provided filter. If the filter fails it will fallback to caller/only behaviour
 */
export type MenuAccess =
    | { type: 'caller-only' }
    | { type: 'everyone' }
    | {
          type: 'custom';
          filter: (
              interaction: MessageComponentInteraction,
          ) => boolean | Promise<boolean>;
      };

/**
 * Options controlling the visibility of an interaction-based menu response.
 */
export interface MenuDeliveryOptions {
    /**
     * Whether the response should be visible only to the invoking user.
     *
     * This setting applies when creating a new interaction response.
     * Editing an already-deferred response does not change its visibility.
     *
     * @defaultValue true
     */
    readonly ephemeral?: boolean;
}

/**
 * Message options accepted by the menu's delivery methods.
 *
 * Embed content, component rows, and message flags are managed by the menu
 * and are therefore excluded from these options.
 */
export type MenuMessageOptions = Omit<
    MessageCreateOptions,
    'embeds' | 'components' | 'flags'
>;

/** Navigation actions supported by the menu's built-in buttons. */
export type NavigationAction = 'previous' | 'next' | 'stop';

/**
 * Combined message option type used internally by the menu.
 *
 * Allows the menu payload to be supplied to Discord message creation,
 * interaction reply, and interaction edit methods.
 */
export type CompatibleMessageOptions = InteractionReplyOptions &
    InteractionEditReplyOptions &
    MessageCreateOptions;
