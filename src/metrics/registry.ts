import { Counter, Gauge, Histogram } from './metrics';

/**
 * A registry of metrics.
 *
 * The registry owns the metric instances and renders the Prometheus text
 * exposition.
 */
export class MetricRegistry {
    private readonly counters = new Map<string, Counter>();

    private readonly gauges = new Map<string, Gauge>();

    private readonly histograms = new Map<string, Histogram>();

    /**
     * Registers a counter.
     *
     * @param name - The name of the metric.
     * @param help - The description of the metric.
     * @param labelNames - The names of the metric's labels.
     * @returns The counter.
     */
    public counter(
        name: string,
        help: string,
        labelNames: readonly string[] = [],
    ): Counter {
        const existing = this.counters.get(name);

        if (existing) {
            return existing;
        }

        const counter = new Counter(name, help, labelNames);

        this.counters.set(name, counter);

        return counter;
    }

    /**
     * Registers a gauge.
     *
     * @param name - The name of the metric.
     * @param help - The description of the metric.
     * @param labelNames - The names of the metric's labels.
     * @returns The gauge.
     */
    public gauge(
        name: string,
        help: string,
        labelNames: readonly string[] = [],
    ): Gauge {
        const existing = this.gauges.get(name);

        if (existing) {
            return existing;
        }

        const gauge = new Gauge(name, help, labelNames);

        this.gauges.set(name, gauge);

        return gauge;
    }

    /**
     * Registers a histogram.
     *
     * @param name - The name of the metric.
     * @param help - The description of the metric.
     * @param labelNames - The names of the metric's labels.
     * @param buckets - The upper bounds of the buckets.
     * @returns The histogram.
     */
    public histogram(
        name: string,
        help: string,
        labelNames: readonly string[] = [],
        buckets?: readonly number[],
    ): Histogram {
        const existing = this.histograms.get(name);

        if (existing) {
            return existing;
        }

        const histogram =
            buckets === undefined
                ? new Histogram(name, help, labelNames)
                : new Histogram(name, help, labelNames, buckets);

        this.histograms.set(name, histogram);

        return histogram;
    }

    /**
     * Looks up a registered counter.
     *
     * @param name - The name of the metric.
     * @returns The counter, or `undefined` when it is not registered.
     */
    public getCounter(name: string): Counter | undefined {
        return this.counters.get(name);
    }

    /**
     * Looks up a registered gauge.
     *
     * @param name - The name of the metric.
     * @returns The gauge, or `undefined` when it is not registered.
     */
    public getGauge(name: string): Gauge | undefined {
        return this.gauges.get(name);
    }

    /**
     * Looks up a registered histogram.
     *
     * @param name - The name of the metric.
     * @returns The histogram, or `undefined` when it is not registered.
     */
    public getHistogram(name: string): Histogram | undefined {
        return this.histograms.get(name);
    }

    /** Removes every registered metric. */
    public clear(): void {
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
    }

    /**
     * Renders the Prometheus text exposition of every registered metric.
     *
     * @returns The exposition.
     */
    public expose(): string {
        const blocks: string[] = [];

        for (const counter of this.counters.values()) {
            blocks.push(counter.expose());
        }

        for (const gauge of this.gauges.values()) {
            blocks.push(gauge.expose());
        }

        for (const histogram of this.histograms.values()) {
            blocks.push(histogram.expose());
        }

        return blocks.join('\n');
    }
}
