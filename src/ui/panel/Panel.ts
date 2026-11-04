import type { PanelAccess } from './types';
import type { RenderedContent, Widget } from '../types';

/**
 * Base class for a persistent Discord message controlled by custom
 * components.
 *
 * A panel is a widget with a long lifetime: it has no timeout and is not
 * tied to a collector. A {@link PanelManager} routes interactions by
 * routing id, which allows panels to keep working after the bot restarts.
 *
 * Panel state that must survive a restart should be returned from
 * {@link Panel.serialize}. The panel manager stores that value and passes it
 * back to the registered factory when restoring the panel.
 *
 * @typeParam TData - Serializable panel state persisted by the manager.
 */
export abstract class Panel<TData = unknown> implements Widget<unknown> {
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

    /** The panel holds no structured state by default. */
    public get state(): unknown {
        return undefined;
    }

    /**
     * Builds the content displayed by the panel.
     *
     * Called when the panel is sent and whenever the panel manager refreshes
     * it.
     */
    public abstract build(): RenderedContent | Promise<RenderedContent>;

    /**
     * Renders the panel.
     *
     * @returns The content displayed by the panel.
     */
    public async render(): Promise<RenderedContent> {
        return this.build();
    }

    /**
     * Returns the panel state that should be persisted.
     *
     * Returning `undefined` means the panel has no extra state to store.
     * The value must be JSON-serializable when used with
     * {@link JsonFilePanelStore}.
     */
    public serialize(): TData | undefined {
        return undefined;
    }

    /** Called when the panel is registered with a manager. */
    public async onCreate(): Promise<void> {}

    /** Called after the panel has been restored from persistence. */
    public async onLoad(): Promise<void> {}

    /** Called when the panel is unregistered or deleted. */
    public async onDestroy(): Promise<void> {}
}
