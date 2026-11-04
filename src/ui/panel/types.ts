import type { Interaction } from '../../interaction/types';
import type { Panel } from './Panel';

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

    /**
     * Routing id used by the panel's custom ids.
     *
     * It is persisted with the record so that restoration can re-register
     * the exact same custom ids.
     */
    readonly routingId: string;

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
 * The factory must construct a panel whose `id`, `type` and `routingId`
 * match the record. Panel-specific state can be read from
 * {@link StoredPanel.data}.
 */
export type PanelFactory = (record: StoredPanel) => Panel | Promise<Panel>;

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
              interaction: Interaction,
          ) => boolean | Promise<boolean>;
      };
