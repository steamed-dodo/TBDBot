import type { Client } from '../core/Client';
import type { FrameworkEventMap } from '../core/types';
import type { Cache } from './Cache';

/**
 * Connects the cache to the framework's typed events.
 *
 * Effective permissions depend on guild roles, member roles, and channel
 * overwrites, and each of those has a corresponding gateway event. Cache
 * invalidation is therefore not a special mechanism — it is a few lines of
 * event handlers.
 *
 * @param client - The client whose events drive the invalidation.
 * @param cache - The cache to invalidate.
 * @returns A function that removes the listeners.
 */
export function attachCacheInvalidation(
    client: Client,
    cache: Cache,
): () => void {
    const listeners: {
        [K in keyof FrameworkEventMap]: (
            listener: (...args: FrameworkEventMap[K]) => void,
        ) => void;
    }[] = [];

    const on = <K extends keyof FrameworkEventMap>(
        event: K,
        listener: (...args: FrameworkEventMap[K]) => void,
    ): void => {
        client.on(event, listener);
        listeners.push({ event, listener } as never);
    };

    on('guildRoleCreate', (event) => {
        void cache.invalidateGuild(event.guildId);
    });

    on('guildRoleUpdate', (event) => {
        void cache.invalidateGuild(event.guildId);
    });

    on('guildRoleDelete', (event) => {
        void cache.invalidateGuild(event.guildId);
    });

    on('guildUpdate', (event) => {
        void cache.invalidateGuild(event.guildId);
    });

    on('guildDelete', (event) => {
        void cache.invalidateGuild(event.guildId);
    });

    on('channelUpdate', (event) => {
        void cache.delete('channel', event.channelId);
    });

    on('channelDelete', (event) => {
        void cache.delete('channel', event.channelId);
    });

    on('guildMemberUpdate', (event) => {
        void cache.delete('guildMember', `${event.guildId}:${event.userId}`);
    });

    on('guildMemberRemove', (event) => {
        void cache.delete('guildMember', `${event.guildId}:${event.userId}`);
    });

    on('guildMembersChunk', (event) => {
        void cache.invalidateGuild(event.guildId);
    });

    return () => {
        for (const entry of listeners) {
            const typed = entry as unknown as {
                event: keyof FrameworkEventMap;
                listener: (...args: never[]) => void;
            };

            client.off(typed.event, typed.listener as never);
        }
    };
}
