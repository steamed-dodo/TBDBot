import type { API } from '@discordjs/core';
import { MessageFlags } from 'discord-api-types/v10';

import type { Interaction } from '../interaction/types';
import {
    FRAMEWORK_NAMESPACE,
    createCustomId,
    parseCustomId,
    splitAction,
} from './ids';
import type { MessageTarget } from './messages';
import { editTarget } from './messages';
import { renderContent } from './render';
import type { ActionContext, Widget } from './types';

/** Interaction tokens are valid for 15 minutes. */
export const DEFAULT_QUEUE_TTL = 15 * 60 * 1000;

/** Maximum number of queued interactions kept for a single widget. */
export const DEFAULT_MAX_QUEUED_PER_WIDGET = 25;

/** Maximum number of queued interactions kept across all widgets. */
export const DEFAULT_MAX_QUEUED_TOTAL = 500;

/** Configuration options used to construct a {@link WidgetRouter}. */
export interface WidgetRouterOptions {
    /**
     * Namespace used for the framework-minted custom ids.
     *
     * @defaultValue `'ui'`
     */
    readonly namespace?: string;

    /**
     * Maximum number of queued interactions kept for a single widget.
     *
     * @defaultValue 25
     */
    readonly maxQueuedPerWidget?: number;

    /**
     * Maximum number of queued interactions kept across all widgets.
     *
     * @defaultValue 500
     */
    readonly maxQueuedTotal?: number;

    /**
     * How long a queued interaction stays valid, in milliseconds.
     *
     * @defaultValue 900000 (15 minutes)
     */
    readonly queueTtl?: number;
}

/** A widget registered with the router, together with its message target. */
export interface RegisteredWidget {
    /** The registered widget. */
    readonly widget: Widget;

    /** Where the widget's message lives, when it has been sent. */
    readonly target: MessageTarget | null;
}

interface QueuedInteraction {
    readonly interaction: Interaction;
    readonly queuedAt: number;
}

/**
 * Resolves incoming custom ids to widgets and dispatches actions.
 *
 * The router is the piece that `@discordjs/core` does not provide. Because
 * components are addressed by `custom_id` rather than by a collector, a
 * widget keeps working no matter who triggered the interaction or when.
 */
export class WidgetRouter {
    private readonly widgets = new Map<string, RegisteredWidget>();

    private readonly expected = new Set<string>();

    private readonly queues = new Map<string, QueuedInteraction[]>();

    private queuedCount = 0;

    private readonly namespace: string;

    private readonly maxQueuedPerWidget: number;

    private readonly maxQueuedTotal: number;

    private readonly queueTtl: number;

    /**
     * @param api - The REST facade used to update widget messages.
     * @param options - Router configuration.
     */
    constructor(
        private readonly api: API,
        options: WidgetRouterOptions = {},
    ) {
        this.namespace = options.namespace ?? FRAMEWORK_NAMESPACE;
        this.maxQueuedPerWidget =
            options.maxQueuedPerWidget ?? DEFAULT_MAX_QUEUED_PER_WIDGET;
        this.maxQueuedTotal =
            options.maxQueuedTotal ?? DEFAULT_MAX_QUEUED_TOTAL;
        this.queueTtl = options.queueTtl ?? DEFAULT_QUEUE_TTL;
    }

    /** Namespace used for the framework-minted custom ids. */
    public get idNamespace(): string {
        return this.namespace;
    }

    /** Number of interactions currently waiting in the queue. */
    public get pendingCount(): number {
        return this.queuedCount;
    }

    /**
     * Registers a widget with the router.
     *
     * Any interactions that arrived for this widget while it was being
     * restored are drained as part of the registration.
     *
     * @param widget - The widget to register.
     * @param target - Where the widget's message lives, when it has been sent.
     */
    public async register(
        widget: Widget,
        target: MessageTarget | null = null,
    ): Promise<void> {
        this.widgets.set(widget.routingId, { widget, target });
        this.expected.delete(widget.routingId);

        await this.drain(widget.routingId);
    }

    /**
     * Removes a widget from the router.
     *
     * @param routingId - Routing id of the widget.
     * @returns `true` when a widget was removed.
     */
    public unregister(routingId: string): boolean {
        return this.widgets.delete(routingId);
    }

    /**
     * Looks up a registered widget.
     *
     * @param routingId - Routing id of the widget.
     * @returns The widget, or `undefined` when it is not registered.
     */
    public get(routingId: string): Widget | undefined {
        return this.widgets.get(routingId)?.widget;
    }

    /**
     * Declares that a widget is expected to be registered shortly.
     *
     * Interactions that arrive for an expected widget are queued instead of
     * being dropped, which is what makes persistent widgets survive a cold
     * start.
     *
     * @param routingId - Routing id of the widget.
     */
    public expect(routingId: string): void {
        this.expected.add(routingId);
    }

    /**
     * Checks whether a widget is expected but not yet registered.
     *
     * @param routingId - Routing id of the widget.
     */
    public isExpected(routingId: string): boolean {
        return this.expected.has(routingId);
    }

    /**
     * Handles an incoming interaction.
     *
     * @param interaction - The interaction to handle.
     * @returns `true` when the interaction was handled by the router.
     */
    public async handle(interaction: Interaction): Promise<boolean> {
        if (!interaction.isComponent() && !interaction.isModalSubmit()) {
            return false;
        }

        const customId = interaction.customId;

        if (!customId) {
            return false;
        }

        const parsed = parseCustomId(customId);

        if (!parsed || parsed.namespace !== this.namespace) {
            return false;
        }

        const registered = this.widgets.get(parsed.widgetId);

        if (registered) {
            await this.dispatch(registered.widget, parsed.action, interaction);

            return true;
        }

        if (this.expected.has(parsed.widgetId)) {
            await this.enqueue(parsed.widgetId, interaction);

            return true;
        }

        return false;
    }

