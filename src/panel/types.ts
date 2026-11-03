import type {
    ActionRowBuilder,
    EmbedBuilder,
    MessageActionRowComponentBuilder,
    MessageComponentInteraction,
} from 'discord.js';
import type { Panel } from './Panel';

/**
 * Content rendered by a {@link Panel}.
 *
 * The panel manager converts this content into Discord message options and
 * owns the message itself. Panels therefore only describe what should be
 * displayed.
 */
export interface PanelContent {
    /** Optional plain-text content displayed above the embeds. */
    readonly content?: string;

    /** Embeds displayed by the panel. */
    readonly embeds?: readonly EmbedBuilder[];

    /** Interactive component rows displayed by the panel. */
    readonly components?: readonly ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

/**
 * Controls which users may interact with a panel.
 *
 * - `everyone`: Any user may interact with the panel.
 * - `custom`: Access is determined by a user-provided filter.
 */
export type PanelAccess =
    | { readonly type: 'everyone' }
    | {
          readonly type: 'custom';
          readonly filter: (
              interaction: MessageComponentInteraction,
              panel: Panel,
          ) => boolean | Promise<boolean>;
      };

/**
 * Serializable representation of a panel and its Discord message.
 *
 * Records are written to a {@link PanelStore} whenever a panel is attached,
 * updated, or removed. They are used to restore panels after the bot
 * restarts.
 */
export interface StoredPanel<TData = unknown> {
    /** Unique identifier of the panel instance. */
    readonly id: string;

    /** Panel type used to look up the factory that recreates the panel. */
    readonly type: string;

    /** Guild containing the panel message, or `null` for direct messages. */
    readonly guildId: string | null;

    /** Channel containing the panel message. */
    readonly channelId: string;

    /** Discord message backing the panel. */
    readonly messageId: string;

    /** Panel-specific state returned by {@link Panel.serialize}. */
    readonly data?: TData;
}

/**
 * Persistence backend used by a panel manager.
 *
 * Implement this interface to store panel records in a database or another
 * durable location. {@link MemoryPanelStore} and {@link JsonFilePanelStore}
 * are provided out of the box.
 */
export interface PanelStore {
    /** Loads all stored panel records. */
    load(): Promise<readonly StoredPanel[]>;

    /** Replaces the stored panel records with the supplied records. */
    save(panels: readonly StoredPanel[]): Promise<void>;
}

/**
 * Recreates a panel from a stored record during restoration.
 *
 * The factory must construct a panel whose `id` and `type` match the record.
 * Panel-specific state can be read from {@link StoredPanel.data}.
 */
export type PanelFactory = (record: StoredPanel) => Panel | Promise<Panel>;

/** Configuration options used to construct a {@link PanelManager}. */
export interface PanelManagerOptions {
    /**
     * Persistence backend used to survive restarts.
     *
     * @defaultValue A new {@link MemoryPanelStore}
     */
    readonly store?: PanelStore;

    /**
     * Whether to restore stored panels automatically.
     *
     * When enabled, restoration runs once the client is ready. If the client
     * is already ready when the manager is created, restoration is scheduled
     * on the next microtask.
     *
     * @defaultValue true
     */
    readonly autoRestore?: boolean;
}
