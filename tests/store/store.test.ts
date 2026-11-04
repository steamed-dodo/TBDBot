import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JsonFileStore, MemoryStore, RedisStore } from '../../src/store/index';
import type { RedisLikeClient } from '../../src/store/index';

/**
 * Collects every key by walking a store's cursor.
 *
 * @param store - The store to walk.
 * @returns Every key in the store.
 */
async function allKeys(store: {
    scan(cursor: string): Promise<{ keys: string[]; cursor: string }>;
}): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
        const page = await store.scan(cursor);

        cursor = page.cursor;
        keys.push(...page.keys);
    } while (cursor !== '0');

    return keys;
}

describe('memory store', () => {
    it('stores, reads and deletes values', async () => {
        const store = new MemoryStore<string>();

        await store.set('a', 'value');

        expect(await store.get('a')).toBe('value');
        expect(await store.has('a')).toBe(true);
        expect(await allKeys(store)).toEqual(['a']);

        await store.delete('a');

        expect(await store.get('a')).toBeUndefined();
    });

    it('clears every value', async () => {
        const store = new MemoryStore<string>();

        await store.set('a', 'value');
        await store.clear();

        expect(await allKeys(store)).toEqual([]);
    });

    it('walks its keys in batches', async () => {
        const store = new MemoryStore<string>();

        for (let index = 0; index < 250; index += 1) {
            await store.set(`key-${index}`, 'value');
        }

        const first = await store.scan('0');

        expect(first.keys.length).toBeLessThan(250);
        expect(first.cursor).not.toBe('0');
        expect(await allKeys(store)).toHaveLength(250);
    });
});

describe('json file store', () => {
    let directory: string;

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'tbd-store-'));
    });

    afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    it('persists values across instances', async () => {
        const filePath = join(directory, 'store.json');
        const store = new JsonFileStore<string>(filePath);

        await store.set('a', 'value');

        const reopened = new JsonFileStore<string>(filePath);

        expect(await reopened.get('a')).toBe('value');
    });

    it('treats a missing file as an empty store', async () => {
        const store = new JsonFileStore<string>(
            join(directory, 'missing.json'),
        );

        expect(await allKeys(store)).toEqual([]);
    });

    it('writes valid JSON', async () => {
        const filePath = join(directory, 'store.json');
        const store = new JsonFileStore<string>(filePath);

        await store.set('a', 'value');

        const contents = await readFile(filePath, 'utf8');

        expect(JSON.parse(contents)).toEqual({ a: 'value' });
    });
});

describe('redis store', () => {
    function createClient(): {
        client: RedisLikeClient;
        values: Map<string, string>;
        scans: string[];
    } {
        const values = new Map<string, string>();
        const scans: string[] = [];

        const client: RedisLikeClient = {
            get: async (key) => values.get(key) ?? null,
            set: async (key, value) => {
                values.set(key, value);
            },
            del: async (key) => {
                values.delete(key);
            },
            scan: async (cursor, match) => {
                scans.push(cursor);

                const prefix = match.replace('*', '');
                const after = cursor === '0' ? '' : cursor;
                const matching = [...values.keys()]
                    .filter((key) => key.startsWith(prefix) && key > after)
                    .sort();

                // One key per call, to prove the cursor is walked.
                const batch = matching.slice(0, 1);

                if (batch.length === 0) {
                    return ['0', []];
                }

                const last = batch[batch.length - 1] as string;
                const hasMore = matching.length > batch.length;

                return [hasMore ? last : '0', batch];
            },
        };

        return { client, values, scans };
    }

    it('serialises values and strips the prefix', async () => {
        const { client, values } = createClient();
        const store = new RedisStore<{ count: number }>(client, 'tbd:');

        await store.set('a', { count: 1 });

        expect(values.get('tbd:a')).toBe('{"count":1}');
        expect(await store.get('a')).toEqual({ count: 1 });
        expect(await allKeys(store)).toEqual(['a']);
        expect(await store.has('a')).toBe(true);

        await store.delete('a');

        expect(await store.get('a')).toBeUndefined();
    });

    it('walks the keyspace with the cursor instead of listing it', async () => {
        const { client, scans } = createClient();
        const store = new RedisStore<string>(client, 'tbd:');

        await store.set('a', 'value');
        await store.set('b', 'value');

        expect(await allKeys(store)).toEqual(['a', 'b']);
        expect(scans.length).toBeGreaterThan(1);
    });

    it('clears the store without a full listing', async () => {
        const { client, values, scans } = createClient();
        const store = new RedisStore<string>(client, 'tbd:');

        await store.set('a', 'value');
        await store.set('b', 'value');

        await store.clear();

        expect(values.size).toBe(0);
        expect(scans.length).toBeGreaterThan(0);
    });
});
