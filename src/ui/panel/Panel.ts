import type { RenderedContent } from '../types';
import type { PanelAccess, PersistentWidget } from './types';

/**
 * Base class for a persistent Discord message controlled by custom
 * components.
 *
 * A panel is a widget with a long lifetime: it has no timeout and is not
 * tied to a collector. A {@link PanelManager} routes interactions by routing
 * id, which allows panels to keep working after the bot restarts.
 *
 * The panel holds only identifiers — never a message object — because the
 * message may be edited or deleted by another client and the framework
 * deliberately keeps no cache.
 *
 * @typeParam S - The state of the panel, held by the framework.
 */
export abstract class Panel<S = undefined> implements PersistentWidget<S> {
    /** Panel type used to look up a restoration factory. */
    public abstract readonly type: string;

    /**
     * Short, framework-generated identity used for routing.
     *
     * The value is persisted with the panel's record so that restoration
     * re-registers the same custom ids.
     */
    public readonly routingId: string;

    /**
     * Policy controlling which users may interact with this panel.
     *
     * @defaultValue { type: 'everyone' }
     */
    public access: PanelAccess = { type: 'everyone' };

    /** ID of the Discord message backing the panel, when attached. */
    public messageId: string | null = null;

    /** ID of the channel containing the panel's message, when attached. */
    public channelId: string | null = null;

    /** ID of the guild containing the panel's message, when attached. */
    public guildId: string | null = null;

    /**
     * @param id - Unique identifier of this panel instance.
     * @param routingId - Routing id used for the panel's custom ids.
     */
    constructor(
        public readonly id: string,
        routingId: string,
    ) {
        this.routingId = routingId;
    }

    /**
     * Builds the content displayed by the panel.
     *
     * Called when the panel is sent and whenever the panel manager refreshes
     * it.
     *
     * @param state - The state the panel currently holds.
     */
    public abstract build(state: S): RenderedContent | Promise<RenderedContent>;

    /**
     * Renders the panel.
     *
     * @param state - The state the panel currently holds.
     * @returns The content displayed by the panel.
     */
    public async render(state: S): Promise<RenderedContent> {
        return this.build(state);
    }

    /**
     * Returns the snapshot that should be persisted.
     *
     * Returning `undefined` means the panel has no extra state to store.
     * The value must be JSON-serializable when used with
     * {@link JsonFilePanelStore}.
     *
     * @param state - The state the panel currently holds.
     */
    public serialize(_state: S): unknown {
        return undefined;
    }

    /**
     * Rebuilds the state from a snapshot.
     *
     * @param _data - The persisted snapshot.
     * @returns The restored state.
     */
    public restore(_data: unknown): S {
        return undefined as S;
    }

    /** Called when the panel is registered with a manager. */
    public async onCreate(): Promise<void> {}

    /** Called after the panel has been restored from persistence. */
    public async onLoad(): Promise<void> {}

    /** Called when the panel is unregistered or deleted. */
    public async onDestroy(): Promise<void> {}
}
