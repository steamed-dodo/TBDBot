import type { Store } from './types';

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

    async keys(): Promise<string[]> {
        return [...this.values.keys()];
    }

    async has(key: string): Promise<boolean> {
        return this.values.has(key);
    }

    async clear(): Promise<void> {
        this.values.clear();
    }
}
