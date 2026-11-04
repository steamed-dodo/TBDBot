import {
    assertBoundedLabel,
    assertLabelsMatch,
    formatLabels,
    sampleName,
} from './labels';
import type { Labels } from './labels';

/**
 * A monotonically increasing counter.
 */
export class Counter {
    private readonly values = new Map<string, number>();

    /**
     * @param name - The name of the metric.
     * @param help - The description of the metric.
     * @param labelNames - The names of the metric's labels.
     */
    constructor(
        public readonly name: string,
        public readonly help: string,
        public readonly labelNames: readonly string[] = [],
    ) {}

    /**
     * Increases the counter.
     *
     * @param labels - The labels of the sample.
     * @param value - The amount to add.
     */
    public inc(labels?: Labels, value = 1): void {
        assertLabelsMatch(this.labelNames, labels);
        this.validate(labels);

        const key = sampleName(this.name, labels);

        this.values.set(key, (this.values.get(key) ?? 0) + value);
    }

    /**
     * Reads the current value of the counter.
     *
     * @param labels - The labels of the sample.
     * @returns The value of the counter.
     */
    public get(labels?: Labels): number {
        return this.values.get(sampleName(this.name, labels)) ?? 0;
    }

    /** Resets the counter. */
    public reset(): void {
        this.values.clear();
    }

    /**
     * Renders the counter in the Prometheus text format.
     *
     * @returns The exposition of the counter.
     */
    public expose(): string {
        const lines = [
            `# HELP ${this.name} ${this.help}`,
            `# TYPE ${this.name} counter`,
        ];

        const samples = [...this.values.entries()].sort(([a], [b]) =>
            a.localeCompare(b),
        );

        for (const [key, value] of samples) {
            lines.push(`${key} ${value}`);
        }

        return lines.join('\n');
    }

    private validate(labels: Labels | undefined): void {
        if (!labels) {
            return;
        }

        for (const name of this.labelNames) {
            const value = labels[name];

            if (value !== undefined) {
                assertBoundedLabel(name, value);
            }
        }
    }
}

/**
 * A value that can go up and down.
 */
export class Gauge {
    private readonly values = new Map<string, number>();

    /**
     * @param name - The name of the metric.
     * @param help - The description of the metric.
     * @param labelNames - The names of the metric's labels.
     */
    constructor(
        public readonly name: string,
        public readonly help: string,
        public readonly labelNames: readonly string[] = [],
    ) {}

    /**
     * Sets the value of the gauge.
     *
     * @param value - The new value.
     * @param labels - The labels of the sample.
     */
    public set(value: number, labels?: Labels): void {
        assertLabelsMatch(this.labelNames, labels);
        this.validate(labels);
        this.values.set(sampleName(this.name, labels), value);
    }

    /**
     * Increases the gauge.
     *
     * @param labels - The labels of the sample.
     * @param value - The amount to add.
     */
    public inc(labels?: Labels, value = 1): void {
        assertLabelsMatch(this.labelNames, labels);
        this.validate(labels);
        const key = sampleName(this.name, labels);
        this.values.set(key, (this.values.get(key) ?? 0) + value);
    }

    /**
     * Decreases the gauge.
     *
     * @param labels - The labels of the sample.
     * @param value - The amount to subtract.
     */
    public dec(labels?: Labels, value = 1): void {
        assertLabelsMatch(this.labelNames, labels);
        this.validate(labels);
        const key = sampleName(this.name, labels);
        this.values.set(key, (this.values.get(key) ?? 0) - value);
    }

    private validate(labels: Labels | undefined): void {
        if (!labels) {
            return;
        }

        for (const name of this.labelNames) {
            const value = labels[name];

            if (value !== undefined) {
                assertBoundedLabel(name, value);
            }
        }
    }

    /**
     * Reads the current value of the gauge.
     *
     * @param labels - The labels of the sample.
     * @returns The value of the gauge.
     */
    public get(labels?: Labels): number {
        return this.values.get(sampleName(this.name, labels)) ?? 0;
    }

