import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Menu } from '../../src/menu/Menu';
import { MenuOptions, MenuPage } from '../../src/menu/types';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    Message,
    MessageActionRowComponentBuilder,
    MessageComponentInteraction,
    MessageFlags,
    RepliableInteraction,
    StringSelectMenuBuilder,
    TextBasedChannel,
} from 'discord.js';
import { EventEmitter } from 'events';

const pageOne: MenuPage = {
    name: 'page-one',
    embed: new EmbedBuilder()
        .setTitle('page one')
        .setDescription('description'),
};

const pageTwo: MenuPage = {
    name: 'page-two',
    embed: new EmbedBuilder()
        .setTitle('page two')
        .setDescription('description'),
};

const pageThree: MenuPage = {
    name: 'page-three',
    embed: new EmbedBuilder()
        .setTitle('page three')
        .setDescription('description'),
};

function makeOptions(overrides: Partial<MenuOptions> = {}): MenuOptions {
    return {
        name: 'menu-123',
        userId: 'user-123',
        pages: [pageOne, pageTwo],
        ...overrides,
    };
}

function makeMessage() {
    const collector = new EventEmitter() as EventEmitter & {
        stop: ReturnType<typeof vi.fn>;
    };

    collector.stop = vi.fn((reason?: string) => {
        collector.emit('end', new Map(), reason ?? 'user');
    });

    const message = {
        id: 'message-123',
        edit: vi.fn(),
        delete: vi.fn().mockResolvedValue(undefined),
        createMessageComponentCollector: vi.fn(() => collector),
        components: [],
    };

    message.edit.mockImplementation(async () => message);

    return {
        message: message as unknown as Message,
        collector,
        mocks: message,
    };
}

function makeInteraction(
    message: Message,
    overrides: {
        replied?: boolean;
        deferred?: boolean;
    } = {},
) {
    return {
        replied: overrides.replied ?? false,
        deferred: overrides.deferred ?? false,
        reply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(message),
        followUp: vi.fn().mockResolvedValue(message),
        fetchReply: vi.fn().mockResolvedValue(message),
        webhook: {
            editMessage: vi.fn().mockResolvedValue(message),
            deleteMessage: vi.fn().mockResolvedValue(undefined),
        },
    } as unknown as RepliableInteraction & {
        reply: ReturnType<typeof vi.fn>;
        editReply: ReturnType<typeof vi.fn>;
        followUp: ReturnType<typeof vi.fn>;
        fetchReply: ReturnType<typeof vi.fn>;
        webhook: {
            editMessage: ReturnType<typeof vi.fn>;
            deleteMessage: ReturnType<typeof vi.fn>;
        };
    };
}

function makeChannel(message: Message, sendable = true) {
    return {
        isSendable: () => sendable,
        send: vi.fn().mockResolvedValue(message),
    } as unknown as TextBasedChannel & {
        send: ReturnType<typeof vi.fn>;
    };
}

function makeComponentRow(
    customId = 'test-button',
): ActionRowBuilder<MessageActionRowComponentBuilder> {
    return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(customId)
            .setLabel('Test button')
            .setStyle(ButtonStyle.Primary),
    );
}

type ComponentInteractionMock = MessageComponentInteraction & {
    reply: ReturnType<typeof vi.fn>;
    deferUpdate: ReturnType<typeof vi.fn>;
};

function makeComponentInteraction(
    overrides: {
        customId?: string;
        userId?: string;
        isButton?: boolean;
        isStringSelectMenu?: boolean;
        values?: string[];
        replied?: boolean;
        deferred?: boolean;
    } = {},
): ComponentInteractionMock {
    return {
        customId: overrides.customId ?? 'test-button',
        user: { id: overrides.userId ?? 'user-123' },
        replied: overrides.replied ?? false,
        deferred: overrides.deferred ?? false,
        isButton: () => overrides.isButton ?? false,
        isStringSelectMenu: () => overrides.isStringSelectMenu ?? false,
        values: overrides.values ?? [],
        reply: vi.fn().mockResolvedValue(undefined),
        deferUpdate: vi.fn().mockResolvedValue(undefined),
    } as unknown as ComponentInteractionMock;
}

async function settle(): Promise<void> {
    for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
    }
}

