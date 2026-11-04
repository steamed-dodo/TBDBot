import type { Client as CoreClient } from '@discordjs/core';
import { GatewayDispatchEvents } from 'discord-api-types/v10';
import type { APIInteraction } from 'discord-api-types/v10';

import { createInteraction } from '../interaction/interaction';
import type { TypedEventEmitter } from './TypedEventEmitter';

/**
 * Translates raw gateway dispatch events into friendly, typed events.
 *
 * The router is the only place that knows about `GatewayDispatchEvents`.
 * Everything else in the framework works with the named events described by
 * {@link FrameworkEventMap}.
 */
export class EventRouter {
    /**
     * @param core - The underlying `@discordjs/core` client.
     * @param emitter - Emitter that receives the friendly events.
     */
    constructor(
        private readonly core: CoreClient,
        private readonly emitter: TypedEventEmitter,
    ) {
        this.attach();
    }

    private attach(): void {
        const core = this.core;

        core.on(GatewayDispatchEvents.Ready, ({ data, shardId }) => {
            this.emitter.emit('ready', {
                applicationId: data.application.id,
                sessionId: data.session_id ?? null,
                shardId,
                user: data.user ?? null,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.Resumed, ({ shardId }) => {
            this.emitter.emit('resumed', { shardId });
        });

        core.on(GatewayDispatchEvents.InteractionCreate, ({ data }) => {
            this.emitter.emit(
                'interactionCreate',
                createInteraction(data as APIInteraction, this.core.api.interactions),
            );
        });

        core.on(GatewayDispatchEvents.MessageCreate, ({ data }) => {
            this.emitter.emit('messageCreate', {
                messageId: data.id,
                channelId: data.channel_id,
                guildId: data.guild_id ?? null,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.MessageUpdate, ({ data }) => {
            this.emitter.emit('messageUpdate', {
                messageId: data.id,
                channelId: data.channel_id,
                guildId: data.guild_id ?? null,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.MessageDelete, ({ data }) => {
            this.emitter.emit('messageDelete', {
                messageId: data.id,
                channelId: data.channel_id,
                guildId: data.guild_id ?? null,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.MessageDeleteBulk, ({ data }) => {
            this.emitter.emit('messageDeleteBulk', {
                channelId: data.channel_id,
                guildId: data.guild_id ?? null,
                ids: [...data.ids],
            });
        });

        core.on(GatewayDispatchEvents.GuildCreate, ({ data }) => {
            this.emitter.emit('guildCreate', { guildId: data.id, raw: data });
        });

        core.on(GatewayDispatchEvents.GuildUpdate, ({ data }) => {
            this.emitter.emit('guildUpdate', { guildId: data.id, raw: data });
        });

        core.on(GatewayDispatchEvents.GuildDelete, ({ data }) => {
            this.emitter.emit('guildDelete', { guildId: data.id, raw: data });
        });

        core.on(GatewayDispatchEvents.ChannelCreate, ({ data }) => {
            this.emitter.emit('channelCreate', {
                channelId: data.id,
                guildId: data.guild_id ?? null,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.ChannelUpdate, ({ data }) => {
            this.emitter.emit('channelUpdate', {
                channelId: data.id,
                guildId: data.guild_id ?? null,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.ChannelDelete, ({ data }) => {
            this.emitter.emit('channelDelete', {
                channelId: data.id,
                guildId: data.guild_id ?? null,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.GuildMemberAdd, ({ data }) => {
            this.emitter.emit('guildMemberAdd', {
                guildId: data.guild_id,
                userId: data.user.id,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.GuildMemberRemove, ({ data }) => {
            this.emitter.emit('guildMemberRemove', {
                guildId: data.guild_id,
                userId: data.user.id,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.GuildMemberUpdate, ({ data }) => {
            this.emitter.emit('guildMemberUpdate', {
                guildId: data.guild_id,
                userId: data.user.id,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.GuildMembersChunk, ({ data }) => {
            this.emitter.emit('guildMembersChunk', {
                guildId: data.guild_id,
                count: data.members.length,
                nonce: data.nonce ?? null,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.GuildRoleCreate, ({ data }) => {
            this.emitter.emit('guildRoleCreate', {
                guildId: data.guild_id,
                roleId: data.role.id,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.GuildRoleUpdate, ({ data }) => {
            this.emitter.emit('guildRoleUpdate', {
                guildId: data.guild_id,
                roleId: data.role.id,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.GuildRoleDelete, ({ data }) => {
            this.emitter.emit('guildRoleDelete', {
                guildId: data.guild_id,
                roleId: data.role_id,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.GuildBanAdd, ({ data }) => {
            this.emitter.emit('guildBanAdd', {
                guildId: data.guild_id,
                userId: data.user.id,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.GuildBanRemove, ({ data }) => {
            this.emitter.emit('guildBanRemove', {
                guildId: data.guild_id,
                userId: data.user.id,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.UserUpdate, ({ data }) => {
            this.emitter.emit('userUpdate', { userId: data.id, raw: data });
        });

        core.on(GatewayDispatchEvents.PresenceUpdate, ({ data }) => {
            this.emitter.emit('presenceUpdate', {
                userId: data.user.id,
                guildId: data.guild_id ?? null,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.TypingStart, ({ data }) => {
            this.emitter.emit('typingStart', {
                channelId: data.channel_id,
                guildId: data.guild_id ?? null,
                userId: data.user_id,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.VoiceStateUpdate, ({ data }) => {
            this.emitter.emit('voiceStateUpdate', {
                guildId: data.guild_id ?? null,
                userId: data.user_id,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.WebhooksUpdate, ({ data }) => {
            this.emitter.emit('webhooksUpdate', {
                channelId: data.channel_id,
                guildId: data.guild_id ?? null,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.ThreadCreate, ({ data }) => {
            this.emitter.emit('threadCreate', {
                channelId: data.id,
                guildId: data.guild_id ?? null,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.ThreadUpdate, ({ data }) => {
            this.emitter.emit('threadUpdate', {
                channelId: data.id,
                guildId: data.guild_id ?? null,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.ThreadDelete, ({ data }) => {
            this.emitter.emit('threadDelete', {
                channelId: data.id,
                guildId: data.guild_id ?? null,
                raw: data,
            });
        });

        core.on(GatewayDispatchEvents.GuildAuditLogEntryCreate, ({ data }) => {
            this.emitter.emit('guildAuditLogEntryCreate', {
                guildId: data.guild_id,
                raw: data,
            });
        });
    }
}
