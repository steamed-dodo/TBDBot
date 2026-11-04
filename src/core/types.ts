import type {
    APIApplication,
    APIChannel,
    APIGuild,
    APIGuildMember,
    APIMessage,
    APIRole,
    APIUser,
    GatewayGuildAuditLogEntryCreateDispatchData,
    GatewayGuildBanAddDispatchData,
    GatewayChannelCreateDispatchData,
    GatewayChannelDeleteDispatchData,
    GatewayChannelUpdateDispatchData,
    GatewayGuildBanRemoveDispatchData,
    GatewayGuildCreateDispatchData,
    GatewayGuildDeleteDispatchData,
    GatewayGuildMemberAddDispatchData,
    GatewayGuildMemberRemoveDispatchData,
    GatewayGuildMemberUpdateDispatchData,
    GatewayGuildMembersChunkDispatchData,
    GatewayGuildRoleCreateDispatchData,
    GatewayGuildRoleDeleteDispatchData,
    GatewayGuildRoleUpdateDispatchData,
    GatewayGuildUpdateDispatchData,
    GatewayMessageCreateDispatchData,
    GatewayMessageDeleteDispatchData,
    GatewayMessageUpdateDispatchData,
    GatewayPresenceUpdateDispatchData,
    GatewayReadyDispatchData,
    GatewayThreadCreateDispatchData,
    GatewayThreadDeleteDispatchData,
    GatewayThreadUpdateDispatchData,
    GatewayTypingStartDispatchData,
    GatewayUserUpdateDispatchData,
    GatewayVoiceStateUpdateDispatchData,
    GatewayWebhooksUpdateDispatchData,
} from 'discord-api-types/v10';

/**
 * Information delivered by the `ready` event.
 *
 * The application ID is required by every webhook-based REST operation
 * (`followUp`, `editReply`, `getOriginalReply`, `deleteReply`), so the
 * framework surfaces it prominently here.
 */
export interface ReadyInfo {
    /** ID of the application the bot is connected as. */
    readonly applicationId: string;

    /** Session ID reported by Discord, or `null` when unavailable. */
    readonly sessionId: string | null;

    /** Shard that emitted the ready payload. */
    readonly shardId: number;

    /** The bot user, when Discord supplied it. */
    readonly user: APIUser | null;

    /** Raw `READY` dispatch payload. */
    readonly raw: GatewayReadyDispatchData;
}

/** A guild event, carrying the guild's raw payload. */
export interface GuildEvent {
    /** ID of the affected guild. */
    readonly guildId: string;

    /** Raw dispatch payload. */
    readonly raw: unknown;
}

/** A channel event, carrying the channel's raw payload. */
export interface ChannelEvent {
    /** ID of the affected channel. */
    readonly channelId: string;

    /** ID of the guild containing the channel, or `null` for direct messages. */
    readonly guildId: string | null;

    /** Raw dispatch payload. */
    readonly raw: unknown;
}

/** A guild member event. */
export interface GuildMemberEvent {
    /** ID of the affected guild. */
    readonly guildId: string;

    /** ID of the affected user. */
    readonly userId: string;

    /** Raw dispatch payload. */
    readonly raw: unknown;
}

/** A guild role event. */
export interface GuildRoleEvent {
    /** ID of the affected guild. */
    readonly guildId: string;

    /** ID of the affected role. */
    readonly roleId: string;

    /** Raw dispatch payload. */
    readonly raw: unknown;
}

/** A message event. */
export interface MessageEvent {
    /** ID of the affected message. */
    readonly messageId: string;

    /** ID of the channel containing the message. */
    readonly channelId: string;

    /** ID of the guild containing the message, or `null` for direct messages. */
    readonly guildId: string | null;

    /** Raw dispatch payload. */
    readonly raw: unknown;
}

/** A generic event carrying only the raw dispatch payload. */
export interface RawEvent {
    /** Raw dispatch payload. */
    readonly raw: unknown;
}

/**
 * Typed event map exposed by the framework client.
 *
 * Every entry is a friendly, named event derived from a raw gateway dispatch.
 * Handlers always receive the raw payload alongside a small typed accessor
 * layer, so nothing is lost in translation.
 */
export interface FrameworkEventMap {
    /** Emitted once the gateway session is established. */
    ready: [info: ReadyInfo];

    /** Emitted when a session is resumed rather than created. */
    resumed: [info: { shardId: number }];

    /** Emitted for every incoming interaction. */
    interactionCreate: [interaction: import('../interaction/types').Interaction];

    /** Emitted when a message is created. */
    messageCreate: [event: MessageEvent];

    /** Emitted when a message is edited. */
    messageUpdate: [event: MessageEvent];

    /** Emitted when a message is deleted. */
    messageDelete: [event: MessageEvent];

    /** Emitted when messages are deleted in bulk. */
    messageDeleteBulk: [event: { channelId: string; guildId: string | null; ids: readonly string[] }];

    /** Emitted when the bot joins a guild. */
    guildCreate: [event: GuildEvent];

