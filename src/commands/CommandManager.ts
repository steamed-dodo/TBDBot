import type { API } from '@discordjs/core';
import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord-api-types/v10';

import type { Interaction } from '../interaction/types';
import { resolveArgs } from './args';
import {
    cooldownMiddleware,
    guildOnlyMiddleware,
    ownerOnlyMiddleware,
    permissionMiddleware,
} from './middleware';
import { CommandOptionResolver } from './options';
import {
    deriveSchemaFromBuilder,
    deriveSchemaFromCommand,
    validateSchema,
} from './schema';
import type { CommandDefinition, Middleware } from './types';

/** Configuration options used to construct a {@link CommandManager}. */
export interface CommandManagerOptions {
    /** The REST facade used to register commands. */
    readonly api: API;

    /** IDs of the bot's owners. */
    readonly ownerIds?: readonly string[];
}

/**
 * Owns the application commands of a bot.
 *
 * The manager derives each command's option schema at registration time,
 * validates it, and validates the incoming options against it at invocation
 * time. Middleware wraps the handler, which is what replaces the
 * hand-rolled per-command `if` ladders.
 */
export class CommandManager {
    /** The REST facade used to register commands. */
    public readonly api: API;

    /** IDs of the bot's owners. */
    public readonly ownerIds: readonly string[];

    private readonly commands = new Map<string, CommandDefinition>();

    private readonly schemas = new Map<
        string,
        ReturnType<typeof deriveSchemaFromBuilder>
    >();

    private readonly pipelines = new Map<string, Middleware[]>();

    /**
     * @param options - Manager configuration.
     */
    constructor(options: CommandManagerOptions) {
        this.api = options.api;
        this.ownerIds = options.ownerIds ?? [];
    }

    /**
     * Registers a command.
     *
     * @param command - The command to register.
     * @returns This manager, allowing calls to be chained.
     * @throws {TypeError} When the command is malformed.
     */
    public add(command: CommandDefinition): this {
        if (!command.name || !command.name.trim()) {
            throw new TypeError('A command must have a name.');
        }

        if (!command.builder && !command.command) {
            throw new TypeError(
                `Command "${command.name}" must define a builder or raw command JSON.`,
            );
        }

        if (this.commands.has(command.name)) {
            throw new Error(`Duplicate command: "${command.name}".`);
        }

        const schema = command.builder
            ? deriveSchemaFromBuilder(command.builder)
            : deriveSchemaFromCommand(
                  command.command as {
                      name: string;
                      description: string;
                      options?: never;
                  },
              );

        validateSchema(schema);

        this.schemas.set(command.name, schema);
        this.pipelines.set(command.name, this.buildPipeline(command));
        this.commands.set(command.name, {
            ...command,
            schema,
        });

        return this;
    }

    private buildPipeline(command: CommandDefinition): Middleware[] {
        const middlewares: Middleware[] = [];

        if (command.guildOnly) {
            middlewares.push(guildOnlyMiddleware());
        }

        if (command.ownerOnly) {
            middlewares.push(ownerOnlyMiddleware(this.ownerIds));
        }

        if (command.permissions !== undefined) {
            middlewares.push(permissionMiddleware(command.permissions));
        }

        if (command.cooldown !== undefined) {
            middlewares.push(cooldownMiddleware(command.cooldown));
        }

        middlewares.push(...(command.middlewares ?? []));

        return middlewares;
    }

    /**
     * Looks up a registered command.
     *
     * @param name - Name of the command.
     * @returns The command, or `undefined` when it is not registered.
     */
    public get(name: string): CommandDefinition | undefined {
        return this.commands.get(name);
    }

    /** Every registered command. */
    public get all(): readonly CommandDefinition[] {
        return [...this.commands.values()];
    }

    /**
     * Builds the command payloads sent to Discord.
     *
     * @returns The command JSON.
     */
    public toJSON(): RESTPostAPIApplicationCommandsJSONBody[] {
        return this.all.map((command) => {
            if (command.builder) {
                return command.builder.toJSON() as RESTPostAPIApplicationCommandsJSONBody;
            }

            return command.command as RESTPostAPIApplicationCommandsJSONBody;
        });
    }

