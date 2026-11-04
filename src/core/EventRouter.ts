import type { API } from '@discordjs/core';
import { GatewayDispatchEvents } from 'discord-api-types/v10';

import { createInteraction } from '../interaction/interaction';
import type { FrameworkGateway } from './Client';
import type { TypedEventEmitter } from './TypedEventEmitter';

/**
 * The dispatch events the framework types.
 *
 * This is a closed list, not "whatever comes up": the cache invalidation
 * story depends on four specific events being present, so they belong here
 * by definition rather than by accident.
 */
export const TIER_ONE_EVENTS = [
    GatewayDispatchEvents.InteractionCreate,
    GatewayDispatchEvents.Ready,
    GatewayDispatchEvents.Resumed,
    GatewayDispatchEvents.GuildCreate,
    GatewayDispatchEvents.GuildUpdate,
    GatewayDispatchEvents.GuildDelete,
    GatewayDispatchEvents.GuildRoleCreate,
    GatewayDispatchEvents.GuildRoleUpdate,
    GatewayDispatchEvents.GuildRoleDelete,
    GatewayDispatchEvents.GuildMemberAdd,
    GatewayDispatchEvents.GuildMemberRemove,
    GatewayDispatchEvents.GuildMemberUpdate,
    GatewayDispatchEvents.GuildMembersChunk,
    GatewayDispatchEvents.GuildBanAdd,
    GatewayDispatchEvents.GuildBanRemove,
    GatewayDispatchEvents.ChannelCreate,
    GatewayDispatchEvents.ChannelUpdate,
    GatewayDispatchEvents.ChannelDelete,
    GatewayDispatchEvents.MessageCreate,
    GatewayDispatchEvents.MessageUpdate,
    GatewayDispatchEvents.MessageDelete,
    GatewayDispatchEvents.MessageDeleteBulk,
    GatewayDispatchEvents.UserUpdate,
    GatewayDispatchEvents.PresenceUpdate,
    GatewayDispatchEvents.TypingStart,
    GatewayDispatchEvents.VoiceStateUpdate,
    GatewayDispatchEvents.WebhooksUpdate,
    GatewayDispatchEvents.ThreadCreate,
    GatewayDispatchEvents.ThreadUpdate,
    GatewayDispatchEvents.ThreadDelete,
    GatewayDispatchEvents.GuildAuditLogEntryCreate,
] as const;

/**
 * The dispatch events the cache invalidation depends on.
 *
 * If the router does not emit one of these, the corresponding cache does not
 * invalidate, so they are a requirement on the router rather than a
 * description of what it happens to do.
 */
export const CACHE_INVALIDATION_EVENTS = [
    GatewayDispatchEvents.GuildRoleCreate,
    GatewayDispatchEvents.GuildRoleUpdate,
    GatewayDispatchEvents.GuildRoleDelete,
    GatewayDispatchEvents.GuildUpdate,
    GatewayDispatchEvents.GuildDelete,
    GatewayDispatchEvents.ChannelUpdate,
    GatewayDispatchEvents.ChannelDelete,
    GatewayDispatchEvents.GuildMemberUpdate,
    GatewayDispatchEvents.GuildMemberRemove,
    GatewayDispatchEvents.GuildMembersChunk,
] as const;

type DispatchHandler = (data: unknown, shardId: number) => void;

/**
 * Translates raw gateway dispatch events into friendly, typed events.
 *
 * The router has two tiers:
 *
 * - **Tier 1** — the events the framework itself needs, typed and named.
 * - **Tier 2** — everything else, re-emitted under its raw dispatch name
 *   with the raw payload. A user who wants `GUILD_BAN_ADD` gets it, without
 *   the framework having typed it.
 */
export class EventRouter {
    private readonly handlers = new Map<string, DispatchHandler>();

    private readonly api: API;

    /**
     * @param gateway - The gateway the dispatches arrive on.
     * @param api - The REST facade used to build interaction views.
     * @param emitter - Emitter that receives the friendly events.
     */
    constructor(
        gateway: FrameworkGateway,
        api: API,
        private readonly emitter: TypedEventEmitter,
    ) {
        this.api = api;
        this.buildHandlers();
        this.attach(gateway);
    }

