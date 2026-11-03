import {
    MessageFlags,
    type Client,
    type Interaction,
    type Message,
    type MessageComponentInteraction,
    type MessageCreateOptions,
    type MessageEditOptions,
    type TextBasedChannel,
} from 'discord.js';
import { EventEmitter } from 'events';

import type { Panel } from './Panel';
import { PanelRegistry } from './PanelRegistry';
import { MemoryPanelStore } from './PanelStore';
import type {
    PanelAccess,
    PanelContent,
    PanelFactory,
    PanelManagerOptions,
    PanelStore,
    StoredPanel,
} from './types';

/**
 * Manages persistent panels and routes their component interactions.
 *
 * A panel is a message that continues to respond to interactions until it is
 * explicitly unregistered. Unlike menus, panels have no timeout and do not
 * rely on message collectors, so they keep working after a restart as long as
 * a persistent {@link PanelStore} is configured.
 *
 * The manager extends {@link EventEmitter} to expose lifecycle events:
 *
 * @event panelSent
 * Emitted after a panel message is sent. Receives the panel and message.
 *
 * @event panelRestored
 * Emitted after a stored panel has been reattached to its message. Receives
 * the panel and message.
 *
 * @event panelUnregistered
 * Emitted after a panel is no longer tracked by the manager. Receives the
 * panel.
 *
 * @event panelError
 * Emitted when an asynchronous panel operation fails. Receives the error and,
 * when available, the panel involved.
 */
export class PanelManager extends EventEmitter {
    private readonly panels = new Map<string, Panel>();
    private readonly messagePanels = new Map<string, Panel>();
    private readonly records = new Map<string, StoredPanel>();
    private readonly panelRegistry = new PanelRegistry();
    private readonly store: PanelStore;

    private loaded = false;
    private loadPromise: Promise<void> | null = null;
    private persistQueue: Promise<void> = Promise.resolve();
    private restorePromise: Promise<void> | null = null;
    private destroyed = false;

    private readonly handleInteraction = (interaction: Interaction): void => {
        if (!interaction.isMessageComponent()) return;

        void this.processInteraction(interaction).catch((error: unknown) => {
            this.emit('panelError', error);
        });
    };

    private readonly handleClientReady = (): void => {
        void this.restore().catch((error: unknown) => {
            this.emit('panelError', error);
        });
    };

    /**
     * @param client - Discord client used to send, fetch, and receive panels.
     * @param options - Persistence and automatic restoration options.
     */
    constructor(
        private readonly client: Client,
        options: PanelManagerOptions = {},
    ) {
        super();

        this.store = options.store ?? new MemoryPanelStore();

        this.client.on('interactionCreate', this.handleInteraction);

        if (options.autoRestore ?? true) {
            if (this.client.isReady()) {
                void Promise.resolve().then(this.handleClientReady);
            } else {
                this.client.once('clientReady', this.handleClientReady);
            }
        }
    }

    /** Registry of panel factories used during restoration. */
    public get registry(): PanelRegistry {
        return this.panelRegistry;
    }

    /** Number of panels currently tracked by the manager. */
    public get size(): number {
        return this.panels.size;
    }

    /**
     * Registers a factory for a panel type.
     *
     * @param type - Panel type handled by the factory.
     * @param factory - Function that recreates a panel from a stored record.
     * @returns This manager, allowing calls to be chained.
     */
    public define(type: string, factory: PanelFactory): this {
        this.panelRegistry.define(type, factory);

        return this;
    }

    /**
     * Gets a tracked panel by ID.
     *
     * @param id - Panel identifier.
     */
    public get(id: string): Panel | undefined {
        return this.panels.get(id);
    }

    /**
     * Gets the panel attached to a Discord message.
     *
     * @param messageId - Discord message ID.
     */
    public getByMessageId(messageId: string): Panel | undefined {
        return this.messagePanels.get(messageId);
    }

