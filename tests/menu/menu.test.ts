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
    MessageFlags,
    RepliableInteraction,
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
        edit: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        createMessageComponentCollector: vi.fn(() => collector),
        components: [],
    };

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

function makeComponentRow(): ActionRowBuilder<MessageActionRowComponentBuilder> {
    return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('test-button')
            .setLabel('Test button')
            .setStyle(ButtonStyle.Primary),
    );
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
            'Pages can have at most four custom rows, "page-one" has 5',
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