    /** Emitted when a guild is updated. */
    guildUpdate: [event: GuildEvent];

    /** Emitted when the bot is removed from a guild. */
    guildDelete: [event: GuildEvent];

    /** Emitted when a channel is created. */
    channelCreate: [event: ChannelEvent];

    /** Emitted when a channel is updated. */
    channelUpdate: [event: ChannelEvent];

    /** Emitted when a channel is deleted. */
    channelDelete: [event: ChannelEvent];

    /** Emitted when a member joins a guild. */
    guildMemberAdd: [event: GuildMemberEvent];

    /** Emitted when a member leaves a guild. */
    guildMemberRemove: [event: GuildMemberEvent];

    /** Emitted when a member is updated. */
    guildMemberUpdate: [event: GuildMemberEvent];

    /** Emitted when a chunk of guild members is received. */
    guildMembersChunk: [event: GuildEvent & { count: number; nonce: string | null }];

    /** Emitted when a role is created. */
    guildRoleCreate: [event: GuildRoleEvent];

    /** Emitted when a role is updated. */
    guildRoleUpdate: [event: GuildRoleEvent];

    /** Emitted when a role is deleted. */
    guildRoleDelete: [event: GuildRoleEvent];

    /** Emitted when a user is banned. */
    guildBanAdd: [event: GuildEvent & { userId: string }];

    /** Emitted when a user is unbanned. */
    guildBanRemove: [event: GuildEvent & { userId: string }];

    /** Emitted when a user account is updated. */
    userUpdate: [event: { userId: string; raw: GatewayUserUpdateDispatchData }];

    /** Emitted when a presence is updated. */
    presenceUpdate: [event: { userId: string; guildId: string | null; raw: GatewayPresenceUpdateDispatchData }];

    /** Emitted when a user starts typing. */
    typingStart: [event: { channelId: string; guildId: string | null; userId: string; raw: GatewayTypingStartDispatchData }];

    /** Emitted when a voice state changes. */
    voiceStateUpdate: [event: { guildId: string | null; userId: string; raw: GatewayVoiceStateUpdateDispatchData }];

    /** Emitted when a channel's webhook is updated. */
    webhooksUpdate: [event: { channelId: string; guildId: string | null; raw: GatewayWebhooksUpdateDispatchData }];

    /** Emitted when a thread is created. */
    threadCreate: [event: ChannelEvent];

    /** Emitted when a thread is updated. */
    threadUpdate: [event: ChannelEvent];

    /** Emitted when a thread is deleted. */
    threadDelete: [event: ChannelEvent];

    /** Emitted when an audit log entry is created. */
    guildAuditLogEntryCreate: [event: GuildEvent & { raw: GatewayGuildAuditLogEntryCreateDispatchData }];

    /** Emitted when the framework reports an error. */
    error: [error: Error];

    /** Emitted for diagnostic messages. */
    debug: [message: string];
}

/** Names of every event the framework client can emit. */
export type FrameworkEventName = keyof FrameworkEventMap;

/** Convenience alias for the raw payload of a guild event. */
export type RawGuildPayload =
    | GatewayGuildCreateDispatchData
    | GatewayGuildUpdateDispatchData
    | GatewayGuildDeleteDispatchData;

/** Convenience alias for the raw payload of a channel event. */
export type RawChannelPayload =
    | GatewayChannelCreateDispatchData
    | GatewayChannelUpdateDispatchData
    | GatewayChannelDeleteDispatchData;

/** Convenience alias for the raw payload of a message event. */
export type RawMessagePayload =
    | GatewayMessageCreateDispatchData
    | GatewayMessageUpdateDispatchData
    | GatewayMessageDeleteDispatchData;

/** Convenience alias for the raw payload of a member event. */
export type RawMemberPayload =
    | GatewayGuildMemberAddDispatchData
    | GatewayGuildMemberRemoveDispatchData
    | GatewayGuildMemberUpdateDispatchData;

/** Convenience alias for the raw payload of a role event. */
export type RawRolePayload =
    | GatewayGuildRoleCreateDispatchData
    | GatewayGuildRoleUpdateDispatchData
    | GatewayGuildRoleDeleteDispatchData;

/** Convenience alias for the raw payload of a members chunk event. */
export type RawMembersChunkPayload = GatewayGuildMembersChunkDispatchData;

/** Convenience alias for the raw payload of a ban event. */
export type RawBanPayload = GatewayGuildBanAddDispatchData | GatewayGuildBanRemoveDispatchData;

/** Convenience alias for the raw payload of a thread event. */
export type RawThreadPayload =
    | GatewayThreadCreateDispatchData
    | GatewayThreadUpdateDispatchData
    | GatewayThreadDeleteDispatchData;

/** Re-exported Discord payload aliases used across the framework. */
export type {
    APIApplication,
    APIChannel,
    APIGuild,
    APIGuildMember,
    APIMessage,
    APIRole,
    APIUser,
};
