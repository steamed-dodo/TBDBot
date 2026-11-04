import { describe, expect, it } from 'vitest';

import { MetricRegistry } from '../../src/metrics/registry';
import { createMetricsHandler } from '../../src/metrics/server';

describe('metrics registry', () => {
    it('renders a counter in the Prometheus text format', () => {
        const registry = new MetricRegistry();
        const counter = registry.counter(
            'bot_interactions_total',
            'Total number of interactions.',
            ['type'],
        );

        counter.inc({ type: 'messageComponent' });

        const exposition = registry.expose();

        expect(exposition).toContain('# HELP bot_interactions_total');
        expect(exposition).toContain('# TYPE bot_interactions_total counter');
        expect(exposition).toContain(
            'bot_interactions_total{type="messageComponent"} 1',
        );
    });

    it('renders a gauge', () => {
        const registry = new MetricRegistry();
        const gauge = registry.gauge('bot_heap_used_bytes', 'Heap usage.');

        gauge.set(1024);

        expect(registry.expose()).toContain('bot_heap_used_bytes 1024');
    });

    it('renders a histogram with cumulative buckets', () => {
        const registry = new MetricRegistry();
        const histogram = registry.histogram(
            'bot_command_duration_seconds',
            'Command duration.',
            ['name'],
            [0.1, 1],
        );

        histogram.observe(0.05, { name: 'ping' });
        histogram.observe(0.5, { name: 'ping' });

        const exposition = registry.expose();

        expect(exposition).toContain(
            'bot_command_duration_seconds_bucket{name="ping",le="0.1"} 1',
        );
        expect(exposition).toContain(
            'bot_command_duration_seconds_bucket{name="ping",le="1"} 2',
        );
        expect(exposition).toContain(
            'bot_command_duration_seconds_bucket{name="ping",le="+Inf"} 2',
        );
        expect(exposition).toContain(
            'bot_command_duration_seconds_count{name="ping"} 2',
        );
    });

    it('rejects a sample whose labels do not match', () => {
        const registry = new MetricRegistry();
        const counter = registry.counter('bot_test_total', 'Test.', ['name']);

        expect(() => counter.inc({ other: 'x' })).toThrow(TypeError);
        expect(() => counter.inc()).toThrow(TypeError);
    });

    it('rejects unbounded label values', () => {
        const registry = new MetricRegistry();
        const counter = registry.counter('bot_test_total', 'Test.', ['name']);

        expect(() => counter.inc({ name: 'x'.repeat(65) })).toThrow(TypeError);
    });

    describe('defects found in the third pass', () => {
        it('rejects unbounded labels on a gauge', () => {
            const registry = new MetricRegistry();
            const gauge = registry.gauge('bot_test_gauge', 'Test.', ['name']);

            expect(() => gauge.set(1, { name: 'x'.repeat(65) })).toThrow(
                TypeError,
            );
            expect(() => gauge.inc({ name: 'x'.repeat(65) })).toThrow(
                TypeError,
            );
            expect(() => gauge.dec({ name: 'x'.repeat(65) })).toThrow(
                TypeError,
            );
        });

        it('rejects unbounded labels on a histogram', () => {
            const registry = new MetricRegistry();
            const histogram = registry.histogram(
                'bot_test_seconds',
                'Test.',
                ['name'],
                [1],
            );

            expect(() =>
                histogram.observe(1, { name: 'x'.repeat(65) }),
            ).toThrow(TypeError);
        });

        it('rejects an undeclared label on a gauge increment', () => {
            const registry = new MetricRegistry();
            const gauge = registry.gauge('bot_test_gauge', 'Test.', ['name']);

            expect(() => gauge.inc({ other: 'x' })).toThrow(TypeError);
        });
    });
});

describe('metrics handler', () => {
    it('serves the exposition on the metrics path', async () => {
        const registry = new MetricRegistry();
        registry.counter('bot_test_total', 'Test.').inc();

        const handler = createMetricsHandler(registry);

        const response = await invoke(handler.listener, '/metrics');

        expect(response.status).toBe(200);
        expect(response.body).toContain('bot_test_total 1');
    });

    it('answers 404 for unknown paths', async () => {
        const registry = new MetricRegistry();
        const handler = createMetricsHandler(registry);

        const response = await invoke(handler.listener, '/nope');

        expect(response.status).toBe(404);
    });

    it('answers a health check', async () => {
        const registry = new MetricRegistry();
        const handler = createMetricsHandler(registry);

        const response = await invoke(handler.listener, '/healthz');

        expect(response.status).toBe(200);
        expect(response.body).toBe('ok');
    });
});

interface FakeResponse {
    status: number;
    body: string;
}

async function invoke(
    listener: (
        request: { url?: string },
        response: {
            writeHead: (
                status: number,
                headers?: Record<string, string>,
            ) => void;
            end: (body?: string) => void;
        },
    ) => void,
    url: string,
): Promise<FakeResponse> {
    const response: FakeResponse & {
        writeHead: (status: number, headers?: Record<string, string>) => void;
        end: (body?: string) => void;
    } = {
        status: 0,
        body: '',
        writeHead(status: number) {
            response.status = status;
        },
        end(body?: string) {
            response.body = body ?? '';
        },
    };

    listener({ url }, response);

    return response;
}