describe('Menu constructor', () => {
    it('creates a menu with a name', () => {
        const menu = new Menu(makeOptions({ name: 'main-menu' }));

        expect(menu.name).toBe('main-menu');
    });

    it('uses the first page as the current page', () => {
        const menu = new Menu(makeOptions());

        expect(menu.currentPage).toBe(pageOne);
        expect(menu.currentPageIndex).toBe(0);
    });

    it('rejects a page with more than four component rows', () => {
        const invalidPage: MenuPage = {
            ...pageOne,
            components: Array.from({ length: 5 }, makeComponentRow),
        };

        expect(() => new Menu(makeOptions({ pages: [invalidPage] }))).toThrow(
            'Pages can have at most 4 custom rows, "page-one" has 5',
        );
    });

    it('accepts a page with exactly four component rows', () => {
        const validPage: MenuPage = {
            ...pageOne,
            components: Array.from({ length: 4 }, makeComponentRow),
        };

        expect(
            () => new Menu(makeOptions({ pages: [validPage] })),
        ).not.toThrow();
    });

    it('reserves two rows for prev-select-next navigation', () => {
        const validPage: MenuPage = {
            ...pageOne,
            components: Array.from({ length: 3 }, makeComponentRow),
        };
        const invalidPage: MenuPage = {
            ...pageOne,
            components: Array.from({ length: 4 }, makeComponentRow),
        };

        expect(
            () =>
                new Menu(
                    makeOptions({
                        pages: [validPage],
                        navigation: 'prev-select-next',
                    }),
                ),
        ).not.toThrow();

        expect(
            () =>
                new Menu(
                    makeOptions({
                        pages: [invalidPage],
                        navigation: 'prev-select-next',
                    }),
                ),
        ).toThrow('Pages can have at most 3 custom rows, "page-one" has 4');
    });

    it('reserves one row for select and wizard navigation', () => {
        const validPage: MenuPage = {
            ...pageOne,
            components: Array.from({ length: 4 }, makeComponentRow),
        };

        expect(
            () =>
                new Menu(
                    makeOptions({
                        pages: [validPage],
                        navigation: 'select',
                    }),
                ),
        ).not.toThrow();

        expect(
            () =>
                new Menu(
                    makeOptions({
                        pages: [validPage],
                        navigation: 'wizard',
                    }),
                ),
        ).not.toThrow();
    });

    it('rejects custom component IDs using the reserved navigation prefix', () => {
        const row =
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('menu:navigation:custom-action')
                    .setLabel('Custom action')
                    .setStyle(ButtonStyle.Primary),
            );

        const invalidPage: MenuPage = {
            ...pageOne,
            components: [row],
        };

        expect(() => new Menu(makeOptions({ pages: [invalidPage] }))).toThrow(
            /Custom component IDs must not use/,
        );
    });

    it('accepts custom component IDs outside the reserved navigation prefix', () => {
        const row = makeComponentRow();

        const validPage: MenuPage = {
            ...pageOne,
            components: [row],
        };

        expect(
            () => new Menu(makeOptions({ pages: [validPage] })),
        ).not.toThrow();
    });

    it('initializes the message as null', () => {
        const menu = new Menu(makeOptions());

        expect(menu.menuMessage).toBeNull();
    });

    it('rejects an empty pages array', () => {
        expect(() => new Menu(makeOptions({ pages: [] }))).toThrow(RangeError);
    });

    it('rejects a blank user ID', () => {
        expect(() => new Menu(makeOptions({ userId: '   ' }))).toThrow(
            'userId must be present.',
        );
    });

    it('rejects a zero timeout', () => {
        expect(() => new Menu(makeOptions({ timeout: 0 }))).toThrow(
            'timeout must be a positive number.',
        );
    });

    it('rejects negative timeout', () => {
        expect(() => new Menu(makeOptions({ timeout: -100 }))).toThrow(
            RangeError,
        );
    });

    it('rejects infinity timeout', () => {
        expect(() => new Menu(makeOptions({ timeout: Infinity }))).toThrow(
            RangeError,
        );
    });

    it('rejects negative infinity timeout', () => {
        expect(() => new Menu(makeOptions({ timeout: -Infinity }))).toThrow(
            RangeError,
        );
    });

    it('rejects a NaN timeout', () => {
        expect(() => new Menu(makeOptions({ timeout: NaN }))).toThrow(
            RangeError,
        );
    });

    it('rejects a blank page name', () => {
        const invalidPage = { ...pageOne, name: '   ' };

        expect(() => new Menu(makeOptions({ pages: [invalidPage] }))).toThrow(
            'Page name must not be empty.',
        );
    });

    it('rejects duplicate page names', () => {
        const duplicatePage = { ...pageOne };

        expect(
            () => new Menu(makeOptions({ pages: [pageOne, duplicatePage] })),
        ).toThrow(`Duplicate page name: "page-one".`);
    });

    it('accepts a valid custom timeout', () => {
        expect(() => new Menu(makeOptions({ timeout: 60_000 }))).not.toThrow();
    });
});

