import type { API, Gateway } from '@discordjs/core';
import { Client as CoreClient } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import type { RESTOptions } from '@discordjs/rest';
import { WebSocketManager } from '@discordjs/ws';
import { GatewayIntentBits } from 'discord-api-types/v10';

import { ApiHelpers } from '../api/helpers';
import type { Interaction } from '../interaction/types';
import { EventRouter } from './EventRouter';
import { TypedEventEmitter } from './TypedEventEmitter';
import type { ReadyInfo } from './types';

/**
 * A gateway implementation usable by the framework.
 *
 * This is `@discordjs/core`'s `Gateway` interface plus the optional
 * connect/destroy hooks the framework uses for its lifecycle. The production
 * implementation is `@discordjs/ws`'s `WebSocketManager`; tests can supply
 * their own.
 */
export interface FrameworkGateway extends Gateway {
    /** Opens the connection to Discord. */
    connect?(): Promise<void>;

    /** Closes the connection to Discord. */
    destroy?(): PromiseLike<void> | void;
}

/** Configuration options used to construct a {@link FrameworkClient}. */
export interface FrameworkClientOptions {
    /** Bot token used to authenticate against Discord. */
    readonly token: string;

    /**
     * Gateway intents to identify with.
     *
     * @defaultValue `GatewayIntentBits.Guilds`
     */
    readonly intents?: number;

    /**
     * Pre-built REST instance.
     *
     * Supplying one is how tests inject a mock transport.
     */
    readonly rest?: REST;

    /**
     * Pre-built gateway.
     *
     * Supplying one is how tests inject a fake gateway.
     */
    readonly gateway?: FrameworkGateway;

    /** Options used to construct the REST instance when none is supplied. */
    readonly restOptions?: Partial<RESTOptions>;

    /**
     * Number of shards to run.
     *
     * @defaultValue 1
     */
    readonly shardCount?: number;

    /**
     * Application ID.
     *
     * When omitted, the ID is taken from the `READY` dispatch.
     */
    readonly applicationId?: string;
}

/**
 * Handler invoked for every incoming interaction.
 *
 * Returning `true` marks the interaction as handled and stops the chain.
 */
export type InteractionHandler = (
    interaction: Interaction,
) => boolean | Promise<boolean>;

/**
 * A task executed during shutdown.
 *
 * Shutdown tasks run in reverse registration order, before the gateway is
 * destroyed, so that framework state can be flushed while the connection is
 * still alive.
 */
export type ShutdownTask = () => void | Promise<void>;

/**
 * The framework's Discord client.
 *
 * It owns the `REST` instance, the gateway, and `@discordjs/core`'s client,
 * and it translates raw gateway dispatches into friendly typed events.
 */
export class FrameworkClient extends TypedEventEmitter {
    /** Underlying REST client. */
    public readonly rest: REST;

    /** Typed helpers over the REST facade. */
    public readonly apiHelpers: ApiHelpers;

    /** Underlying `@discordjs/core` client. */
    public readonly core: CoreClient;

    /** Underlying gateway. */
    public readonly gateway: FrameworkGateway;

    /** Whether the client is currently connected to the gateway. */
    public connected = false;

    /** Whether the client has received a `READY` dispatch. */
    public ready = false;

    private applicationId: string | null;

    private readonly interactionHandlers: InteractionHandler[] = [];

    private readonly shutdownTasks: ShutdownTask[] = [];

    private readyPromise: Promise<ReadyInfo> | null = null;

    private resolveReady: ((info: ReadyInfo) => void) | null = null;

    private rejectReady: ((error: Error) => void) | null = null;

    private acceptingInteractions = true;

