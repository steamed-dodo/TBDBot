import { EventEmitter } from 'node:events';

import { REST } from '@discordjs/rest';
import type { RESTOptions } from '@discordjs/rest';

import type { FrameworkGateway } from '../core/Client';

/** The signature of the transport handed to `@discordjs/rest`. */
type MakeRequest = NonNullable<RESTOptions['makeRequest']>;

/**
 * The Discord routes the mock transport knows about.
 *
 * The first pattern that matches wins, and its template becomes the route
 * recorded on the request. Asserting on the route rather than on the method
 * is what makes a test able to tell an ephemeral edit from a channel edit.
 */
const ROUTE_PATTERNS: readonly (readonly [RegExp, string])[] = [
    [
        /^\/interactions\/([^/]+)\/([^/]+)\/callback$/,
        '/interactions/{interaction_id}/{interaction_token}/callback',
    ],
    [
        /^\/webhooks\/([^/]+)\/([^/]+)\/messages\/(@original|[^/]+)$/,
        '/webhooks/{application_id}/{interaction_token}/messages/{message_id}',
    ],
    [
        /^\/webhooks\/([^/]+)\/([^/]+)$/,
        '/webhooks/{application_id}/{interaction_token}',
    ],
    [/^\/channels\/([^/]+)\/messages$/, '/channels/{channel_id}/messages'],
    [
        /^\/channels\/([^/]+)\/messages\/([^/]+)$/,
        '/channels/{channel_id}/messages/{message_id}',
    ],
    [
        /^\/channels\/([^/]+)\/messages\/bulk-delete$/,
        '/channels/{channel_id}/messages/bulk-delete',
    ],
    [
        /^\/applications\/([^/]+)\/commands$/,
        '/applications/{application_id}/commands',
    ],
    [
        /^\/applications\/([^/]+)\/guilds\/([^/]+)\/commands$/,
        '/applications/{application_id}/guilds/{guild_id}/commands',
    ],
    [/^\/guilds\/([^/]+)\/roles$/, '/guilds/{guild_id}/roles'],
    [
        /^\/guilds\/([^/]+)\/members\/([^/]+)$/,
        '/guilds/{guild_id}/members/{user_id}',
    ],
    [/^\/channels\/([^/]+)$/, '/channels/{channel_id}'],
    [/^\/users\/([^/]+)$/, '/users/{user_id}'],
];

/**
 * Resolves a Discord route template from a request URL.
 *
 * @param url - The URL of the request.
 * @returns The route template, or the path when no pattern matches.
 */
export function describeRoute(url: string): string {
    let path: string;

    try {
        path = decodeURIComponent(new URL(url).pathname);
    } catch {
        path = url;
    }

    path = path.replace(/^\/api\/v\d+/, '');

    for (const [pattern, template] of ROUTE_PATTERNS) {
        if (pattern.test(path)) {
            return template;
        }
    }

    return path;
}

/**
 * A REST request recorded by the {@link MockTransport}.
 */
export interface RecordedRequest {
    /** The HTTP method of the request. */
    readonly method: string;

    /** The URL of the request. */
    readonly url: string;

    /**
     * The Discord route of the request.
     *
     * This is the route *template* — `/channels/{channel_id}/messages` — not
     * the concrete URL, so that a test can assert that the framework called
     * the right endpoint rather than merely that it called something.
     */
    readonly route: string;

    /** The parsed body of the request, when there was one. */
    readonly body: unknown;

    /** The headers of the request. */
    readonly headers: Record<string, string>;
}

/**
 * A canned response returned by the {@link MockTransport}.
 */
export interface MockResponse {
    /** The status code of the response. */
    readonly status?: number;

    /** The body of the response. */
    readonly body?: unknown;
}

/**
 * An injectable transport that records requests and returns canned
 * responses.
 *
 * This is what makes the framework testable without a network.
 */
export class MockTransport {
    /** Every request made through the transport. */
    public readonly requests: RecordedRequest[] = [];

    private readonly routes = new Map<string, MockResponse>();