    /**
     * Re-renders a widget and pushes the result to its message.
     *
     * This is the property that separates the widget model from a
     * collector: the update can be triggered from anywhere.
     *
     * @param routingId - Routing id of the widget.
     */
    public async refresh(routingId: string): Promise<void> {
        const registered = this.widgets.get(routingId);

        if (!registered?.target) {
            return;
        }

        const content = await registered.widget.render();
        const message = renderContent(content, this.namespace, routingId);

        await editTarget(this.api, registered.target, message);
    }

    /**
     * Fails every interaction queued for a widget.
     *
     * Used when a widget cannot be restored, so that pending interactions are
     * answered instead of being left hanging.
     *
     * @param routingId - Routing id of the widget.
     * @param message - Message shown to the users.
     */
    public async failQueued(
        routingId: string,
        message = 'This interaction is no longer available.',
    ): Promise<void> {
        const queue = this.queues.get(routingId);

        this.queues.delete(routingId);
        this.expected.delete(routingId);

        if (!queue) {
            return;
        }

        for (const entry of queue) {
            this.queuedCount -= 1;

            await safeReply(entry.interaction, message);
        }
    }

    /**
     * Processes the interactions queued for a widget.
     *
     * @param routingId - Routing id of the widget.
     */
    public async drain(routingId: string): Promise<void> {
        const queue = this.queues.get(routingId);

        if (!queue) {
            return;
        }

        this.queues.delete(routingId);

        const registered = this.widgets.get(routingId);

        if (!registered) {
            this.queuedCount -= queue.length;

            for (const entry of queue) {
                await safeReply(
                    entry.interaction,
                    'This interaction is no longer available.',
                );
            }

            return;
        }

        const now = Date.now();

        for (const entry of queue) {
            this.queuedCount -= 1;

            if (now - entry.queuedAt > this.queueTtl) {
                await safeReply(
                    entry.interaction,
                    'This interaction expired before it could be processed.',
                );

                continue;
            }

            await this.dispatch(
                registered.widget,
                parseCustomId(entry.interaction.customId ?? '')?.action ?? '',
                entry.interaction,
            );
        }
    }

    private async dispatch(
        widget: Widget,
        action: string,
        interaction: Interaction,
    ): Promise<void> {
        const context: ActionContext = {
            widget,
            interaction,
            action,
            rawCustomId: interaction.customId ?? '',
            values: [...interaction.values],
            router: this,
        };

        try {
            const { reserved, name } = splitAction(action);

            if (reserved) {
                await widget.onNavigation?.(name, context);

                return;
            }

            await widget.onAction?.(action, context);
        } catch (error) {
            await safeReply(
                interaction,
                'Something went wrong while handling that action.',
            );

            throw error;
        }
    }

    private async enqueue(
        routingId: string,
        interaction: Interaction,
    ): Promise<void> {
        this.pruneExpired();

        const queue = this.queues.get(routingId) ?? [];

        while (queue.length >= this.maxQueuedPerWidget) {
            const dropped = queue.shift();

            if (dropped) {
                this.queuedCount -= 1;

                await safeReply(dropped.interaction, 'This interaction expired.');
            }
        }

        while (this.queuedCount >= this.maxQueuedTotal) {
            const dropped = this.dropOldest();

            if (!dropped) {
                break;
            }

            await safeReply(dropped.interaction, 'This interaction expired.');
        }

        queue.push({ interaction, queuedAt: Date.now() });
        this.queues.set(routingId, queue);
        this.queuedCount += 1;

        try {
            await interaction.defer();
        } catch {
            // The interaction may already have expired; the queue entry is
            // discarded when it is drained.
        }
    }

    private dropOldest(): QueuedInteraction | null {
        let oldest: QueuedInteraction | null = null;
        let oldestKey: string | null = null;

        for (const [key, queue] of this.queues) {
            const first = queue[0];

            if (!first) {
                continue;
            }

            if (!oldest || first.queuedAt < oldest.queuedAt) {
                oldest = first;
                oldestKey = key;
            }
        }

        if (!oldest || oldestKey === null) {
            return null;
        }

        const queue = this.queues.get(oldestKey);

        if (queue) {
            queue.shift();

            if (queue.length === 0) {
                this.queues.delete(oldestKey);
            }
        }

        return oldest;
    }

    private pruneExpired(): void {
        const now = Date.now();

        for (const [key, queue] of this.queues) {
            while (queue.length > 0) {
                const first = queue[0];

                if (!first || now - first.queuedAt <= this.queueTtl) {
                    break;
                }

                queue.shift();
                this.queuedCount -= 1;
            }

            if (queue.length === 0) {
                this.queues.delete(key);
            }
        }
    }
}

async function safeReply(interaction: Interaction, content: string): Promise<void> {
    try {
        await interaction.editReply({ content });

        return;
    } catch {
        // The interaction may not have an editable original response.
    }

    try {
        await interaction.reply({
            content,
            flags: MessageFlags.Ephemeral,
        });
    } catch {
        // The interaction may have already been answered or expired.
    }
}

/**
 * Builds the custom id for a component owned by a widget.
 *
 * @param namespace - Namespace used by the router.
 * @param routingId - Routing id of the widget.
 * @param action - Action segment.
 * @returns The custom id.
 */
export function widgetCustomId(
    namespace: string,
    routingId: string,
    action: string,
): string {
    return createCustomId(namespace, routingId, action);
}
