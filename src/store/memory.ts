import type { Store } from './types';

/**
 * How many keys a scan returns at a time.
 */
const SCAN_BATCH = 100;

/**
 * In-memory {@link Store} implementation.
 *
 * Values only survive for the lifetime of the process.
 */
export class MemoryStore<TValue = unknown> implements Store<TValue> {
    private readonly values: Map<string, TValue>;

    /**
     * @param initial - Values the store starts with.
     */
    constructor(initial: Iterable<readonly [string, TValue]> = []) {
        this.values = new Map(initial);
    }

    async get(key: string): Promise<TValue | undefined> {
        return this.values.get(key);
    }

    async set(key: string, value: TValue): Promise<void> {
        this.values.set(key, value);
    }

    async delete(key: string): Promise<void> {
        this.values.delete(key);
    }

    async scan(cursor: string): Promise<{ keys: string[]; cursor: string }> {
        const keys = [...this.values.keys()];
        const start = Number.parseInt(cursor, 10) || 0;
        const page = keys.slice(start, start + SCAN_BATCH);
        const next = start + page.length;

        return {
            keys: page,
            cursor: next >= keys.length ? '0' : String(next),
        };
    }

    async has(key: string): Promise<boolean> {
        return this.values.has(key);
    }

    async clear(): Promise<void> {
        this.values.clear();
    }
}