    private attach(gateway: FrameworkGateway): void {
        const listener = (
            payload: { t: string; d: unknown },
            shardId: number,
        ): void => {
            this.handle(payload.t, payload.d, shardId);
        };

        gateway.on('dispatch' as never, listener as never);
    }

    private handle(t: string, data: unknown, shardId: number): void {
        const handler = this.handlers.get(t);

        if (handler) {
            handler(data, shardId);

            return;
        }

        this.emitter.emitRaw(t, data);
    }

    private on(t: string, handler: DispatchHandler): void {
        this.handlers.set(t, handler);
    }

    private buildHandlers(): void {
        this.on(GatewayDispatchEvents.Ready, (data, shardId) => {
            const payload = data as {
                application: { id: string };
                session_id?: string;
                user?: unknown;
            };

            this.emitter.emit('ready', {
                applicationId: payload.application.id,
                sessionId: payload.session_id ?? null,
                shardId,
                user: (payload.user ?? null) as never,
                raw: data as never,
            });
        });

        this.on(GatewayDispatchEvents.Resumed, (_data, shardId) => {
            this.emitter.emit('resumed', { shardId });
        });

        this.on(GatewayDispatchEvents.InteractionCreate, (data) => {
            this.emitter.emit(
                'interactionCreate',
                createInteraction(data as never, this.interactions),
            );
        });

        this.on(GatewayDispatchEvents.MessageCreate, (data) => {
            const payload = data as {
                id: string;
                channel_id: string;
                guild_id?: string;
            };

            this.emitter.emit('messageCreate', {
                messageId: payload.id,
                channelId: payload.channel_id,
                guildId: payload.guild_id ?? null,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.MessageUpdate, (data) => {
            const payload = data as {
                id: string;
                channel_id: string;
                guild_id?: string;
            };

            this.emitter.emit('messageUpdate', {
                messageId: payload.id,
                channelId: payload.channel_id,
                guildId: payload.guild_id ?? null,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.MessageDelete, (data) => {
            const payload = data as {
                id: string;
                channel_id: string;
                guild_id?: string;
            };

            this.emitter.emit('messageDelete', {
                messageId: payload.id,
                channelId: payload.channel_id,
                guildId: payload.guild_id ?? null,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.MessageDeleteBulk, (data) => {
            const payload = data as {
                ids: string[];
                channel_id: string;
                guild_id?: string;
            };

            this.emitter.emit('messageDeleteBulk', {
                channelId: payload.channel_id,
                guildId: payload.guild_id ?? null,
                ids: [...payload.ids],
            });
        });

        this.on(GatewayDispatchEvents.GuildCreate, (data) => {
            this.emitter.emit('guildCreate', {
                guildId: (data as { id: string }).id,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.GuildUpdate, (data) => {
            this.emitter.emit('guildUpdate', {
                guildId: (data as { id: string }).id,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.GuildDelete, (data) => {
            this.emitter.emit('guildDelete', {
                guildId: (data as { id: string }).id,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.ChannelCreate, (data) => {
            const payload = data as { id: string; guild_id?: string };

            this.emitter.emit('channelCreate', {
                channelId: payload.id,
                guildId: payload.guild_id ?? null,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.ChannelUpdate, (data) => {
            const payload = data as { id: string; guild_id?: string };

            this.emitter.emit('channelUpdate', {
                channelId: payload.id,
                guildId: payload.guild_id ?? null,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.ChannelDelete, (data) => {
            const payload = data as { id: string; guild_id?: string };

            this.emitter.emit('channelDelete', {
                channelId: payload.id,
                guildId: payload.guild_id ?? null,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.GuildMemberAdd, (data) => {
            const payload = data as { guild_id: string; user: { id: string } };

            this.emitter.emit('guildMemberAdd', {
                guildId: payload.guild_id,
                userId: payload.user.id,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.GuildMemberRemove, (data) => {
            const payload = data as { guild_id: string; user: { id: string } };

            this.emitter.emit('guildMemberRemove', {
                guildId: payload.guild_id,
                userId: payload.user.id,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.GuildMemberUpdate, (data) => {
            const payload = data as { guild_id: string; user: { id: string } };

            this.emitter.emit('guildMemberUpdate', {
                guildId: payload.guild_id,
                userId: payload.user.id,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.GuildMembersChunk, (data) => {
            const payload = data as {
                guild_id: string;
                members: unknown[];
                nonce?: string;
            };

            this.emitter.emit('guildMembersChunk', {
                guildId: payload.guild_id,
                count: payload.members.length,
                nonce: payload.nonce ?? null,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.GuildRoleCreate, (data) => {
            const payload = data as { guild_id: string; role: { id: string } };

            this.emitter.emit('guildRoleCreate', {
                guildId: payload.guild_id,
                roleId: payload.role.id,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.GuildRoleUpdate, (data) => {
            const payload = data as { guild_id: string; role: { id: string } };

            this.emitter.emit('guildRoleUpdate', {
                guildId: payload.guild_id,
                roleId: payload.role.id,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.GuildRoleDelete, (data) => {
            const payload = data as { guild_id: string; role_id: string };

            this.emitter.emit('guildRoleDelete', {
                guildId: payload.guild_id,
                roleId: payload.role_id,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.GuildBanAdd, (data) => {
            const payload = data as { guild_id: string; user: { id: string } };

            this.emitter.emit('guildBanAdd', {
                guildId: payload.guild_id,
                userId: payload.user.id,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.GuildBanRemove, (data) => {
            const payload = data as { guild_id: string; user: { id: string } };

            this.emitter.emit('guildBanRemove', {
                guildId: payload.guild_id,
                userId: payload.user.id,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.UserUpdate, (data) => {
            this.emitter.emit('userUpdate', {
                userId: (data as { id: string }).id,
                raw: data as never,
            });
        });

        this.on(GatewayDispatchEvents.PresenceUpdate, (data) => {
            const payload = data as { user: { id: string }; guild_id?: string };

            this.emitter.emit('presenceUpdate', {
                userId: payload.user.id,
                guildId: payload.guild_id ?? null,
                raw: data as never,
            });
        });

        this.on(GatewayDispatchEvents.TypingStart, (data) => {
            const payload = data as {
                channel_id: string;
                guild_id?: string;
                user_id: string;
            };

            this.emitter.emit('typingStart', {
                channelId: payload.channel_id,
                guildId: payload.guild_id ?? null,
                userId: payload.user_id,
                raw: data as never,
            });
        });

        this.on(GatewayDispatchEvents.VoiceStateUpdate, (data) => {
            const payload = data as { guild_id?: string; user_id: string };

            this.emitter.emit('voiceStateUpdate', {
                guildId: payload.guild_id ?? null,
                userId: payload.user_id,
                raw: data as never,
            });
        });

        this.on(GatewayDispatchEvents.WebhooksUpdate, (data) => {
            const payload = data as { channel_id: string; guild_id?: string };

            this.emitter.emit('webhooksUpdate', {
                channelId: payload.channel_id,
                guildId: payload.guild_id ?? null,
                raw: data as never,
            });
        });

        this.on(GatewayDispatchEvents.ThreadCreate, (data) => {
            const payload = data as { id: string; guild_id?: string };

            this.emitter.emit('threadCreate', {
                channelId: payload.id,
                guildId: payload.guild_id ?? null,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.ThreadUpdate, (data) => {
            const payload = data as { id: string; guild_id?: string };

            this.emitter.emit('threadUpdate', {
                channelId: payload.id,
                guildId: payload.guild_id ?? null,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.ThreadDelete, (data) => {
            const payload = data as { id: string; guild_id?: string };

            this.emitter.emit('threadDelete', {
                channelId: payload.id,
                guildId: payload.guild_id ?? null,
                raw: data,
            });
        });

        this.on(GatewayDispatchEvents.GuildAuditLogEntryCreate, (data) => {
            this.emitter.emit('guildAuditLogEntryCreate', {
                guildId: (data as { guild_id: string }).guild_id,
                raw: data as never,
            });
        });
    }

    private get interactions(): API['interactions'] {
        return this.api.interactions;
    }
}
