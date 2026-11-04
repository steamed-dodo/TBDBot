import type { RedisLikeClient, Store } from './types';

/**
 * How many keys Redis is asked to examine per `SCAN` call.
 *
 * `COUNT` is a hint, not a guarantee, so the store never assumes the batch
 * size.
 */
const SCAN_COUNT = 100;

/**
 * Redis backed {@link Store} implementation.
 *
 * The client is injected rather than constructed, so the framework does not
 * depend on a particular Redis driver. Values are serialised as JSON.
 *
 * Listing walks the keyspace with `SCAN` rather than `KEYS`: `KEYS` is O(N)
 * over the whole keyspace and blocks the server while it runs, which is a
 * production hazard on a shared instance.
 */
export class RedisStore<TValue = unknown> implements Store<TValue> {
    /**
     * @param client - The Redis client used to talk to the server.
     * @param prefix - Prefix prepended to every key.
     */
    constructor(
        private readonly client: RedisLikeClient,
        private readonly prefix = 'tbd:',
    ) {}

    async get(key: string): Promise<TValue | undefined> {
        const raw = await this.client.get(this.prefix + key);

        if (raw === null || raw === undefined) {
            return undefined;
        }

        return JSON.parse(raw) as TValue;
    }

    async set(key: string, value: TValue): Promise<void> {
        await this.client.set(this.prefix + key, JSON.stringify(value));
    }

    async delete(key: string): Promise<void> {
        await this.client.del(this.prefix + key);
    }

    async scan(cursor: string): Promise<{ keys: string[]; cursor: string }> {
        const [next, keys] = await this.client.scan(
            cursor,
            `${this.prefix}*`,
            SCAN_COUNT,
        );

        return {
            keys: keys.map((key) => key.slice(this.prefix.length)),
            cursor: next,
        };
    }

    async has(key: string): Promise<boolean> {
        const raw = await this.client.get(this.prefix + key);

        return raw !== null && raw !== undefined;
    }

    async clear(): Promise<void> {
        let cursor = '0';

        do {
            const page = await this.scan(cursor);

            cursor = page.cursor;

            for (const key of page.keys) {
                await this.delete(key);
            }
        } while (cursor !== '0');
    }
}
