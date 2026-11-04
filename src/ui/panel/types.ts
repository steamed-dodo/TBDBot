import type { Interaction } from '../../interaction/types';
import type { Widget } from '../types';
import type { Panel } from './Panel';

/**
 * A widget that can be persisted and restored.
 *
 * The panel manager works with this interface rather than with a concrete
 * panel class, so any widget — a persistent menu, for example — can survive
 * a restart.
 *
 * The widget holds only identifiers: it never holds a message object, because
 * the message may be edited or deleted by another client and the framework
 * deliberately keeps no cache.
 */
export interface PersistentWidget<S = unknown> extends Widget<S> {
    /** Stable, user-facing identity of the widget. */
    readonly id: string;

    /** Short, framework-generated identity used for routing. */
    readonly routingId: string;

    /** The type used to look up the factory that recreates the widget. */
    readonly type: string;

    /** ID of the Discord message backing the widget, when attached. */
    messageId: string | null;

    /** ID of the channel containing the widget's message, when attached. */
    channelId: string | null;

    /** ID of the guild containing the widget's message, when attached. */
    guildId: string | null;

    /**
     * Returns the snapshot that should be persisted.
     *
     * @param state - The state the widget currently holds.
     */
    serialize(state: S): unknown;

    /**
     * Rebuilds the state from a snapshot.
     *
     * @param data - The persisted snapshot.
     * @returns The restored state.
     */
    restore(data: unknown): S;

    /** Called when the widget is registered with a manager. */
    onCreate?(): Promise<void>;

    /** Called after the widget has been restored from persistence. */
    onLoad?(): Promise<void>;

    /** Called when the widget is unregistered or deleted. */
    onDestroy?(): Promise<void>;
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
              interaction: Interaction,
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

    /** Panel-specific state returned by {@link PersistentWidget.serialize}. */
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
 * Recreates any persistent widget from a stored record.
 */
export type WidgetFactory = (
    record: StoredPanel,
) => PersistentWidget | Promise<PersistentWidget>;
