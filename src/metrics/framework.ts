import { createServer } from 'node:http';
import type { Server } from 'node:http';

import { MetricRegistry } from './registry';
import { Counter, Gauge, Histogram } from './metrics';
import { createMetricsHandler, serveMetrics } from './server';
import type { MetricsHandler, ServeMetricsOptions } from './server';

/**
 * The metrics the framework exposes out of the box.
 *
 * Label sets are deliberately bounded: no user IDs and no guild IDs are used
 * as labels, because unbounded label cardinality will take down the
 * Prometheus server.
 */
export class FrameworkMetrics {
    /** The registry holding every metric. */
    public readonly registry = new MetricRegistry();

    /** Number of interactions handled, by interaction type. */
    public readonly interactions: Counter;

    /** Number of command invocations, by command name and outcome. */
    public readonly commands: Counter;

    /** Duration of command invocations. */
    public readonly commandDuration: Histogram;

    /** Number of errors, by source. */
    public readonly errors: Counter;

    /** Number of REST requests, by route and status. */
    public readonly restRequests: Counter;

    /** Number of rate limited REST requests. */
    public readonly restRateLimited: Counter;

    /** Current gateway latency, in seconds. */
    public readonly gatewayLatency: Gauge;

    /** Number of gateway reconnects. */
    public readonly gatewayReconnects: Counter;

    /** Heap usage of the process, in bytes. */
    public readonly heapUsed: Gauge;

    /** Event loop lag of the process, in seconds. */
    public readonly eventLoopLag: Gauge;

    /** Uptime of the process, in seconds. */
    public readonly uptime: Gauge;

    private sampler: ReturnType<typeof setInterval> | null = null;

    private lastTick = 0;

    /**
     * @param options - Sampling options.
     */
    constructor(
        options: {
            /** How often the runtime metrics are sampled, in milliseconds. */
            readonly sampleInterval?: number;
        } = {},
    ) {
        this.interactions = this.registry.counter(
            'bot_interactions_total',
            'Total number of interactions handled.',
            ['type'],
        );

        this.commands = this.registry.counter(
            'bot_commands_total',
            'Total number of command invocations.',
            ['name', 'outcome'],
        );

        this.commandDuration = this.registry.histogram(
            'bot_command_duration_seconds',
            'Duration of command invocations, in seconds.',
            ['name'],
            [0.1, 0.5, 1, 2.5, 5, 10],
        );

        this.errors = this.registry.counter(
            'bot_errors_total',
            'Total number of errors.',
            ['source'],
        );

        this.restRequests = this.registry.counter(
            'bot_rest_requests_total',
            'Total number of REST requests.',
            ['route', 'status'],
        );

        this.restRateLimited = this.registry.counter(
            'bot_rest_rate_limited_total',
            'Total number of rate limited REST requests.',
        );

        this.gatewayLatency = this.registry.gauge(
            'bot_gateway_latency_seconds',
            'Current gateway latency, in seconds.',
        );

        this.gatewayReconnects = this.registry.counter(
            'bot_gateway_reconnects_total',
            'Total number of gateway reconnects.',
        );

        this.heapUsed = this.registry.gauge(
            'bot_heap_used_bytes',
            'Heap usage of the process, in bytes.',
        );

        this.eventLoopLag = this.registry.gauge(
            'bot_event_loop_lag_seconds',
            'Event loop lag of the process, in seconds.',
        );

        this.uptime = this.registry.gauge(
            'bot_uptime_seconds',
            'Uptime of the process, in seconds.',
        );

        const interval = options.sampleInterval ?? 10_000;

        this.lastTick = performance.now();

        this.sampler = setInterval(() => {
            const now = performance.now();
            const lag = Math.max(0, (now - this.lastTick - interval) / 1000);

            this.lastTick = now;

            this.eventLoopLag.set(lag);
            this.heapUsed.set(process.memoryUsage().heapUsed);
            this.uptime.set(process.uptime());
        }, interval);

        this.sampler.unref?.();
    }

    /**
     * Builds a mountable HTTP handler exposing the metrics.
     *
     * @returns The handler.
     */
    public handler(): MetricsHandler {
        return createMetricsHandler(this.registry);
    }

    /**
     * Serves the metrics on their own HTTP server.
     *
     * @param options - Server options.
     * @returns The running server.
     */
    public serve(
        options: Omit<ServeMetricsOptions, 'registry'> & { readonly registry?: MetricRegistry },
    ): Server {
        return serveMetrics({
            ...options,
            registry: options.registry ?? this.registry,
        });
    }

    /**
     * Builds an HTTP server exposing the metrics, without starting it.
     *
     * @param path - The path the metrics are exposed on.
     * @returns The server.
     */
    public server(path?: string): Server {
        const handler = createMetricsHandler(this.registry, {
            ...(path === undefined ? {} : { path }),
        });

        return createServer(handler.listener);
    }

    /** Stops the runtime sampler. */
    public stop(): void {
        if (this.sampler) {
            clearInterval(this.sampler);
            this.sampler = null;
        }
    }
}