    /**
     * @param options - Client configuration.
     */
    constructor(private readonly options: FrameworkClientOptions) {
        super();

        this.setMaxListeners(0);

        this.rest = options.rest ?? new REST(options.restOptions ?? {});

        this.gateway =
            options.gateway ??
            new WebSocketManager({
                rest: this.rest,
                token: options.token,
                intents: options.intents ?? GatewayIntentBits.Guilds,
                ...(options.shardCount === undefined
                    ? {}
                    : { shardCount: options.shardCount }),
            });

        this.core = new CoreClient({ rest: this.rest, gateway: this.gateway });
        this.apiHelpers = new ApiHelpers(this.core.api);
        this.applicationId = options.applicationId ?? null;

        new EventRouter(this.core, this);

        this.on('ready', (info: ReadyInfo) => {
            this.ready = true;
            this.applicationId = info.applicationId;
            this.resolveReady?.(info);
            this.resolveReady = null;
            this.rejectReady = null;
        });

        this.on('error', () => {
            this.rejectReady?.(
                new Error('The client emitted an error before becoming ready.'),
            );
            this.rejectReady = null;
            this.resolveReady = null;
        });

        this.on('interactionCreate', (interaction: Interaction) => {
            void this.dispatchInteraction(interaction);
        });
    }

    /** ID of the application the client is connected as. */
    public get application(): string | null {
        return this.applicationId;
    }

    /** The REST facade exposed by `@discordjs/core`. */
    public get api(): API {
        return this.core.api;
    }

    /** Bot token used by the client. */
    public get token(): string {
        return this.options.token;
    }

    /**
     * Registers a handler invoked for every incoming interaction.
     *
     * Handlers run in registration order. The first handler that returns
     * `true` stops the chain, which lets the UI router and the command
     * manager coexist without either knowing about the other.
     *
     * @param handler - Handler to register.
     * @returns A function that removes the handler.
     */
    public handleInteractions(handler: InteractionHandler): () => void {
        this.interactionHandlers.push(handler);

        return () => {
            const index = this.interactionHandlers.indexOf(handler);

            if (index !== -1) {
                this.interactionHandlers.splice(index, 1);
            }
        };
    }

    /**
     * Registers a task executed during shutdown.
     *
     * @param task - Task to register.
     * @returns A function that removes the task.
     */
    public onShutdown(task: ShutdownTask): () => void {
        this.shutdownTasks.push(task);

        return () => {
            const index = this.shutdownTasks.indexOf(task);

            if (index !== -1) {
                this.shutdownTasks.splice(index, 1);
            }
        };
    }

    /**
     * Connects to the gateway.
     *
     * @returns A promise that resolves once the connection is established.
     */
    public async connect(): Promise<void> {
        if (this.connected) {
            return;
        }

        this.rest.setToken(this.options.token);

        await this.gateway.connect?.();

        this.connected = true;
    }

    /**
     * Resolves once the client has received a `READY` dispatch.
     *
     * @returns A promise resolving with the ready information.
     */
    public whenReady(): Promise<ReadyInfo> {
        if (this.ready) {
            return Promise.resolve({
                applicationId: this.applicationId ?? '',
                sessionId: null,
                shardId: 0,
                user: null,
                raw: undefined as never,
            });
        }

        if (!this.readyPromise) {
            this.readyPromise = new Promise<ReadyInfo>((resolve, reject) => {
                this.resolveReady = resolve;
                this.rejectReady = reject;
            });
        }

        return this.readyPromise;
    }

    /**
     * Shuts the client down.
     *
     * The order is deliberate: stop accepting interactions, flush framework
     * state (metrics, caches, stores), then destroy the gateway. Every step
     * must complete within the deployment's grace period.
     */
    public async destroy(): Promise<void> {
        this.acceptingInteractions = false;

        for (const task of [...this.shutdownTasks].reverse()) {
            await task();
        }

        await this.gateway.destroy?.();

        this.connected = false;
        this.ready = false;
    }

    /**
     * Dispatches an interaction to the registered handlers.
     *
     * @param interaction - The interaction to dispatch.
     */
    public async dispatchInteraction(interaction: Interaction): Promise<void> {
        if (!this.acceptingInteractions) {
            return;
        }

        for (const handler of [...this.interactionHandlers]) {
            const handled = await handler(interaction);

            if (handled) {
                return;
            }
        }
    }
}
