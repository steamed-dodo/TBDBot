import type { SlashCommandBuilder } from '@discordjs/builders';
import type {
    RESTPostAPIApplicationCommandsJSONBody,
} from 'discord-api-types/v10';

import type { Interaction } from '../interaction/types';
import type { PermissionResolvable } from '../permissions/bitfield';
import type { CommandOptionResolver } from './options';
import type { CommandSchema } from './schema';

export type { CommandSchema, OptionSchema } from './schema';

/**
 * A plain record of validated command arguments.
 *
 * The record is trivially serializable, easy to log, and simple to test.
 */
export type CommandArgs = Record<string, unknown>;

/**
 * Context handed to command handlers and middleware.
 */
export interface CommandContext<TArgs extends CommandArgs = CommandArgs> {
    /** The interaction that invoked the command. */
    readonly interaction: Interaction;

    /** The command being executed. */
    readonly command: CommandDefinition<TArgs>;

    /** The validated arguments of the command. */
    readonly args: TArgs;

    /** The typed option resolver, available as an escape hatch. */
    readonly options: CommandOptionResolver;
}

/**
 * A middleware function wrapping command execution.
 */
export type Middleware = (
    context: CommandContext,
    next: () => Promise<void>,
) => Promise<void>;

/**
 * The handler executed for a command.
 */
export type CommandHandler<TArgs extends CommandArgs = CommandArgs> = (
    context: CommandContext<TArgs>,
) => void | Promise<void>;

/**
 * The definition of a single application command.
 *
 * The builder stays the source of truth: the framework derives the option
 * schema from it at registration time and validates the incoming options
 * against that schema at invocation time.
 */
export interface CommandDefinition<TArgs extends CommandArgs = CommandArgs> {
    /** Name of the command. */
    readonly name: string;

    /** Description of the command. */
    readonly description: string;

    /**
     * The command builder.
     *
     * Exactly one of `builder` and `command` must be supplied.
     */
    readonly builder?: SlashCommandBuilder;

    /**
     * Raw command JSON, used when no builder is available.
     *
     * Exactly one of `builder` and `command` must be supplied.
     */
    readonly command?: RESTPostAPIApplicationCommandsJSONBody;

    /** The handler executed for the command. */
    readonly execute: CommandHandler<TArgs>;

    /** Middleware run before the handler. */
    readonly middlewares?: readonly Middleware[];

    /**
     * Permissions required to run the command.
     *
     * All of the listed permissions are required.
     */
    readonly permissions?: PermissionResolvable | readonly PermissionResolvable[];

    /** Whether the command may only be used inside a guild. */
    readonly guildOnly?: boolean;

    /** Whether the command may only be used by the bot's owners. */
    readonly ownerOnly?: boolean;

    /**
     * How long the command is unavailable after it has been used, in
     * milliseconds.
     */
    readonly cooldown?: number;

    /**
     * Builds the key used to store the cooldown.
     *
     * @defaultValue The user ID, so cooldowns are per user.
     */
    readonly cooldownKey?: (context: CommandContext) => string;

    /** Whether the command is age restricted. */
    readonly nsfw?: boolean;

    /**
     * The derived option schema.
     *
     * Filled in by the command manager at registration time.
     */
    readonly schema?: CommandSchema;
}
