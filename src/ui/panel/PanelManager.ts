import type { API } from '@discordjs/core';

import { generateRoutingId } from '../ids';
import type { MessageTarget } from '../messages';
import { deleteTarget, editTarget, sendChannelMessage } from '../messages';
import { renderContent } from '../render';
import type { WidgetRouter } from '../router';
import { PanelRegistry } from './PanelRegistry';
import { MemoryPanelStore } from './PanelStore';
import type { PanelStore, PersistentWidget, StoredPanel } from './types';

/** Configuration options used to construct a {@link PanelManager}. */
export interface PanelManagerOptions {
    /** The REST facade used to send and edit panel messages. */
    readonly api: API;

    /** The router used to register panels and route their interactions. */
    readonly router: WidgetRouter;

    /**
     * Persistence backend used to survive restarts.
     *
     * @defaultValue A new {@link MemoryPanelStore}
     */
    readonly store?: PanelStore;

    /**
     * Namespace used for the panels' custom ids.
     *
     * @defaultValue 'ui'
     */
    readonly namespace?: string;
}

/**
 * Owns the lifecycle of persistent widgets.
 *
 * The manager keeps the store, the registry of widget factories, and the set
 * of live widgets in sync. On boot it restores the widgets, re-binding their
 * messages so that they keep routing correctly.
 *
 * The manager works with any widget that exposes a `type` and a
 * `serialize()` method, so a persistent menu is restored exactly like a
 * panel is.
 */
export class PanelManager {
    /** The REST facade used to send and edit panel messages. */
    public readonly api: API;

    /** The router used to register panels. */
    public readonly router: WidgetRouter;

    /** The persistence backend. */
    public readonly store: PanelStore;

    /** Namespace used for the panels' custom ids. */
    public readonly namespace: string;

    private readonly registry = new PanelRegistry();

    private readonly panels = new Map<string, PersistentWidget>();

    private readonly records = new Map<string, StoredPanel>();

    /**
     * @param options - Manager configuration.
     */
    constructor(options: PanelManagerOptions) {
        this.api = options.api;
        this.router = options.router;
        this.store = options.store ?? new MemoryPanelStore();
        this.namespace = options.namespace ?? 'ui';
    }

    /**
     * Registers a factory for a widget type.
     *
     * @param type - Widget type handled by the factory.
     * @param factory - Function that recreates a widget from a stored record.
     * @returns This manager, allowing calls to be chained.
     */
    public define(
        type: string,
        factory: Parameters<PanelRegistry['define']>[1],
    ): this {
        this.registry.define(type, factory);

        return this;
    }

    /**
     * Looks up a live panel.
     *
     * @param id - ID of the panel.
     * @returns The panel, or `undefined` when it is not live.
     */
    public get(id: string): PersistentWidget | undefined {
        return this.panels.get(id);
    }

    /** Every panel currently managed. */
    public get all(): readonly PersistentWidget[] {
        return [...this.panels.values()];
    }

    /**
     * Restores the panels persisted in the store.
     *
     * Every restored panel is registered with the router, which drains the
     * interactions that arrived while the bot was starting. Panels that
     * cannot be restored have their queued interactions failed instead of
     * being left pending.
     */
    public async start(): Promise<void> {
        const records = await this.store.load();

        for (const record of records) {
            this.records.set(record.id, record);
            this.router.expect(record.routingId);
        }

        for (const record of records) {
            await this.restore(record);
        }
    }

    /**
     * Sends a panel to a channel and persists it.
     *
     * @param panel - The panel to attach.
     * @param channelId - Channel to send the panel to.
     * @param guildId - Guild containing the channel, when known.
     * @returns The ID of the created message.
     */
    public async attach(
        panel: PersistentWidget,
        channelId: string,
        guildId: string | null = null,
    ): Promise<string> {
        const content = await panel.render();
        const message = renderContent(content, this.namespace, panel.routingId);
        const created = await sendChannelMessage(this.api, channelId, message);

        panel.messageId = created.id;
        panel.channelId = channelId;
        panel.guildId = guildId;

        this.panels.set(panel.id, panel);

        await this.router.register(panel, {
            kind: 'channel',
            channelId,
            messageId: created.id,
        });

        await panel.onCreate?.();

        await this.persist(panel, guildId);

        return created.id;
    }

    /**
     * Re-renders a panel and pushes the result to its message.
     *
     * @param panel - The panel to refresh.
     */
    public async refresh(panel: PersistentWidget): Promise<void> {
        if (!panel.messageId || !panel.channelId) {
            return;
        }

        const content = await panel.render();
        const message = renderContent(content, this.namespace, panel.routingId);

        await editTarget(
            this.api,
            {
                kind: 'channel',
                channelId: panel.channelId,
                messageId: panel.messageId,
            },
            message,
        );
    }

    /**
     * Removes a panel, deleting its message and forgetting its record.
     *
     * @param panel - The panel to remove.
     * @param options - Whether the message is deleted.
     */
    public async remove(
        panel: PersistentWidget,
        options: { readonly deleteMessage?: boolean } = {},
    ): Promise<void> {
        this.panels.delete(panel.id);
        this.records.delete(panel.id);
        this.router.unregister(panel.routingId);

        if (options.deleteMessage && panel.messageId && panel.channelId) {
            await deleteTarget(this.api, {
                kind: 'channel',
                channelId: panel.channelId,
                messageId: panel.messageId,
            }).catch(() => undefined);
        }

        await panel.onDestroy?.();

        await this.save();
    }

    /**
     * Builds the message target of a panel.
     *
     * @param panel - The panel.
     * @returns The target, or `null` when the panel is not attached.
     */
    public targetOf(panel: PersistentWidget): MessageTarget | null {
        if (!panel.messageId || !panel.channelId) {
            return null;
        }

        return {
            kind: 'channel',
            channelId: panel.channelId,
            messageId: panel.messageId,
        };
    }

    private async restore(record: StoredPanel): Promise<void> {
        const factory = this.registry.resolve(record.type);

        if (!factory) {
            await this.router.failQueued(
                record.routingId,
                'This panel is no longer available.',
            );

            this.records.delete(record.id);

            return;
        }

        let panel: PersistentWidget;

        try {
            panel = await factory(record);
        } catch {
            await this.router.failQueued(
                record.routingId,
                'This panel could not be restored.',
            );

            this.records.delete(record.id);

            return;
        }

        panel.messageId = record.messageId;
        panel.channelId = record.channelId;
        panel.guildId = record.guildId;

        this.panels.set(panel.id, panel);

        await this.router.register(panel, {
            kind: 'channel',
            channelId: record.channelId,
            messageId: record.messageId,
        });

        await panel.onLoad?.();
    }

    private async persist(
        panel: PersistentWidget,
        guildId: string | null,
    ): Promise<void> {
        const data = panel.serialize();

        const record: StoredPanel = {
            id: panel.id,
            type: panel.type,
            routingId: panel.routingId,
            guildId,
            channelId: panel.channelId ?? '',
            messageId: panel.messageId ?? '',
            ...(data === undefined ? {} : { data }),
        };

        this.records.set(panel.id, record);

        await this.save();
    }

    private async save(): Promise<void> {
        await this.store.save([...this.records.values()]);
    }
}

/**
 * Generates a routing id for a new panel.
 *
 * @returns The generated routing id.
 */
export function createPanelRoutingId(): string {
    return generateRoutingId();
}