    /**
     * Registers a panel without attaching it to a message.
     *
     * `onCreate` is called before this method resolves. Registering a panel
     * with an existing ID throws.
     *
     * @param panel - Panel to register.
     *
     * @throws {TypeError} If the panel ID or type is empty.
     * @throws {Error} If a panel with the same ID is already registered.
     */
    public async register(panel: Panel): Promise<void> {
        this.assertPanel(panel);

        if (this.panels.has(panel.id)) {
            throw new Error(
                `A panel with ID "${panel.id}" is already registered.`,
            );
        }

        this.panels.set(panel.id, panel);

        try {
            await panel.onCreate();
        } catch (error) {
            this.panels.delete(panel.id);
            throw error;
        }
    }

    /**
     * Sends a panel to a channel, attaches it to the resulting message, and
     * persists the panel.
     *
     * If the panel has not been registered yet it is registered first.
     *
     * @param panel - Panel to send.
     * @param channel - Channel that receives the panel message.
     * @returns The panel message.
     *
     * @throws {Error} If the channel is not sendable or the panel is already
     *                 attached.
     */
    public async send(
        panel: Panel,
        channel: TextBasedChannel,
    ): Promise<Message> {
        this.assertPanel(panel);
        this.assertCanAttach(panel);

        if (!channel.isSendable()) {
            throw new Error('This channel is not sendable.');
        }

        const existing = this.panels.get(panel.id);

        if (existing && existing !== panel) {
            throw new Error(
                `A panel with ID "${panel.id}" is already registered.`,
            );
        }

        if (!existing) {
            await this.register(panel);
        }

        const message = await channel.send(
            this.toMessageOptions(await panel.build()),
        );

        await this.bind(panel, message);
        await this.persistPanel(panel);

        this.emit('panelSent', panel, message);

        return message;
    }

    /**
     * Attaches a panel to an existing Discord message and persists it.
     *
     * This is useful for adopting messages that were sent before the manager
     * was created. If the panel has not been registered yet it is registered
     * first and `onCreate` is called. `onLoad` is not called; that hook is
     * reserved for panels restored from a store.
     *
     * @param panel - Panel to attach.
     * @param message - Existing Discord message backing the panel.
     *
     * @throws {Error} If the panel or message is already attached.
     */
    public async attach(panel: Panel, message: Message): Promise<void> {
        this.assertPanel(panel);
        this.assertCanAttach(panel);
        this.assertMessageAvailable(panel, message);

        const existing = this.panels.get(panel.id);

        if (existing && existing !== panel) {
            throw new Error(
                `A panel with ID "${panel.id}" is already registered.`,
            );
        }

        if (!existing) {
            await this.register(panel);
        }

        await this.bind(panel, message);
        await this.persistPanel(panel);
    }

    /**
     * Rebuilds and edits a panel's message, then persists its state.
     *
     * @param panel - Panel to refresh.
     * @returns The updated panel message.
     *
     * @throws {Error} If the panel is not attached to a message.
     */
    public async refresh(panel: Panel): Promise<Message> {
        const message = panel.message;

        if (!message) {
            throw new Error('This panel is not attached to a message.');
        }

        await message.edit(this.toMessageOptions(await panel.build()));
        await this.persistPanel(panel);

        return message;
    }

    /**
     * Persists the current state of a tracked panel.
     *
     * The manager calls this automatically after interactions and refreshes,
     * so it is normally only needed when a panel changes state outside of an
     * interaction.
     *
     * @param panel - Panel to persist.
     *
     * @throws {Error} If the panel is not attached to a message.
     */
    public async save(panel: Panel): Promise<void> {
        if (!this.panels.has(panel.id)) {
            throw new Error(`Panel "${panel.id}" is not registered.`);
        }

        await this.persistPanel(panel);
    }

