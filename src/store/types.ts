/**
 * A simple key-value store.
 *
 * The interface is deliberately plain: TTL and compare-and-set semantics
 * belong to the cache layer built on top of it, not to the store itself.
 *
 * Listing is cursor-based rather than a single full listing, because a
 * full listing of a large keyspace is the wrong shape for a remote store:
 * Redis's `KEYS` blocks the server, while `SCAN` does not.
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
     * Lists keys in batches.
     *
     * Pass `'0'` to start, and keep calling with the returned cursor until
     * it comes back as `'0'` again.
     *
     * @param cursor - The cursor returned by the previous call.
     * @returns A batch of keys and the cursor to continue from.
     */
    scan(cursor: string): Promise<{ keys: string[]; cursor: string }>;

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
 * Only the commands the store needs are required, which keeps the
 * framework free of a hard dependency on a particular Redis client.
 *
 * `scan` is the cursor-based sibling of `KEYS`: an adapter should issue
 * `SCAN <cursor> MATCH <match> COUNT <count>` and return the new cursor and
 * the batch of keys. It must not fall back to `KEYS`.
 */
export interface RedisLikeClient {
    /** Reads a string value. */
    get(key: string): Promise<string | null>;

    /** Writes a string value. */
    set(key: string, value: string): Promise<unknown>;

    /** Deletes one or more keys. */
    del(key: string): Promise<unknown>;

    /**
     * Iterates the keyspace without blocking the server.
     *
     * @param cursor - The cursor returned by the previous call.
     * @param match - The pattern to match.
     * @param count - A hint for how much work to do per call.
     * @returns The next cursor and the batch of matching keys.
     */
    scan(
        cursor: string,
        match: string,
        count: number,
    ): Promise<[cursor: string, keys: string[]]>;
}
