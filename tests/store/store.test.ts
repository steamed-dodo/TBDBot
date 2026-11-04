import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JsonFileStore, MemoryStore, RedisStore } from '../../src/store/index';

describe('memory store', () => {
    it('stores, reads and deletes values', async () => {
        const store = new MemoryStore<string>();

        await store.set('a', 'value');

        expect(await store.get('a')).toBe('value');
        expect(await store.has('a')).toBe(true);
        expect(await store.keys()).toEqual(['a']);

        await store.delete('a');

        expect(await store.get('a')).toBeUndefined();
    });

    it('clears every value', async () => {
        const store = new MemoryStore<string>();

        await store.set('a', 'value');
        await store.clear();

        expect(await store.keys()).toEqual([]);
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

        expect(await store.keys()).toEqual([]);
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
    it('serialises values and strips the prefix', async () => {
        const values = new Map<string, string>();

        const client = {
            get: async (key: string) => values.get(key) ?? null,
            set: async (key: string, value: string) => {
                values.set(key, value);
            },
            del: async (key: string) => {
                values.delete(key);
            },
            keys: async (pattern: string) =>
                [...values.keys()].filter((key) =>
                    key.startsWith(pattern.replace('*', '')),
                ),
        };

        const store = new RedisStore<{ count: number }>(client, 'tbd:');

        await store.set('a', { count: 1 });

        expect(values.get('tbd:a')).toBe('{"count":1}');
        expect(await store.get('a')).toEqual({ count: 1 });
        expect(await store.keys()).toEqual(['a']);
        expect(await store.has('a')).toBe(true);

        await store.delete('a');

        expect(await store.get('a')).toBeUndefined();
    });
});
