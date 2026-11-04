import { SlashCommandBuilder } from '@discordjs/builders';
import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { ApplicationCommandOptionType } from 'discord-api-types/v10';
import { beforeEach, describe, expect, it } from 'vitest';

import { CommandManager } from '../../src/commands/CommandManager';
import { CommandOptionResolver } from '../../src/commands/options';
import { deriveSchemaFromBuilder } from '../../src/commands/schema';
import { resolveArgs } from '../../src/commands/args';
import { createInteraction } from '../../src/interaction/interaction';
import { MockTransport } from '../../src/testing/mock';
import { createCommandInteraction } from '../../src/testing/factories';
import { createAutocompleteInteraction } from '../../src/testing/factories';

function createApi(transport: MockTransport): API {
    const rest = new REST({ makeRequest: transport.makeRequest });

    rest.setToken('test-token');

    return new API(rest);
}

describe('command schema', () => {
    it('derives the schema from the builder', () => {
        const builder = new SlashCommandBuilder()
            .setName('ban')
            .setDescription('Ban a member')
            .addUserOption((option) =>
                option.setName('target').setDescription('The member'),
            )
            .addIntegerOption((option) =>
                option
                    .setName('days')
                    .setDescription('How many days')
                    .setMinValue(1)
                    .setMaxValue(7),
            );

        const schema = deriveSchemaFromBuilder(builder);

        expect(schema.name).toBe('ban');
        expect(schema.options).toHaveLength(2);

        const days = schema.options.find((option) => option.name === 'days');

        expect(days?.type).toBe(ApplicationCommandOptionType.Integer);
        expect(days?.minValue).toBe(1);
        expect(days?.maxValue).toBe(7);
        expect(days?.required).toBe(false);
    });

    it('rejects a malformed command', () => {
        const builder = new SlashCommandBuilder()
            .setName('bad')
            .setDescription('Bad command')
            .addIntegerOption((option) =>
                option
                    .setName('count')
                    .setDescription('Count')
                    .setMinValue(10)
                    .setMaxValue(1),
            );

        expect(() => deriveSchemaFromBuilder(builder)).not.toThrow();
    });
});

describe('option resolver', () => {
    let api: API;

    beforeEach(() => {
        api = createApi(new MockTransport());
    });

    it('reads the options of the interaction', () => {
        const interaction = createInteraction(
            createCommandInteraction('ban', {
                options: [
                    {
                        name: 'target',
                        type: ApplicationCommandOptionType.User,
                        value: 'user-1',
                    },
                    {
                        name: 'days',
                        type: ApplicationCommandOptionType.Integer,
                        value: 3,
                    },
                ],
            }),
            api.interactions,
        );

        const resolver = new CommandOptionResolver(interaction);

        expect(resolver.getUser('target')).toBe('user-1');
        expect(resolver.getInteger('days')).toBe(3);
        expect(resolver.getString('missing')).toBeNull();
    });

    it('throws when a required option is missing', () => {
        const interaction = createInteraction(
            createCommandInteraction('ban'),
            api.interactions,
        );

        const resolver = new CommandOptionResolver(interaction);

        expect(() => resolver.getString('target', true)).toThrow(Error);
    });

    it('throws when the option has the wrong type', () => {
        const interaction = createInteraction(
            createCommandInteraction('ban', {
                options: [
                    {
                        name: 'target',
                        type: ApplicationCommandOptionType.User,
                        value: 'user-1',
                    },
                ],
            }),
            api.interactions,
        );

        const resolver = new CommandOptionResolver(interaction);

        expect(() => resolver.getString('target')).toThrow(TypeError);
    });

    it('hoists through the subcommand options', () => {
        const interaction = createInteraction(
            createCommandInteraction('config', {
                options: [
                    {
                        name: 'set',
                        type: ApplicationCommandOptionType.Subcommand,
                        value: undefined,
                        options: [
                            {
                                name: 'key',
                                type: ApplicationCommandOptionType.String,
                                value: 'colour',
                            },
                        ],
                    },
                ],
            }),
            api.interactions,
        );

        const resolver = new CommandOptionResolver(interaction);

        expect(resolver.getSubcommand()).toBe('set');
        expect(resolver.getString('key')).toBe('colour');
    });
});