    /**
     * Registers every command globally.
     *
     * @param applicationId - ID of the application.
     */
    public async registerGlobal(applicationId: string): Promise<void> {
        await this.api.applicationCommands.bulkOverwriteGlobalCommands(
            applicationId,
            this.toJSON() as never,
        );
    }

    /**
     * Registers every command for a single guild.
     *
     * Guild-scoped registration propagates faster, which makes it the right
     * choice during development.
     *
     * @param applicationId - ID of the application.
     * @param guildId - ID of the guild.
     */
    public async registerGuild(
        applicationId: string,
        guildId: string,
    ): Promise<void> {
        await this.api.applicationCommands.bulkOverwriteGuildCommands(
            applicationId,
            guildId,
            this.toJSON() as never,
        );
    }

    /**
     * Registers the commands for the environment the bot runs in.
     *
     * Guild-scoped registration propagates faster, which makes it the right
     * choice during development; production bots usually register globally.
     *
     * @param options - The application and the guilds to register for.
     */
    public async register(options: {
        readonly applicationId: string;
        readonly guildIds?: readonly string[];
    }): Promise<void> {
        if (options.guildIds && options.guildIds.length > 0) {
            for (const guildId of options.guildIds) {
                await this.registerGuild(options.applicationId, guildId);
            }

            return;
        }

        await this.registerGlobal(options.applicationId);
    }

    /**
     * Handles an autocomplete interaction.
     *
     * The schema records which options support autocomplete, so the focused
     * option can be validated before the handler runs.
     *
     * @param interaction - The autocomplete interaction.
     * @param handler - Called with the focused option's name and value.
     * @returns `true` when the interaction was handled.
     */
    public async handleAutocomplete(
        interaction: Interaction,
        handler: (focused: { name: string; value: string }) => Promise<void>,
    ): Promise<boolean> {
        if (!interaction.isAutocomplete()) {
            return false;
        }

        const name = interaction.commandName;
        const focused = interaction.focusedOption;

        if (!name || !focused) {
            return false;
        }

        const schema = this.schemas.get(name);

        if (!schema) {
            return false;
        }

        const option = schema.options.find(
            (candidate) => candidate.name === focused.name,
        );

        if (!option?.autocomplete) {
            await interaction.createAutocompleteResponse({ choices: [] });

            return true;
        }

        await handler({ name: focused.name, value: focused.value });

        return true;
    }

    /**
     * Handles an incoming interaction.
     *
     * @param interaction - The interaction to handle.
     * @returns `true` when the interaction invoked a known command.
     */
    public async handle(interaction: Interaction): Promise<boolean> {
        if (!interaction.isCommand()) {
            return false;
        }

        const name = interaction.commandName;

        if (!name) {
            return false;
        }

        const command = this.commands.get(name);

        if (!command) {
            return false;
        }

        const schema = this.schemas.get(name);

        if (!schema) {
            return false;
        }

        const resolver = new CommandOptionResolver(interaction);

        let args: Record<string, unknown>;

        try {
            args = resolveArgs(schema, resolver);
        } catch (error) {
            await replyError(interaction, error);

            return true;
        }

        const context = {
            interaction,
            command,
            args,
            options: resolver,
        } as unknown as Parameters<Middleware>[0];

        try {
            await this.runMiddleware(context, command);
        } catch (error) {
            await replyError(interaction, error);
        }

        return true;
    }

    private async runMiddleware(
        context: Parameters<Middleware>[0],
        command: CommandDefinition,
    ): Promise<void> {
        const middlewares = this.pipelines.get(command.name) ?? [];

        const dispatch = async (index: number): Promise<void> => {
            const middleware = middlewares[index];

            if (!middleware) {
                await command.execute(context);

                return;
            }

            await middleware(context, () => dispatch(index + 1));
        };

        await dispatch(0);
    }
}

async function replyError(
    interaction: Interaction,
    error: unknown,
): Promise<void> {
    const message =
        error instanceof Error ? error.message : 'Something went wrong.';

    try {
        await interaction.reply({
            content: message,
            flags: 64,
        });
    } catch {
        // The interaction may already have been answered.
    }
}