    private fallback: MockResponse = { status: 200, body: {} };

    /**
     * Registers a response for a route.
     *
     * @param route - The route to match, for example `/channels/`.
     * @param response - The response to return.
     * @returns This transport, allowing calls to be chained.
     */
    public on(route: string, response: MockResponse): this {
        this.routes.set(route, response);

        return this;
    }

    /**
     * Sets the response returned when no route matches.
     *
     * @param response - The response to return.
     * @returns This transport, allowing calls to be chained.
     */
    public otherwise(response: MockResponse): this {
        this.fallback = response;

        return this;
    }

    /**
     * Finds the route a request belongs to.
     *
     * @param url - The URL of the request.
     * @returns The matched route, when there is one.
     */
    public routeOf(url: string): string | undefined {
        for (const route of this.routes.keys()) {
            if (url.includes(route)) {
                return route;
            }
        }

        return undefined;
    }

    /**
     * The `makeRequest` implementation handed to `@discordjs/rest`.
     *
     * @param url - The URL of the request.
     * @param init - The request options.
     * @returns The response.
     */
    public readonly makeRequest: MakeRequest = async (url, init) => {
        let body: unknown;

        if (typeof init.body === 'string') {
            try {
                body = JSON.parse(init.body);
            } catch {
                body = init.body;
            }
        }

        const headers: Record<string, string> = {};

        for (const [key, value] of Object.entries(
            (init.headers ?? {}) as Record<string, string>,
        )) {
            headers[key.toLowerCase()] = value;
        }

        this.requests.push({
            method: init.method ?? 'GET',
            url,
            route: describeRoute(url),
            body,
            headers,
        });

        const route = this.routeOf(url);
        const response = route
            ? (this.routes.get(route) as MockResponse)
            : this.fallback;

        return new Response(JSON.stringify(response.body ?? {}), {
            status: response.status ?? 200,
            headers: { 'content-type': 'application/json' },
        }) as unknown as Awaited<ReturnType<MakeRequest>>;
    };
}

/**
 * Builds a REST instance backed by a mock transport.
 *
 * @param transport - The transport recording the requests.
 * @returns The REST instance.
 */
export function createMockRest(transport: MockTransport): REST {
    return new REST({ makeRequest: transport.makeRequest });
}

/**
 * A gateway that records the payloads dispatched to it.
 *
 * It lets a test push raw gateway dispatches into the framework without a
 * network connection.
 */
export class MockGateway extends EventEmitter implements FrameworkGateway {
    /** Every payload sent through the gateway. */
    public readonly sent: unknown[] = [];

    /** Whether the gateway has been connected. */
    public connected = false;

    /** Whether the gateway has been destroyed. */
    public destroyed = false;

    /** The number of shards the gateway reports. */
    public shardCount = 1;

    /**
     * @param options - Gateway options.
     */
    constructor(options: { readonly shardCount?: number } = {}) {
        super();

        this.shardCount = options.shardCount ?? 1;
    }

    /**
     * Gets the number of shards.
     *
     * @returns The number of shards.
     */
    public async getShardCount(): Promise<number> {
        return this.shardCount;
    }

    /**
     * Sends a payload to Discord.
     *
     * @param shardId - The shard the payload is sent on.
     * @param payload - The payload.
     */
    public async send(shardId: number, payload: unknown): Promise<void> {
        this.sent.push({ shardId, payload });
    }

    /** Opens the connection to Discord. */
    public async connect(): Promise<void> {
        this.connected = true;
    }

    /** Closes the connection to Discord. */
    public async destroy(): Promise<void> {
        this.destroyed = true;
        this.connected = false;
    }

    /**
     * Emits a raw gateway dispatch.
     *
     * @param t - The dispatch type.
     * @param d - The dispatch data.
     * @param shardId - The shard the dispatch came from.
     */
    public dispatch(t: string, d: unknown, shardId = 0): void {
        this.emit('dispatch', { t, d, s: 1, op: 0 }, shardId);
    }
}
