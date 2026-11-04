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

        expect(await cache.get('roles', 'guild-1')).toEqual([{ id: 'role-1' }]);
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

    describe('defects found in the second pass', () => {
        it('clears the channels of a guild', async () => {
            const cache = new Cache({ tier: 'inclusive', autoSweep: false });

            await cache.set('roles', 'guild-1', { id: 'guild-1' });
            await cache.set('channel', 'channel-1', {
                id: 'channel-1',
                guild_id: 'guild-1',
                permission_overwrites: [],
            });
            await cache.set('channel', 'channel-2', {
                id: 'channel-2',
                guild_id: 'guild-2',
                permission_overwrites: [],
            });

            await cache.invalidateGuild('guild-1');

            expect(await cache.get('roles', 'guild-1')).toBeUndefined();
            expect(await cache.get('channel', 'channel-1')).toBeUndefined();
            expect(await cache.get('channel', 'channel-2')).toBeDefined();
        });

        it('clears the members of a guild', async () => {
            const cache = new Cache({ tier: 'inclusive', autoSweep: false });

            await cache.set('guildMember', 'guild-1:user-1', { id: 'user-1' });
            await cache.set('guildMember', 'guild-1:user-2', { id: 'user-2' });
            await cache.set('guildMember', 'guild-2:user-3', { id: 'user-3' });

            await cache.invalidateGuild('guild-1');

            expect(
                await cache.get('guildMember', 'guild-1:user-1'),
            ).toBeUndefined();
            expect(
                await cache.get('guildMember', 'guild-1:user-2'),
            ).toBeUndefined();
            expect(
                await cache.get('guildMember', 'guild-2:user-3'),
            ).toBeDefined();
        });

        it('drops a deleted channel from the guild index', async () => {
            const cache = new Cache({ tier: 'inclusive', autoSweep: false });

            await cache.set('channel', 'channel-1', {
                id: 'channel-1',
                guild_id: 'guild-1',
            });

            await cache.delete('channel', 'channel-1');
            await cache.invalidateGuild('guild-1');

            expect(await cache.get('channel', 'channel-1')).toBeUndefined();
        });
    });

    describe('defects found in the third pass', () => {
        it('keeps an unrelated kind in the guild index when one kind is cleared', async () => {
            const cache = new Cache({ tier: 'inclusive', autoSweep: false });

            await cache.set('roles', 'guild-1', [{ id: 'role-1' }]);
            await cache.set('channel', 'channel-1', {
                id: 'channel-1',
                guild_id: 'guild-1',
            });
            await cache.set('guildMember', 'guild-1:user-1', { id: 'user-1' });

            await cache.clear('roles');
            await cache.invalidateGuild('guild-1');

            expect(await cache.get('channel', 'channel-1')).toBeUndefined();
            expect(
                await cache.get('guildMember', 'guild-1:user-1'),
            ).toBeUndefined();
        });

        it('does not let a deleted channel leak into a later guild invalidation', async () => {
            const cache = new Cache({ tier: 'inclusive', autoSweep: false });

            await cache.set('channel', 'channel-1', {
                id: 'channel-1',
                guild_id: 'guild-1',
            });
            await cache.delete('channel', 'channel-1');
            await cache.set('channel', 'channel-1', {
                id: 'channel-1',
                guild_id: 'guild-2',
            });

            await cache.invalidateGuild('guild-1');

            expect(await cache.get('channel', 'channel-1')).toBeDefined();
        });

        it('does not let an evicted channel leak into a later guild invalidation', async () => {
            const cache = new Cache({
                tier: 'inclusive',
                autoSweep: false,
                kinds: { channel: { maxSize: 1 } },
            });

            await cache.set('channel', 'channel-1', {
                id: 'channel-1',
                guild_id: 'guild-1',
            });
            await cache.set('channel', 'channel-2', {
                id: 'channel-2',
                guild_id: 'guild-2',
            });
            await cache.set('channel', 'channel-1', {
                id: 'channel-1',
                guild_id: 'guild-3',
            });

            await cache.invalidateGuild('guild-1');

            expect(await cache.get('channel', 'channel-1')).toBeDefined();
        });

        it('does not scan the store to enforce the limit of a kind', async () => {
            const store = new CountingStore();
            const cache = new Cache({
                store,
                autoSweep: false,
                kinds: { user: { enabled: true, maxSize: 2 } },
            });

            await cache.set('user', 'user-1', { id: 'user-1' });
            await cache.set('user', 'user-2', { id: 'user-2' });
            await cache.set('user', 'user-3', { id: 'user-3' });

            expect(store.scans).toBe(0);
            expect(await cache.get('user', 'user-1')).toBeUndefined();
            expect(await cache.get('user', 'user-3')).toBeDefined();
        });

        it('does not evict an entry that is written again', async () => {
            const cache = new Cache({
                autoSweep: false,
                kinds: { user: { enabled: true, maxSize: 1 } },
            });

            await cache.set('user', 'user-1', { id: 'user-1' });
            await cache.set('user', 'user-1', { id: 'user-1' });

            expect(await cache.get('user', 'user-1')).toBeDefined();
        });
    });
});

class CountingStore extends MemoryStore<string> {
    public scans = 0;

    public override async scan(
        cursor: string,
    ): Promise<{ keys: string[]; cursor: string }> {
        this.scans += 1;

        return super.scan(cursor);
    }
}
