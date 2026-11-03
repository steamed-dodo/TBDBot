import type { Message, MessageComponentInteraction } from 'discord.js';

import type { PanelAccess, PanelContent } from './types';

/**
 * Base class for a persistent Discord message controlled by custom
 * components.
 *
 * Unlike a menu, a panel has no timeout and is not tied to a component
 * collector. A {@link PanelManager} routes interactions by message ID, which
 * allows panels to keep working after the bot restarts.
 *
 * Panel state that must survive a restart should be returned from
 * {@link Panel.serialize}. The panel manager stores that value and passes it
 * back to the registered factory when restoring the panel.
 *
 * @typeParam TData - Serializable panel state persisted by the manager.
 */
export abstract class Panel<TData = unknown> {
    /** Panel type used to look up a restoration factory. */
    public abstract readonly type: string;

    /** Discord message associated with this panel, if attached. */
    public message: Message | null = null;

    /**
     * Policy controlling which users may interact with this panel.
     *
     * @defaultValue { type: 'everyone' }
     */
    public access: PanelAccess = { type: 'everyone' };

    /**
     * @param id - Unique identifier of this panel instance.
     */
    constructor(public readonly id: string) {}

    /**
     * Builds the content displayed by the panel.
     *
     * Called when the panel is sent and whenever
     * {@link PanelManager.refresh} is invoked.
     */
    public abstract build(): PanelContent | Promise<PanelContent>;

    /**
     * Handles an interaction targeting this panel's message.
     *
     * The handler is responsible for acknowledging the interaction, for
     * example by replying, deferring, updating the message, or opening a
     * modal.
     */
    public abstract onInteraction(
        interaction: MessageComponentInteraction,
    ): void | Promise<void>;

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
