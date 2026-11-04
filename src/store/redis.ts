import type { RedisLikeClient, Store } from './types';

/**
 * Redis backed {@link Store} implementation.
 *
 * The client is injected rather than constructed, so the framework does not
 * depend on a particular Redis driver. Values are serialised as JSON.
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

    async keys(): Promise<string[]> {
        const keys = await this.client.keys(`${this.prefix}*`);

        return keys.map((key) => key.slice(this.prefix.length));
    }

    async has(key: string): Promise<boolean> {
        const raw = await this.client.get(this.prefix + key);

        return raw !== null && raw !== undefined;
    }

    async clear(): Promise<void> {
        for (const key of await this.keys()) {
            await this.delete(key);
        }
    }
}