describe('Menu public methods', () => {
    let menu: Menu;
    let message: Message;
    let collector: EventEmitter & {
        stop: ReturnType<typeof vi.fn>;
    };
    let messageMocks: ReturnType<typeof makeMessage>['mocks'];

    beforeEach(() => {
        const mock = makeMessage();

        message = mock.message;
        collector = mock.collector;
        messageMocks = mock.mocks;

        menu = new Menu(makeOptions());
    });

    describe('getters', () => {
        it('returns the initial page and index', () => {
            expect(menu.currentPage).toBe(pageOne);
            expect(menu.currentPageIndex).toBe(0);
        });

        it('returns null before the menu is sent', () => {
            expect(menu.menuMessage).toBeNull();
        });
    });

    describe('reply', () => {
        it('replies to the interaction and initializes the menu', async () => {
            const interaction = makeInteraction(message);

            const result = await menu.reply(interaction);

            expect(result).toBe(message);
            expect(interaction.reply).toHaveBeenCalledOnce();
            expect(interaction.fetchReply).toHaveBeenCalledOnce();

            const payload = interaction.reply.mock.calls[0][0];

            expect(payload.embeds).toEqual([pageOne.embed]);
            expect(payload.components).toHaveLength(1);
            expect(payload.flags).toBe(MessageFlags.Ephemeral);

            expect(menu.menuMessage).toBe(message);
            expect(
                messageMocks.createMessageComponentCollector,
            ).toHaveBeenCalledWith({ time: 180_000 });
        });

        it('creates a public reply when ephemeral is false', async () => {
            const interaction = makeInteraction(message);

            await menu.reply(interaction, { ephemeral: false });

            const payload = interaction.reply.mock.calls[0][0];

            expect(payload.flags).toBeUndefined();
        });

        it('edits the deferred response instead of replying again', async () => {
            const interaction = makeInteraction(message, {
                deferred: true,
            });

            await menu.reply(interaction);

            expect(interaction.editReply).toHaveBeenCalledOnce();
            expect(interaction.reply).not.toHaveBeenCalled();
            expect(interaction.fetchReply).toHaveBeenCalledOnce();

            const payload = interaction.editReply.mock.calls[0][0];

            expect(payload.embeds).toEqual([pageOne.embed]);
            expect(payload.components).toHaveLength(1);
        });

        it('uses the webhook controller for a deferred response', async () => {
            const interaction = makeInteraction(message, {
                deferred: true,
            });

            await menu.reply(interaction, { ephemeral: false });
            await menu.setPage(1);

            expect(interaction.webhook.editMessage).toHaveBeenCalledWith(
                '@original',
                expect.objectContaining({
                    embeds: [pageTwo.embed],
                }),
            );
            expect(messageMocks.edit).not.toHaveBeenCalled();
        });

        it('rejects an interaction that has already been replied to', async () => {
            const interaction = makeInteraction(message, {
                replied: true,
            });

            await expect(menu.reply(interaction)).rejects.toThrow(
                'This interaction has already been replied to. Use followUp() instead.',
            );

            expect(interaction.reply).not.toHaveBeenCalled();
            expect(interaction.editReply).not.toHaveBeenCalled();
            expect(interaction.fetchReply).not.toHaveBeenCalled();
        });

        it('emits menuSent', async () => {
            const listener = vi.fn();
            const interaction = makeInteraction(message);

            menu.on('menuSent', listener);

            await menu.reply(interaction);

            expect(listener).toHaveBeenCalledOnce();
        });

        it('rejects initializing the same menu twice', async () => {
            const interaction = makeInteraction(message);

            await menu.reply(interaction);

            const secondMessage = makeMessage();
            const secondInteraction = makeInteraction(secondMessage.message);

            await expect(menu.reply(secondInteraction)).rejects.toThrow(
                'This menu has already been started.',
            );
        });

        it('preserves additional message options', async () => {
            const interaction = makeInteraction(message);

            await menu.reply(
                interaction,
                { ephemeral: false },
                {
                    content: 'Hello!',
                },
            );

            const payload = interaction.reply.mock.calls[0][0];

            expect(payload.content).toBe('Hello!');
            expect(payload.embeds).toEqual([pageOne.embed]);
            expect(payload.components).toHaveLength(1);
        });
    });

    describe('followUp', () => {
        it('sends a follow-up and initializes the menu', async () => {
            const interaction = makeInteraction(message);

            const result = await menu.followUp(interaction);

            expect(result).toBe(message);
            expect(interaction.followUp).toHaveBeenCalledOnce();

            const payload = interaction.followUp.mock.calls[0][0];

            expect(payload.embeds).toEqual([pageOne.embed]);
            expect(payload.components).toHaveLength(1);
            expect(payload.flags).toBe(MessageFlags.Ephemeral);

            expect(menu.menuMessage).toBe(message);
            expect(
                messageMocks.createMessageComponentCollector,
            ).toHaveBeenCalledWith({ time: 180_000 });
        });

        it('creates a public follow-up when ephemeral is false', async () => {
            const interaction = makeInteraction(message);

            await menu.followUp(interaction, { ephemeral: false });

            const payload = interaction.followUp.mock.calls[0][0];

            expect(payload.flags).toBeUndefined();
        });

        it('edits the ephemeral follow-up message when changing pages', async () => {
            const interaction = makeInteraction(message);

            await menu.followUp(interaction);

            await menu.setPage(1);

            expect(interaction.webhook.editMessage).toHaveBeenCalledWith(
                message.id,
                expect.objectContaining({
                    embeds: [pageTwo.embed],
                }),
            );
        });

        it('emits menuSent', async () => {
            const listener = vi.fn();
            const interaction = makeInteraction(message);

            menu.on('menuSent', listener);

            await menu.followUp(interaction);

            expect(listener).toHaveBeenCalledOnce();
        });

        it('rejects initializing the same menu twice', async () => {
            const interaction = makeInteraction(message);

            await menu.followUp(interaction);

            const secondMessage = makeMessage();
            const secondInteraction = makeInteraction(secondMessage.message);

            await expect(menu.followUp(secondInteraction)).rejects.toThrow(
                'This menu has already been started.',
            );
        });

        it('propagates follow-up API errors', async () => {
            const interaction = makeInteraction(message);

            interaction.followUp.mockRejectedValueOnce(
                new Error('Discord API failure'),
            );

            await expect(menu.followUp(interaction)).rejects.toThrow(
                'Discord API failure',
            );

            expect(menu.menuMessage).toBeNull();
        });

        it('does not emit menuSent when sending fails', async () => {
            const interaction = makeInteraction(message);
            const listener = vi.fn();

            interaction.followUp.mockRejectedValueOnce(
                new Error('Discord API failure'),
            );

            menu.on('menuSent', listener);

            await expect(menu.followUp(interaction)).rejects.toThrow(
                'Discord API failure',
            );

            expect(listener).not.toHaveBeenCalled();
            expect(menu.menuMessage).toBeNull();
        });
    });

    describe('send', () => {
        it('sends the initial page and initializes the menu', async () => {
            const channel = makeChannel(message);

            const result = await menu.send(channel);

            expect(result).toBe(message);
            expect(channel.send).toHaveBeenCalledOnce();

            const payload = channel.send.mock.calls[0][0];

            expect(payload.embeds).toEqual([pageOne.embed]);
            expect(payload.components).toHaveLength(1);
            expect(menu.menuMessage).toBe(message);
            expect(
                messageMocks.createMessageComponentCollector,
            ).toHaveBeenCalledWith({ time: 180_000 });
        });

        it('starts the menu when the initial page callback fails', async () => {
            const onPageChange = vi
                .fn()
                .mockRejectedValue(new Error('Callback failed'));

            menu = new Menu(makeOptions({ onPageChange }));

            const errorListener = vi.fn();
            const pageChangeListener = vi.fn();

            menu.on('menuError', errorListener);
            menu.on('pageChange', pageChangeListener);

            const result = await menu.send(makeChannel(message));

            expect(result).toBe(message);
            expect(menu.menuMessage).toBe(message);

            expect(errorListener).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Callback failed',
                }),
            );

            expect(pageChangeListener).toHaveBeenCalledWith(pageOne, 0);
        });

        it('rejects sending the same menu twice', async () => {
            const channel = makeChannel(message);

            await menu.send(channel);

            await expect(menu.send(channel)).rejects.toThrow(
                'This menu has already been started.',
            );
            expect(channel.send).toHaveBeenCalledOnce();
        });

        it('emits menuSent when sending the menu', async () => {
            const listener = vi.fn();
            menu.on('menuSent', listener);

            await menu.send(makeChannel(message));

            expect(listener).toHaveBeenCalledOnce();
        });

        it('uses the default timeout when none is provided', async () => {
            await menu.send(makeChannel(message));

            expect(
                messageMocks.createMessageComponentCollector,
            ).toHaveBeenCalledWith({ time: 180_000 });
        });

        it('rejects an unsendable channel', async () => {
            const channel = makeChannel(message, false);

            await expect(menu.send(channel)).rejects.toThrow(
                'This channel is not sendable.',
            );

            expect(channel.send).not.toHaveBeenCalled();
        });
    });

    describe('setPage', () => {
        async function startMenu() {
            await menu.send(makeChannel(message));
        }

        it('updates the embed and navigation controls when changing pages', async () => {
            await startMenu();

            await menu.setPage(1);

            const payload = messageMocks.edit.mock.calls[0][0];

            expect(payload.embeds).toEqual([pageTwo.embed]);

            const navigation = payload.components.at(-1)!;

            expect(navigation.components[0].data.disabled).toBe(false);
            expect(navigation.components[1].data.disabled).toBe(true);
        });

        it('changes to a valid page', async () => {
            await startMenu();

            await menu.setPage(1);

            expect(menu.currentPage).toBe(pageTwo);
            expect(menu.currentPageIndex).toBe(1);
            expect(messageMocks.edit).toHaveBeenCalledOnce();

            const payload = messageMocks.edit.mock.calls[0][0];

            expect(payload.embeds).toEqual([pageTwo.embed]);
        });

        it('emits pageChange after successfully changing pages', async () => {
            await startMenu();

            const listener = vi.fn();
            menu.on('pageChange', listener);

            await menu.setPage(1);

            expect(listener).toHaveBeenCalledOnce();
            expect(listener).toHaveBeenCalledWith(pageTwo, 1);
        });

        it('calls onPageChange after changing pages', async () => {
            const onPageChange = vi.fn().mockResolvedValue(undefined);

            menu = new Menu(makeOptions({ onPageChange }));

            await menu.send(makeChannel(message));
            onPageChange.mockClear();

            await menu.setPage(1);

            expect(onPageChange).toHaveBeenCalledWith(pageTwo, 1);
        });

        it('rejects changing pages before initialization', async () => {
            await expect(menu.setPage(1)).rejects.toThrow(
                'Start the menu before changing pages.',
            );
        });

        it('rejects changing pages after stopping', async () => {
            await menu.send(makeChannel(message));

            await menu.stop();

            await expect(menu.setPage(1)).rejects.toThrow(
                'This menu has stopped.',
            );
        });

        it.each([-1, 2, 1.5, NaN])(
            'rejects invalid page index %s',
            async (index) => {
                await startMenu();

                await expect(menu.setPage(index)).rejects.toThrow(RangeError);

                expect(menu.currentPageIndex).toBe(0);
            },
        );

        it('preserves the current page when editing fails', async () => {
            await startMenu();

            messageMocks.edit.mockRejectedValueOnce(
                new Error('Discord API failure'),
            );

            await expect(menu.setPage(1)).rejects.toThrow(
                'There was an issue updating the message to new page',
            );

            expect(menu.currentPageIndex).toBe(0);
        });

        it('does not emit pageChange when editing fails', async () => {
            await startMenu();

            const listener = vi.fn();
            menu.on('pageChange', listener);

            messageMocks.edit.mockRejectedValueOnce(
                new Error('Discord API failure'),
            );

            await expect(menu.setPage(1)).rejects.toThrow();

            expect(listener).not.toHaveBeenCalled();
        });

        it('serializes concurrent page changes', async () => {
            await startMenu();

            await Promise.all([menu.setPage(1), menu.setPage(0)]);

            expect(menu.currentPageIndex).toBe(0);
            expect(messageMocks.edit).toHaveBeenCalledTimes(2);
        });
    });

    describe('interactions', () => {
        async function startMenu(): Promise<void> {
            await menu.send(makeChannel(message));
        }

        async function dispatch(
            interaction: MessageComponentInteraction,
        ): Promise<void> {
            collector.emit('collect', interaction);
            await settle();
        }

        describe('access control', () => {
            it('rejects a user other than the caller by default', async () => {
                await startMenu();

                const interaction = makeComponentInteraction({
                    customId: 'menu:navigationnext',
                    userId: 'other-user',
                    isButton: true,
                });

                await dispatch(interaction);

                expect(interaction.reply).toHaveBeenCalledWith({
                    content: 'You cannot control this menu.',
                    flags: MessageFlags.Ephemeral,
                });
                expect(interaction.deferUpdate).not.toHaveBeenCalled();
                expect(menu.currentPageIndex).toBe(0);
            });

            it('allows any user when access is everyone', async () => {
                menu = new Menu(makeOptions({ access: { type: 'everyone' } }));

                await startMenu();

                const interaction = makeComponentInteraction({
                    customId: 'menu:navigationnext',
                    userId: 'other-user',
                    isButton: true,
                });

                await dispatch(interaction);

                expect(interaction.deferUpdate).toHaveBeenCalledOnce();
                expect(menu.currentPageIndex).toBe(1);
            });

            it('uses a custom access filter', async () => {
                const filter = vi.fn().mockResolvedValue(true);

                menu = new Menu(
                    makeOptions({ access: { type: 'custom', filter } }),
                );

                await startMenu();

                const interaction = makeComponentInteraction({
                    customId: 'menu:navigationnext',
                    userId: 'allowed-user',
                    isButton: true,
                });

                await dispatch(interaction);

                expect(filter).toHaveBeenCalledWith(interaction);
                expect(menu.currentPageIndex).toBe(1);
            });

            it('rejects a user when the custom access filter denies them', async () => {
                menu = new Menu(
                    makeOptions({
                        access: {
                            type: 'custom',
                            filter: () => false,
                        },
                    }),
                );

                await startMenu();

                const interaction = makeComponentInteraction({
                    customId: 'menu:navigationnext',
                    userId: 'other-user',
                    isButton: true,
                });

                await dispatch(interaction);

                expect(interaction.reply).toHaveBeenCalledWith({
                    content: 'You cannot control this menu.',
                    flags: MessageFlags.Ephemeral,
                });
                expect(menu.currentPageIndex).toBe(0);
            });

            it('falls back to the caller when the custom access filter fails', async () => {
                const error = new Error('Filter failed');
                const filter = vi.fn().mockRejectedValue(error);
                const errorListener = vi.fn();

                menu = new Menu(
                    makeOptions({ access: { type: 'custom', filter } }),
                );
                menu.on('menuError', errorListener);

                await startMenu();

                const interaction = makeComponentInteraction({
                    customId: 'menu:navigationnext',
                    isButton: true,
                });

                await dispatch(interaction);

                expect(errorListener).toHaveBeenCalledWith(error);
                expect(menu.currentPageIndex).toBe(1);
            });

            it('rejects another user when the custom access filter fails', async () => {
                menu = new Menu(
                    makeOptions({
                        access: {
                            type: 'custom',
                            filter: () => {
                                throw new Error('Filter failed');
                            },
                        },
                    }),
                );

                await startMenu();

                const interaction = makeComponentInteraction({
                    customId: 'menu:navigationnext',
                    userId: 'other-user',
                    isButton: true,
                });

                await dispatch(interaction);

                expect(interaction.reply).toHaveBeenCalledWith({
                    content: 'You cannot control this menu.',
                    flags: MessageFlags.Ephemeral,
                });
                expect(menu.currentPageIndex).toBe(0);
            });
        });

        describe('custom handlers', () => {
            it('invokes the current page handler for custom components', async () => {
                const handler = vi.fn().mockResolvedValue(undefined);

                menu = new Menu(
                    makeOptions({
                        pages: [
                            { ...pageOne, onInteraction: handler },
                            pageTwo,
                        ],
                    }),
                );

                await startMenu();

                const interaction = makeComponentInteraction();

                await dispatch(interaction);

                expect(handler).toHaveBeenCalledWith(interaction, menu);
            });

            it('replies when a custom component has no handler', async () => {
                await startMenu();

                const interaction = makeComponentInteraction();

                await dispatch(interaction);

                expect(interaction.reply).toHaveBeenCalledWith({
                    content: 'This component has no action handler.',
                    flags: MessageFlags.Ephemeral,
                });
            });

            it('reports handler errors and replies with an error message', async () => {
                const error = new Error('Handler failed');
                const handler = vi.fn().mockRejectedValue(error);
                const errorListener = vi.fn();

                menu = new Menu(
                    makeOptions({
                        pages: [
                            { ...pageOne, onInteraction: handler },
                            pageTwo,
                        ],
                    }),
                );
                menu.on('menuError', errorListener);

                await startMenu();

                const interaction = makeComponentInteraction();

                await dispatch(interaction);

                expect(errorListener).toHaveBeenCalledWith(error);
                expect(interaction.reply).toHaveBeenCalledWith({
                    content:
                        'An error occurred while handling this interaction.',
                    flags: MessageFlags.Ephemeral,
                });
            });

            it('does not reply after a handler fails on a handled interaction', async () => {
                const error = new Error('Handler failed');
                const handler = vi.fn().mockRejectedValue(error);
                const errorListener = vi.fn();

                menu = new Menu(
                    makeOptions({
                        pages: [
                            { ...pageOne, onInteraction: handler },
                            pageTwo,
                        ],
                    }),
                );
                menu.on('menuError', errorListener);

                await startMenu();

                const interaction = makeComponentInteraction({ replied: true });

                await dispatch(interaction);

                expect(errorListener).toHaveBeenCalledWith(error);
                expect(interaction.reply).not.toHaveBeenCalled();
            });

            it('rejects interactions after the menu has stopped', async () => {
                await startMenu();
                await menu.stop();

                const interaction = makeComponentInteraction();

                await dispatch(interaction);

                expect(interaction.reply).toHaveBeenCalledWith({
                    content: 'This menu has ended.',
                    flags: MessageFlags.Ephemeral,
                });
            });
        });

        describe('navigation', () => {
            it('moves between pages and stops at the boundaries', async () => {
                await startMenu();

                const previous = makeComponentInteraction({
                    customId: 'menu:navigationprevious',
                    isButton: true,
                });
                const next = makeComponentInteraction({
                    customId: 'menu:navigationnext',
                    isButton: true,
                });

                await dispatch(previous);

                expect(previous.deferUpdate).toHaveBeenCalledOnce();
                expect(menu.currentPageIndex).toBe(0);

                await dispatch(next);

                expect(next.deferUpdate).toHaveBeenCalledOnce();
                expect(menu.currentPageIndex).toBe(1);

                await dispatch(next);

                expect(menu.currentPageIndex).toBe(1);

                await dispatch(previous);

                expect(menu.currentPageIndex).toBe(0);
            });

            it('applies queued relative steps in order', async () => {
                menu = new Menu(
                    makeOptions({ pages: [pageOne, pageTwo, pageThree] }),
                );

                await startMenu();

                const firstNext = makeComponentInteraction({
                    customId: 'menu:navigationnext',
                    isButton: true,
                });
                const secondNext = makeComponentInteraction({
                    customId: 'menu:navigationnext',
                    isButton: true,
                });

                collector.emit('collect', firstNext);
                collector.emit('collect', secondNext);
                await settle();

                expect(menu.currentPageIndex).toBe(2);
                expect(messageMocks.edit).toHaveBeenCalledTimes(2);
            });

            it('returns through visited pages with back()', async () => {
                menu = new Menu(
                    makeOptions({ pages: [pageOne, pageTwo, pageThree] }),
                );

                await startMenu();
                await menu.setPage(1);
                await menu.setPage(2);

                await menu.back();
                expect(menu.currentPageIndex).toBe(1);

                await menu.back();
                expect(menu.currentPageIndex).toBe(0);

                await menu.back();
                expect(menu.currentPageIndex).toBe(0);
                expect(messageMocks.edit).toHaveBeenCalledTimes(4);
            });

            it('renders only a page select for select navigation', async () => {
                menu = new Menu(makeOptions({ navigation: 'select' }));

                const channel = makeChannel(message);

                await menu.send(channel);

                const payload = channel.send.mock.calls[0][0];

                expect(payload.components).toHaveLength(1);

                const row = payload.components[0]!;

                expect(row.components).toHaveLength(1);

                const select = row.components[0] as StringSelectMenuBuilder;
                const options = select.toJSON().options;

                expect(select.data.custom_id).toBe('menu:navigationselect');
                expect(options.map((option) => option.label)).toEqual([
                    'page-one',
                    'page-two',
                ]);
                expect(options[0]?.default).toBe(true);
                expect(options[1]?.default).toBe(false);
            });

            it('renders a select and previous/next buttons for prev-select-next navigation', async () => {
                menu = new Menu(
                    makeOptions({ navigation: 'prev-select-next' }),
                );

                const channel = makeChannel(message);

                await menu.send(channel);

                const payload = channel.send.mock.calls[0][0];

                expect(payload.components).toHaveLength(2);

                const selectRow = payload.components[0]!;
                const buttonRow = payload.components[1]!;

                expect(selectRow.components[0]!.data.custom_id).toBe(
                    'menu:navigationselect',
                );
                expect(
                    buttonRow.components.map(
                        (component) => component.data.custom_id,
                    ),
                ).toEqual(['menu:navigationprevious', 'menu:navigationnext']);
            });

            it('renders a disabled Back button for wizard navigation', async () => {
                menu = new Menu(
                    makeOptions({
                        navigation: 'wizard',
                        pages: [pageOne, pageTwo],
                    }),
                );

                const channel = makeChannel(message);

                await menu.send(channel);

                const payload = channel.send.mock.calls[0][0];

                expect(payload.components).toHaveLength(1);

                const back = payload.components[0]!.components[0]!;

                expect(back.data.custom_id).toBe('menu:navigationback');
                expect(back.data.disabled).toBe(true);
            });

            it('navigates back through wizard history with the Back button', async () => {
                menu = new Menu(
                    makeOptions({
                        navigation: 'wizard',
                        pages: [pageOne, pageTwo, pageThree],
                    }),
                );

                await startMenu();
                await menu.setPage(1);
                await menu.setPage(2);

                const back = makeComponentInteraction({
                    customId: 'menu:navigationback',
                    isButton: true,
                });

                await dispatch(back);

                expect(back.deferUpdate).toHaveBeenCalledOnce();
                expect(menu.currentPageIndex).toBe(1);

                const secondBack = makeComponentInteraction({
                    customId: 'menu:navigationback',
                    isButton: true,
                });

                await dispatch(secondBack);

                expect(menu.currentPageIndex).toBe(0);
            });

            it('enables the Back button once a page has been visited', async () => {
                menu = new Menu(
                    makeOptions({
                        navigation: 'wizard',
                        pages: [pageOne, pageTwo],
                    }),
                );

                await startMenu();
                await menu.setPage(1);

                const payload = messageMocks.edit.mock.calls[0][0]!;
                const back = payload.components[0]!.components[0]!;

                expect(back.data.disabled).toBe(false);
            });

            it('jumps to a page selected from the page select menu', async () => {
                menu = new Menu(
                    makeOptions({
                        navigation: 'select',
                        pages: [pageOne, pageTwo, pageThree],
                    }),
                );

                await startMenu();

                const interaction = makeComponentInteraction({
                    customId: 'menu:navigationselect',
                    isStringSelectMenu: true,
                    values: ['2'],
                });

                await dispatch(interaction);

                expect(interaction.deferUpdate).toHaveBeenCalledOnce();
                expect(menu.currentPageIndex).toBe(2);
            });

            it.each(['9', '-1', '1.5', 'not-a-number'])(
                'ignores invalid page select value %s',
                async (value) => {
                    menu = new Menu(
                        makeOptions({
                            navigation: 'select',
                            pages: [pageOne, pageTwo],
                        }),
                    );

                    await startMenu();

                    const interaction = makeComponentInteraction({
                        customId: 'menu:navigationselect',
                        isStringSelectMenu: true,
                        values: [value],
                    });

                    await dispatch(interaction);

                    expect(interaction.deferUpdate).toHaveBeenCalledOnce();
                    expect(menu.currentPageIndex).toBe(0);
                },
            );

            it('records page select jumps in history', async () => {
                menu = new Menu(
                    makeOptions({
                        navigation: 'prev-select-next',
                        pages: [pageOne, pageTwo, pageThree],
                    }),
                );

                await startMenu();

                const interaction = makeComponentInteraction({
                    customId: 'menu:navigationselect',
                    isStringSelectMenu: true,
                    values: ['2'],
                });

                await dispatch(interaction);

                await menu.back();

                expect(menu.currentPageIndex).toBe(0);
            });
        });

        describe('component updates', () => {
            it('disables the custom rows of the current page when stopping', async () => {
                const firstRow = makeComponentRow('first-button');
                const secondRow = makeComponentRow('second-button');

                menu = new Menu(
                    makeOptions({
                        pages: [
                            { ...pageOne, components: [firstRow] },
                            { ...pageTwo, components: [secondRow] },
                        ],
                    }),
                );

                await startMenu();
                await menu.setPage(1);

                messageMocks.edit.mockClear();

                await menu.stop();

                const payload = messageMocks.edit.mock.calls[0][0]!;
                const customRow = payload.components[0]!;
                const navigationRow = payload.components.at(-1)!;

                expect(customRow.components[0]!.data.custom_id).toBe(
                    'second-button',
                );
                expect(customRow.components[0]!.data.disabled).toBe(true);
                expect(
                    navigationRow.components.every(
                        (component) => component.data.disabled,
                    ),
                ).toBe(true);
            });
        });
    });

    describe('collector lifecycle', () => {
        it('disables components when the collector times out', async () => {
            await menu.send(makeChannel(message));

            collector.emit('end', new Map(), 'time');
            await settle();

            expect(messageMocks.edit).toHaveBeenCalledOnce();
            expect(messageMocks.delete).not.toHaveBeenCalled();
            expect(menu.menuMessage).toBe(message);
        });

        it('deletes the message on timeout when deleteOnTimeout is true', async () => {
            const deleteListener = vi.fn();

            menu = new Menu(makeOptions({ deleteOnTimeout: true }));
            menu.on('delete', deleteListener);

            await menu.send(makeChannel(message));

            collector.emit('end', new Map(), 'time');
            await settle();

            expect(messageMocks.delete).toHaveBeenCalledOnce();
            expect(deleteListener).toHaveBeenCalledOnce();
            expect(menu.menuMessage).toBeNull();
        });

        it.each([
            'messageDelete',
            'channelDelete',
            'threadDelete',
            'guildDelete',
        ])('clears the message after a %s event', async (reason) => {
            await menu.send(makeChannel(message));

            collector.emit('end', new Map(), reason);
            await settle();

            expect(menu.menuMessage).toBeNull();

            await expect(menu.setPage(1)).rejects.toThrow(
                'Start the menu before changing pages.',
            );
        });
    });

    describe('stop', () => {
        it('does nothing if the menu has not started', async () => {
            await menu.stop();

            expect(menu.menuMessage).toBeNull();
            expect(messageMocks.edit).not.toHaveBeenCalled();
        });

        it('disables ephemeral follow-up components through the webhook controller', async () => {
            const interaction = makeInteraction(message);

            await menu.followUp(interaction);
            await menu.stop();

            expect(interaction.webhook.editMessage).toHaveBeenCalled();
            expect(messageMocks.edit).not.toHaveBeenCalled();
        });

        it('stops the collector and emits stop', async () => {
            await menu.send(makeChannel(message));

            const listener = vi.fn();
            menu.on('stop', listener);

            await menu.stop();

            expect(collector.stop).toHaveBeenCalledWith('menu_stopped');
            expect(messageMocks.edit).toHaveBeenCalled();
            expect(listener).toHaveBeenCalledOnce();
        });
    });

    describe('delete', () => {
        it('deletes the message, clears its reference and emits delete', async () => {
            await menu.send(makeChannel(message));

            const listener = vi.fn();
            menu.on('delete', listener);

            await menu.delete();

            expect(messageMocks.delete).toHaveBeenCalledOnce();
            expect(menu.menuMessage).toBeNull();
            expect(listener).toHaveBeenCalledOnce();
        });

        it('deletes an ephemeral follow-up through the webhook controller', async () => {
            const interaction = makeInteraction(message);

            await menu.followUp(interaction);
            await menu.delete();

            expect(interaction.webhook.deleteMessage).toHaveBeenCalledWith(
                message.id,
            );
            expect(messageMocks.delete).not.toHaveBeenCalled();
        });

        it('emits delete even when no message exists', async () => {
            const listener = vi.fn();
            menu.on('delete', listener);

            await menu.delete();

            expect(menu.menuMessage).toBeNull();
            expect(listener).toHaveBeenCalledOnce();
        });

        it('propagates message deletion errors', async () => {
            await menu.send(makeChannel(message));

            messageMocks.delete.mockRejectedValueOnce(
                new Error('Deletion failed'),
            );

            await expect(menu.delete()).rejects.toThrow('Deletion failed');

            expect(menu.menuMessage).toBe(message);
        });
    });
});
