import type { API } from '@discordjs/core';
import type {
    APIApplicationCommand,
    APIChannel,
    APIGuild,
    APIGuildMember,
    APIMessage,
    APIRole,
    APIUser,
    RESTPostAPIApplicationCommandsJSONBody,
    RESTPutAPIApplicationCommandsJSONBody,
    RESTPutAPIApplicationGuildCommandsJSONBody,
} from 'discord-api-types/v10';

/** Options accepted by {@link ApiHelpers.sendMessage}. */
export interface SendMessageOptions {
    /** Plain-text content of the message. */
    readonly content?: string;

    /** Embeds attached to the message. */
    readonly embeds?: readonly Record<string, unknown>[];

    /** Component rows attached to the message. */
    readonly components?: readonly Record<string, unknown>[];

    /** Controls which mentions are allowed to ping. */
    readonly allowed_mentions?: Record<string, unknown>;
}

/**
 * Thin, typed helpers over `@discordjs/core`'s REST facade.
 *
 * The facade is deliberately thin: it exists so that the rest of the framework
 * does not have to remember the exact argument order of the REST API, and so
 * that a transport can be injected in tests without touching call sites.
 */
export class ApiHelpers {
    /**
     * @param api - The REST facade exposed by `@discordjs/core`.
     */
    constructor(public readonly api: API) {}

    /** Sends a message to a channel. */
    async sendMessage(channelId: string, options: SendMessageOptions): Promise<APIMessage> {
        return this.api.channels.createMessage(channelId, {
            ...(options.content === undefined ? {} : { content: options.content }),
            ...(options.embeds === undefined
                ? {}
                : { embeds: options.embeds as never[] }),
            ...(options.components === undefined
                ? {}
                : { components: options.components as never[] }),
            ...(options.allowed_mentions === undefined
                ? {}
                : { allowed_mentions: options.allowed_mentions as never }),
        });
    }

    /** Edits a message in a channel. */
    async editMessage(
        channelId: string,
        messageId: string,
        options: SendMessageOptions,
    ): Promise<APIMessage> {
        return this.api.channels.editMessage(channelId, messageId, {
            ...(options.content === undefined ? {} : { content: options.content }),
            ...(options.embeds === undefined
                ? {}
                : { embeds: options.embeds as never[] }),
            ...(options.components === undefined
                ? {}
                : { components: options.components as never[] }),
            ...(options.allowed_mentions === undefined
                ? {}
                : { allowed_mentions: options.allowed_mentions as never }),
        });
    }

    /** Deletes a message from a channel. */
    async deleteMessage(channelId: string, messageId: string): Promise<void> {
        await this.api.channels.deleteMessage(channelId, messageId);
    }

    /** Fetches a channel. */
    async getChannel(channelId: string): Promise<APIChannel> {
        return this.api.channels.get(channelId);
    }

    /** Fetches a guild. */
    async getGuild(guildId: string): Promise<APIGuild> {
        return this.api.guilds.get(guildId);
    }

    /** Fetches the roles of a guild. */
    async getGuildRoles(guildId: string): Promise<APIRole[]> {
        return this.api.guilds.getRoles(guildId);
    }

    /** Fetches a single guild member. */
    async getGuildMember(guildId: string, userId: string): Promise<APIGuildMember> {
        return this.api.guilds.getMember(guildId, userId);
    }

    /** Fetches a user. */
    async getUser(userId: string): Promise<APIUser> {
        return this.api.users.get(userId);
    }

    /** Registers global application commands. */
    async setGlobalCommands(
        applicationId: string,
        commands: readonly RESTPostAPIApplicationCommandsJSONBody[],
    ): Promise<APIApplicationCommand[]> {
        return this.api.applicationCommands.bulkOverwriteGlobalCommands(
            applicationId,
            commands as RESTPutAPIApplicationCommandsJSONBody,
        );
    }

    /** Registers application commands for a single guild. */
    async setGuildCommands(
        applicationId: string,
        guildId: string,
        commands: readonly RESTPostAPIApplicationCommandsJSONBody[],
    ): Promise<APIApplicationCommand[]> {
        return this.api.applicationCommands.bulkOverwriteGuildCommands(
            applicationId,
            guildId,
            commands as RESTPutAPIApplicationGuildCommandsJSONBody,
        );
    }

    /** Fetches the global application commands. */
    async getGlobalCommands(applicationId: string): Promise<APIApplicationCommand[]> {
        return this.api.applicationCommands.getGlobalCommands(applicationId);
    }
}
