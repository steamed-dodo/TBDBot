/**
 * A simple key-value store.
 *
 * The interface is deliberately plain: TTL and compare-and-set semantics
 * belong to the cache layer built on top of it, not to the store itself.
 */
export interface Store<TValue = unknown> {
    /**
     * Reads a value.
     *
     * @param key - Key to read.
     * @returns The stored value, or `undefined` when the key is unknown.
     */
    get(key: string): Promise<TValue | undefined>;

    /**
     * Writes a value.
     *
     * @param key - Key to write.
     * @param value - Value to store.
     */
    set(key: string, value: TValue): Promise<void>;

    /**
     * Deletes a value.
     *
     * @param key - Key to delete.
     */
    delete(key: string): Promise<void>;

    /**
     * Lists every key in the store.
     *
     * @returns The stored keys.
     */
    keys(): Promise<string[]>;

    /**
     * Checks whether a key exists.
     *
     * @param key - Key to check.
     * @returns `true` when the key exists.
     */
    has(key: string): Promise<boolean>;

    /** Removes every value from the store. */
    clear(): Promise<void>;
}

/**
 * A minimal Redis-compatible client.
 *
 * Only the four commands the store needs are required, which keeps the
 * framework free of a hard dependency on a particular Redis client.
 */
export interface RedisLikeClient {
    /** Reads a string value. */
    get(key: string): Promise<string | null>;

    /** Writes a string value. */
    set(key: string, value: string): Promise<unknown>;

    /** Deletes one or more keys. */
    del(key: string): Promise<unknown>;

    /** Lists the keys matching a pattern. */
    keys(pattern: string): Promise<string[]>;
}