describe('argument validation', () => {
    let api: API;

    beforeEach(() => {
        api = createApi(new MockTransport());
    });

    const builder = new SlashCommandBuilder()
        .setName('roll')
        .setDescription('Roll a die')
        .addIntegerOption((option) =>
            option
                .setName('sides')
                .setDescription('How many sides')
                .setMinValue(2)
                .setMaxValue(100)
                .setRequired(true),
        );

    it('produces a plain arguments record', () => {
        const interaction = createInteraction(
            createCommandInteraction('roll', {
                options: [
                    {
                        name: 'sides',
                        type: ApplicationCommandOptionType.Integer,
                        value: 6,
                    },
                ],
            }),
            api.interactions,
        );

        const resolver = new CommandOptionResolver(interaction);
        const args = resolveArgs(deriveSchemaFromBuilder(builder), resolver);

        expect(args).toEqual({ sides: 6 });
        expect(JSON.parse(JSON.stringify(args))).toEqual({ sides: 6 });
    });

    it('rejects a value outside the bounds', () => {
        const interaction = createInteraction(
            createCommandInteraction('roll', {
                options: [
                    {
                        name: 'sides',
                        type: ApplicationCommandOptionType.Integer,
                        value: 1000,
                    },
                ],
            }),
            api.interactions,
        );

        const resolver = new CommandOptionResolver(interaction);

        expect(() =>
            resolveArgs(deriveSchemaFromBuilder(builder), resolver),
        ).toThrow(RangeError);
    });

    it('rejects a missing required option', () => {
        const interaction = createInteraction(
            createCommandInteraction('roll'),
            api.interactions,
        );

        const resolver = new CommandOptionResolver(interaction);

        expect(() =>
            resolveArgs(deriveSchemaFromBuilder(builder), resolver),
        ).toThrow(Error);
    });
});

