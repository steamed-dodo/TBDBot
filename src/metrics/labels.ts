/**
 * The label set of a metric sample.
 */
export type Labels = Readonly<Record<string, string>>;

/**
 * The value of a metric with no labels.
 */
const NO_LABELS = '';

/**
 * Serialises a label set into the Prometheus label syntax.
 *
 * @param labels - The labels of the sample.
 * @returns The serialised labels, including the surrounding braces.
 */
export function formatLabels(labels: Labels | undefined): string {
    if (!labels) {
        return NO_LABELS;
    }

    const entries = Object.entries(labels);

    if (entries.length === 0) {
        return NO_LABELS;
    }

    const body = entries
        .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
        .join(',');

    return `{${body}}`;
}

function escapeLabelValue(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/"/g, '\\"');
}

/**
 * Serialises a metric name and its labels into a Prometheus sample name.
 *
 * @param name - The name of the metric.
 * @param labels - The labels of the sample.
 * @returns The sample name.
 */
export function sampleName(name: string, labels: Labels | undefined): string {
    return `${name}${formatLabels(labels)}`;
}

/**
 * Sorts label sets so that the exposition is stable.
 *
 * @param labelNames - The label names of the metric.
 * @returns A function comparing two label sets.
 */
export function labelComparator(
    labelNames: readonly string[],
): (a: Labels, b: Labels) => number {
    return (a, b) => {
        for (const name of labelNames) {
            const left = a[name] ?? '';
            const right = b[name] ?? '';

            if (left !== right) {
                return left < right ? -1 : 1;
            }
        }

        return 0;
    };
}

/**
 * Validates a label value.
 *
 * Label sets must be bounded: unbounded label cardinality will take down the
 * Prometheus server. The framework rejects values that are clearly not
 * bounded, and the documentation asks users not to use IDs as labels.
 *
 * @param name - The name of the label.
 * @param value - The value of the label.
 * @throws {TypeError} When the value is empty or unreasonably long.
 */
export function assertBoundedLabel(name: string, value: string): void {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`Label "${name}" must be a non-empty string.`);
    }

    if (value.length > 64) {
        throw new TypeError(
            `Label "${name}" must not exceed 64 characters; unbounded label values will take down the metrics server.`,
        );
    }
}

/**
 * Checks that a sample's labels match the metric's label names.
 *
 * @param labelNames - The label names of the metric.
 * @param labels - The labels of the sample.
 * @throws {TypeError} When the labels do not match.
 */
export function assertLabelsMatch(
    labelNames: readonly string[],
    labels: Labels | undefined,
): void {
    if (!labels) {
        if (labelNames.length > 0) {
            throw new TypeError(
                `Expected labels ${labelNames.join(', ')} but none were given.`,
            );
        }

        return;
    }

    for (const name of labelNames) {
        if (!Object.hasOwn(labels, name)) {
            throw new TypeError(`Missing label "${name}".`);
        }
    }

    for (const name of Object.keys(labels)) {
        if (!labelNames.includes(name)) {
            throw new TypeError(`Unexpected label "${name}".`);
        }
    }
}
