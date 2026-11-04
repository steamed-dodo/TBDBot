import { describe, expect, it } from 'vitest';

import { Cache } from '../../src/cache/index';
import { MemoryStore } from '../../src/store/index';

describe('cache', () => {
    it('enables the minimal tier by default', () => {
        const cache = new Cache({ autoSweep: false });

        expect(cache.isEnabled('roles')).toBe(true);
        expect(cache.isEnabled('channel')).toBe(true);
        expect(cache.isEnabled('guild')).toBe(false);
        expect(cache.isEnabled('user')).toBe(false);
    });

    it('enables every kind in the inclusive tier', () => {
        const cache = new Cache({ tier: 'inclusive', autoSweep: false });

        expect(cache.isEnabled('guild')).toBe(true);
        expect(cache.isEnabled('user')).toBe(true);
        expect(cache.isEnabled('message')).toBe(true);
    });

    it('stores and reads a value', async () => {
        const cache = new Cache({ autoSweep: false });

        await cache.set('roles', 'guild-1', [{ id: 'role-1' }]);

        expect(await cache.get('roles', 'guild-1')).toEqual([
            { id: 'role-1' },
        ]);
    });

    it('does not store values for disabled kinds', async () => {
        const cache = new Cache({ autoSweep: false });

        await cache.set('guild', 'guild-1', { id: 'guild-1' });

        expect(await cache.get('guild', 'guild-1')).toBeUndefined();
    });

    it('expires entries whose lifetime has elapsed', async () => {
        const cache = new Cache({
            autoSweep: false,
            kinds: { roles: { enabled: true, ttl: -1 } },
        });

        await cache.set('roles', 'guild-1', { id: 'guild-1' });

        expect(await cache.get('roles', 'guild-1')).toBeUndefined();
    });

    it('removes the entries of a guild', async () => {
        const cache = new Cache({ tier: 'inclusive', autoSweep: false });

        await cache.set('roles', 'guild-1', { id: 'guild-1' });
        await cache.set('guild', 'guild-1', { id: 'guild-1' });

        await cache.invalidateGuild('guild-1');

        expect(await cache.get('roles', 'guild-1')).toBeUndefined();
        expect(await cache.get('guild', 'guild-1')).toBeUndefined();
    });

    it('keeps at most 200 messages per channel', async () => {
        const cache = new Cache({ tier: 'inclusive', autoSweep: false });

        for (let index = 0; index < 205; index += 1) {
            await cache.set('message', `channel-1:${index}`, { index });
        }

        expect(await cache.get('message', 'channel-1:0')).toBeUndefined();
        expect(await cache.get('message', 'channel-1:204')).toEqual({
            index: 204,
        });
    });

    it('uses the supplied store', async () => {
        const store = new MemoryStore<string>();
        const cache = new Cache({ store, autoSweep: false });

        await cache.set('roles', 'guild-1', { id: 'guild-1' });

        expect(await store.get('roles:guild-1')).toBeDefined();
    });

    it('reclaims expired entries when it sweeps', async () => {
        const store = new MemoryStore<string>();
        const cache = new Cache({
            store,
            autoSweep: false,
            kinds: { roles: { enabled: true, ttl: -1 } },
        });

        await cache.set('roles', 'guild-1', { id: 'guild-1' });
        await cache.sweep();

        expect(await store.get('roles:guild-1')).toBeUndefined();
    });
});