    /**
     * Stops tracking a panel and removes it from the store.
     *
     * The Discord message is left in place. Use {@link delete} to remove both
     * the panel and its message.
     *
     * @param id - Panel identifier.
     */
    public async unregister(id: string): Promise<void> {
        const panel = this.panels.get(id);

        if (!panel) return;

        try {
            await panel.onDestroy();
        } finally {
            if (panel.message) {
                this.messagePanels.delete(panel.message.id);
            }

            panel.message = null;
            this.panels.delete(id);

            await this.ensureLoaded().catch((error: unknown) => {
                this.emit('panelError', error, panel);
            });

            this.records.delete(id);

            await this.persist().catch((error: unknown) => {
                this.emit('panelError', error, panel);
            });

            this.emit('panelUnregistered', panel);
        }
    }

    /**
     * Deletes a panel's Discord message and stops tracking the panel.
     *
     * @param id - Panel identifier.
     */
    public async delete(id: string): Promise<void> {
        const panel = this.panels.get(id);

        if (!panel) return;

        if (panel.message) {
            await panel.message.delete();
        }

        await this.unregister(id);
    }

    /**
     * Restores panels from the configured store.
     *
     * For each stored record the manager resolves the panel factory, fetches
     * the existing message, attaches the new panel instance, and calls
     * `onLoad`. Records whose channel or message no longer exists are removed
     * from the store.
     *
     * Calling this method while a restoration is already running returns the
     * same promise.
     */
    public restore(): Promise<void> {
        if (this.restorePromise) {
            return this.restorePromise;
        }

        this.restorePromise = this.performRestore().finally(() => {
            this.restorePromise = null;
        });

        return this.restorePromise;
    }

    /**
     * Detaches the manager from the Discord client.
     *
     * Tracked panels are not deleted or removed from the store.
     */
    public destroy(): void {
        if (this.destroyed) return;

        this.destroyed = true;
        this.client.off('interactionCreate', this.handleInteraction);
        this.client.off('clientReady', this.handleClientReady);
    }

    private async performRestore(): Promise<void> {
        await this.ensureLoaded();

        let recordsChanged = false;

        for (const record of [...this.records.values()]) {
            if (this.panels.has(record.id)) continue;

            try {
                const factory = this.panelRegistry.resolve(record.type);

                if (!factory) {
                    throw new Error(
                        `No factory is registered for panel type "${record.type}".`,
                    );
                }

                const panel = await factory(record);

                if (panel.id !== record.id) {
                    throw new Error(
                        `Panel factory for "${record.type}" returned panel "${panel.id}", expected "${record.id}".`,
                    );
                }

                if (panel.type !== record.type) {
                    throw new Error(
                        `Panel "${record.id}" returned type "${panel.type}", expected "${record.type}".`,
                    );
                }

                const message = await this.fetchPanelMessage(record);

                if (!message) {
                    this.records.delete(record.id);
                    recordsChanged = true;

                    this.emit(
                        'panelError',
                        new Error(
                            `Panel "${record.id}" points to a message that no longer exists.`,
                        ),
                        panel,
                    );

                    continue;
                }

                this.panels.set(panel.id, panel);
                panel.message = message;
                this.messagePanels.set(message.id, panel);

                try {
                    await panel.onLoad();
                } catch (error) {
                    this.panels.delete(panel.id);
                    this.messagePanels.delete(message.id);
                    panel.message = null;
                    throw error;
                }

                this.emit('panelRestored', panel, message);
            } catch (error) {
                this.emit('panelError', error);
            }
        }

        if (recordsChanged) {
            await this.persist();
        }
    }

