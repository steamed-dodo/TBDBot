import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import type { MetricRegistry } from './registry';

/**
 * A mountable HTTP handler exposing the metrics.
 *
 * The framework does not own a port by default: in Kubernetes the bot
 * container and the metrics scraper are often separate concerns, so the
 * handler is returned to the user instead of being started automatically.
 */
export interface MetricsHandler {
    /** The Node request listener. */
    readonly listener: (
        request: IncomingMessage,
        response: ServerResponse,
    ) => void;

    /** The registry the handler exposes. */
    readonly registry: MetricRegistry;
}

/**
 * Builds a mountable HTTP handler exposing the metrics.
 *
 * @param registry - The registry to expose.
 * @param options - Handler options.
 * @returns The handler.
 */
export function createMetricsHandler(
    registry: MetricRegistry,
    options: { readonly path?: string } = {},
): MetricsHandler {
    const path = options.path ?? '/metrics';

    const listener = (
        request: IncomingMessage,
        response: ServerResponse,
    ): void => {
        const url = request.url ?? '/';

        if (url === path || url.startsWith(`${path}?`)) {
            response.writeHead(200, {
                'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
            });
            response.end(registry.expose());

            return;
        }

        if (url === '/healthz' || url === '/health') {
            response.writeHead(200, { 'Content-Type': 'text/plain' });
            response.end('ok');

            return;
        }

        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('not found');
    };

    return { listener, registry };
}

/**
 * Options accepted by {@link serveMetrics}.
 */
export interface ServeMetricsOptions {
    /** The registry to expose. */
    readonly registry: MetricRegistry;

    /** The port to listen on. */
    readonly port: number;

    /** The host to bind to. */
    readonly host?: string;

    /** The path the metrics are exposed on. */
    readonly path?: string;
}

/**
 * Serves the metrics on their own HTTP server.
 *
 * This is a convenience for the simple case. The server is never started
 * automatically.
 *
 * @param options - Server options.
 * @returns The running server.
 */
export function serveMetrics(options: ServeMetricsOptions): Server {
    const handler = createMetricsHandler(options.registry, {
        ...(options.path === undefined ? {} : { path: options.path }),
    });

    const server = createServer(handler.listener);

    server.listen(options.port, options.host);

    return server;
}