    /** Resets the gauge. */
    public reset(): void {
        this.values.clear();
    }

    /**
     * Renders the gauge in the Prometheus text format.
     *
     * @returns The exposition of the gauge.
     */
    public expose(): string {
        const lines = [
            `# HELP ${this.name} ${this.help}`,
            `# TYPE ${this.name} gauge`,
        ];

        const samples = [...this.values.entries()].sort(([a], [b]) =>
            a.localeCompare(b),
        );

        for (const [key, value] of samples) {
            lines.push(`${key} ${value}`);
        }

        return lines.join('\n');
    }
}

/**
 * A histogram of observed values.
 */
export class Histogram {
    private readonly buckets = new Map<
        string,
        {
            labels: Labels;
            counts: number[];
            sum: number;
            count: number;
        }
    >();

    /**
     * @param name - The name of the metric.
     * @param help - The description of the metric.
     * @param labelNames - The names of the metric's labels.
     * @param buckets - The upper bounds of the buckets.
     */
    constructor(
        public readonly name: string,
        public readonly help: string,
        public readonly labelNames: readonly string[] = [],
        public readonly bucketBounds: readonly number[] = [
            0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
        ],
    ) {}

    /**
     * Records an observation.
     *
     * @param value - The observed value.
     * @param labels - The labels of the sample.
     */
    public observe(value: number, labels?: Labels): void {
        assertLabelsMatch(this.labelNames, labels);
        this.validate(labels);

        const key = sampleName(this.name, labels);
        const bucket = this.buckets.get(key) ?? {
            labels: labels ?? {},
            counts: new Array(this.bucketBounds.length).fill(0),
            sum: 0,
            count: 0,
        };

        for (const [index, bound] of this.bucketBounds.entries()) {
            if (value <= bound) {
                bucket.counts[index] = (bucket.counts[index] ?? 0) + 1;
            }
        }

        bucket.sum += value;
        bucket.count += 1;

        this.buckets.set(key, bucket);
    }

    private validate(labels: Labels | undefined): void {
        if (!labels) {
            return;
        }

        for (const name of this.labelNames) {
            const value = labels[name];

            if (value !== undefined) {
                assertBoundedLabel(name, value);
            }
        }
    }

    /**
     * Reads the number of observations.
     *
     * @param labels - The labels of the sample.
     * @returns The number of observations.
     */
    public count(labels?: Labels): number {
        return this.buckets.get(sampleName(this.name, labels))?.count ?? 0;
    }

    /**
     * Reads the sum of the observations.
     *
     * @param labels - The labels of the sample.
     * @returns The sum of the observations.
     */
    public sum(labels?: Labels): number {
        return this.buckets.get(sampleName(this.name, labels))?.sum ?? 0;
    }

    /** Resets the histogram. */
    public reset(): void {
        this.buckets.clear();
    }

    /**
     * Renders the histogram in the Prometheus text format.
     *
     * @returns The exposition of the histogram.
     */
    public expose(): string {
        const lines = [
            `# HELP ${this.name} ${this.help}`,
            `# TYPE ${this.name} histogram`,
        ];

        const entries = [...this.buckets.entries()].sort(([a], [b]) =>
            a.localeCompare(b),
        );

        for (const [, bucket] of entries) {
            for (const [index, bound] of this.bucketBounds.entries()) {
                lines.push(
                    `${this.name}_bucket${formatLabels({
                        ...bucket.labels,
                        le: String(bound),
                    })} ${bucket.counts[index] ?? 0}`,
                );
            }

            lines.push(
                `${this.name}_bucket${formatLabels({
                    ...bucket.labels,
                    le: '+Inf',
                })} ${bucket.count}`,
            );
            lines.push(
                `${this.name}_sum${formatLabels(bucket.labels)} ${bucket.sum}`,
            );
            lines.push(
                `${this.name}_count${formatLabels(bucket.labels)} ${bucket.count}`,
            );
        }

        return lines.join('\n');
    }
}