    private async processInteraction(
        interaction: MessageComponentInteraction,
    ): Promise<void> {
        if (this.restorePromise) {
            await this.restorePromise.catch(() => undefined);
        }

        const panel = this.messagePanels.get(interaction.message.id);

        if (!panel) return;

        try {
            if (!(await this.canInteract(panel.access, interaction, panel))) {
                await interaction.reply({
                    content: 'You cannot control this panel.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            await panel.onInteraction(interaction);
            await this.persistPanel(panel);
        } catch (error) {
            this.emit('panelError', error, panel);

            if (!interaction.replied && !interaction.deferred) {
                await interaction
                    .reply({
                        content:
                            'An error occurred while handling this interaction.',
                        flags: MessageFlags.Ephemeral,
                    })
                    .catch((replyError: unknown) => {
                        this.emit('panelError', replyError, panel);
                    });
            }
        }
    }

    private async canInteract(
        access: PanelAccess,
        interaction: MessageComponentInteraction,
        panel: Panel,
    ): Promise<boolean> {
        switch (access.type) {
            case 'everyone':
                return true;

            case 'custom':
                try {
                    return await access.filter(interaction, panel);
                } catch (error) {
                    this.emit('panelError', error, panel);
                    return false;
                }
        }
    }

    private async fetchPanelMessage(
        record: StoredPanel,
    ): Promise<Message | null> {
        try {
            const channel = await this.client.channels.fetch(record.channelId);

            if (!channel?.isTextBased()) {
                throw new Error(
                    `Channel "${record.channelId}" is not text based.`,
                );
            }

            return await channel.messages.fetch(record.messageId);
        } catch (error) {
            if (isMissingDiscordResource(error)) {
                return null;
            }

            throw error;
        }
    }

    private async bind(panel: Panel, message: Message): Promise<void> {
        this.assertMessageAvailable(panel, message);

        panel.message = message;
        this.messagePanels.set(message.id, panel);
    }

    private async persistPanel(panel: Panel): Promise<void> {
        const message = panel.message;

        if (!message) {
            throw new Error('Panel has no message to persist.');
        }

        const data = panel.serialize();

        const record: StoredPanel = {
            id: panel.id,
            type: panel.type,
            guildId: message.guildId ?? null,
            channelId: message.channelId,
            messageId: message.id,
            ...(data === undefined ? {} : { data }),
        };

        this.records.set(panel.id, record);

        await this.persist();
    }

    private persist(): Promise<void> {
        const operation = this.persistQueue.then(async () => {
            await this.ensureLoaded();
            await this.store.save([...this.records.values()]);
        });

        this.persistQueue = operation.catch(() => undefined);

        return operation;
    }

    private async ensureLoaded(): Promise<void> {
        if (this.loaded) return;

        if (!this.loadPromise) {
            this.loadPromise = (async () => {
                const records = await this.store.load();

                for (const record of records) {
                    if (!this.records.has(record.id)) {
                        this.records.set(record.id, record);
                    }
                }

                this.loaded = true;
            })().finally(() => {
                this.loadPromise = null;
            });
        }

        return this.loadPromise;
    }

    private toMessageOptions(
        content: PanelContent,
    ): MessageCreateOptions & MessageEditOptions {
        const options: MessageCreateOptions & MessageEditOptions = {};

        if (content.content !== undefined) {
            options.content = content.content;
        }

        if (content.embeds !== undefined) {
            options.embeds = [...content.embeds];
        }

        if (content.components !== undefined) {
            options.components = [...content.components];
        }

        return options;
    }

    private assertPanel(panel: Panel): void {
        if (!panel.id.trim()) {
            throw new TypeError('Panel ID must not be empty.');
        }

        if (!panel.type.trim()) {
            throw new TypeError('Panel type must not be empty.');
        }
    }

    private assertCanAttach(panel: Panel): void {
        if (panel.message) {
            throw new Error('This panel is already attached to a message.');
        }
    }

    private assertMessageAvailable(panel: Panel, message: Message): void {
        const existing = this.messagePanels.get(message.id);

        if (existing && existing !== panel) {
            throw new Error(
                `Message "${message.id}" is already attached to panel "${existing.id}".`,
            );
        }
    }
}

function isMissingDiscordResource(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return false;
    }

    const code = (error as { code?: unknown }).code;

    return code === 10003 || code === 10008;
}
