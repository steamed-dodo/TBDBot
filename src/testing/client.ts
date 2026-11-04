import { FrameworkClient } from '../core/Client';
import type { FrameworkClientOptions } from '../core/Client';
import { createInteraction } from '../interaction/interaction';
import type { Interaction } from '../interaction/types';
import { MockGateway, MockTransport, createMockRest } from './mock';

/**
 * A framework client wired to mock transports.
 */
export interface MockClient {
    /** The client. */
    readonly client: FrameworkClient;

    /** The transport recording the REST requests. */
    readonly transport: MockTransport;

    /** The gateway the dispatches are pushed into. */
    readonly gateway: MockGateway;

    /**
     * Creates a framework interaction from a raw payload.
     *
     * @param raw - The payload Discord would have sent.
     * @returns The interaction.
     */
    createInteraction(
        raw: Parameters<typeof createInteraction>[0],
    ): Interaction;

    /**
     * Pushes a raw gateway dispatch into the client.
     *
     * @param t - The dispatch type.
     * @param d - The dispatch data.
     */
    dispatch(t: string, d: unknown, shardId?: number): void;
}

/**
 * Builds a framework client backed by mock transports.
 *
 * @param options - Client options.
 * @returns The mock client.
 */
export function createMockClient(
    options: Partial<FrameworkClientOptions> = {},
): MockClient {
    const transport = new MockTransport();
    const rest = createMockRest(transport);
    const gateway = new MockGateway();

    const client = new FrameworkClient({
        token: 'test-token',
        rest,
        gateway,
        ...options,
    });

    return {
        client,
        transport,
        gateway,
        createInteraction: (raw) =>
            createInteraction(raw, client.api.interactions),
        dispatch: (t, d, shardId) => gateway.dispatch(t, d, shardId),
    };
}