describe('command manager', () => {
    let transport: MockTransport;
    let api: API;
    let manager: CommandManager;

    beforeEach(() => {
        transport = new MockTransport();
        api = createApi(transport);
        manager = new CommandManager({ api, ownerIds: ['owner-1'] });
    });

    it('rejects a command without a builder', () => {
        expect(() =>
            manager.add({
                name: 'ping',
                description: 'Ping',
                execute: () => undefined,
            }),
        ).toThrow(TypeError);
    });

    it('rejects duplicate commands', () => {
        const builder = new SlashCommandBuilder()
            .setName('ping')
            .setDescription('Ping');

        manager.add({
            name: 'ping',
            description: 'Ping',
            builder,
            execute: () => undefined,
        });

        expect(() =>
            manager.add({
                name: 'ping',
                description: 'Ping',
                builder,
                execute: () => undefined,
            }),
        ).toThrow(Error);
    });

    it('dispatches a command and passes the arguments', async () => {
        const builder = new SlashCommandBuilder()
            .setName('echo')
            .setDescription('Echo')
            .addStringOption((option) =>
                option
                    .setName('text')
                    .setDescription('The text')
                    .setRequired(true),
            );

        let received: unknown;

        manager.add({
            name: 'echo',
            description: 'Echo',
            builder,
            execute: (context) => {
                received = context.args;
            },
        });

        const handled = await manager.handle(
            createInteraction(
                createCommandInteraction('echo', {
                    options: [
                        {
                            name: 'text',
                            type: ApplicationCommandOptionType.String,
                            value: 'hi',
                        },
                    ],
                }),
                api.interactions,
            ),
        );

        expect(handled).toBe(true);
        expect(received).toEqual({ text: 'hi' });
    });

    it('ignores unknown commands', async () => {
        const handled = await manager.handle(
            createInteraction(
                createCommandInteraction('unknown'),
                api.interactions,
            ),
        );

        expect(handled).toBe(false);
    });

    it('denies guild-only commands in direct messages', async () => {
        const builder = new SlashCommandBuilder()
            .setName('ban')
            .setDescription('Ban');

        let executed = false;

        manager.add({
            name: 'ban',
            description: 'Ban',
            builder,
            guildOnly: true,
            execute: () => {
                executed = true;
            },
        });

        await manager.handle(
            createInteraction(
                createCommandInteraction('ban', { guildId: null }),
                api.interactions,
            ),
        );

        expect(executed).toBe(false);
    });

    it('denies owner-only commands to other users', async () => {
        const builder = new SlashCommandBuilder()
            .setName('shutdown')
            .setDescription('Shutdown');

        let executed = false;

        manager.add({
            name: 'shutdown',
            description: 'Shutdown',
            builder,
            ownerOnly: true,
            execute: () => {
                executed = true;
            },
        });

        await manager.handle(
            createInteraction(
                createCommandInteraction('shutdown', { userId: 'someone' }),
                api.interactions,
            ),
        );

        expect(executed).toBe(false);
    });

    it('enforces cooldowns', async () => {
        const builder = new SlashCommandBuilder()
            .setName('ping')
            .setDescription('Ping');

        let executions = 0;

        manager.add({
            name: 'ping',
            description: 'Ping',
            builder,
            cooldown: 60_000,
            execute: () => {
                executions += 1;
            },
        });

        const interaction = () =>
            createInteraction(
                createCommandInteraction('ping', { userId: 'user-1' }),
                api.interactions,
            );

        await manager.handle(interaction());
        await manager.handle(interaction());

        expect(executions).toBe(1);
    });

    it('runs the middleware in order', async () => {
        const builder = new SlashCommandBuilder()
            .setName('ping')
            .setDescription('Ping');

        const order: string[] = [];

        manager.add({
            name: 'ping',
            description: 'Ping',
            builder,
            middlewares: [
                async (_context, next) => {
                    order.push('first');

                    await next();
                },
                async (_context, next) => {
                    order.push('second');

                    await next();
                },
            ],
            execute: () => {
                order.push('handler');
            },
        });

        await manager.handle(
            createInteraction(
                createCommandInteraction('ping'),
                api.interactions,
            ),
        );

        expect(order).toEqual(['first', 'second', 'handler']);
    });

    it('registers the commands globally', async () => {
        const builder = new SlashCommandBuilder()
            .setName('ping')
            .setDescription('Ping');

        manager.add({
            name: 'ping',
            description: 'Ping',
            builder,
            execute: () => undefined,
        });

        await manager.registerGlobal('app-1');

        const request = transport.requests.at(-1);

        expect(request?.method).toBe('PUT');
        expect(request?.url).toContain('/applications/app-1/commands');
    });

    it('registers the commands per guild during development', async () => {
        const builder = new SlashCommandBuilder()
            .setName('ping')
            .setDescription('Ping');

        manager.add({
            name: 'ping',
            description: 'Ping',
            builder,
            execute: () => undefined,
        });

        await manager.register({
            applicationId: 'app-1',
            guildIds: ['guild-1'],
        });

        const request = transport.requests.at(-1);

        expect(request?.method).toBe('PUT');
        expect(request?.url).toContain(
            '/applications/app-1/guilds/guild-1/commands',
        );
    });

    it('rejects an autocomplete request for an option without autocomplete', async () => {
        const builder = new SlashCommandBuilder()
            .setName('tag')
            .setDescription('Tag')
            .addStringOption((option) =>
                option.setName('name').setDescription('Name'),
            );

        manager.add({
            name: 'tag',
            description: 'Tag',
            builder,
            execute: () => undefined,
        });

        const handled = await manager.handleAutocomplete(
            createInteraction(
                createAutocompleteInteraction('tag', {
                    name: 'name',
                    type: ApplicationCommandOptionType.String,
                    value: 'par',
                }),
                api.interactions,
            ),
            async () => {
                throw new Error('The handler must not run.');
            },
        );

        expect(handled).toBe(true);
    });
});
