import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
    Client,
    Message,
    MessageComponentInteraction,
    TextBasedChannel,
} from 'discord.js';

import { Panel } from '../../src/panel/Panel';
import { PanelManager } from '../../src/panel/PanelManager';
import { PanelRegistry } from '../../src/panel/PanelRegistry';
import {
    JsonFilePanelStore,
    MemoryPanelStore,
} from '../../src/panel/PanelStore';
import type { PanelContent, StoredPanel } from '../../src/panel/types';

interface TestState {
    label: string;
    count: number;
}

class TestPanel extends Panel<TestState> {
    public readonly type = 'test';

    constructor(
        id: string,
        public state: TestState = { label: 'initial', count: 0 },
    ) {
        super(id);
    }

    public build(): PanelContent {
        return { content: `${this.state.label}:${this.state.count}` };
    }

    public onInteraction(): void {
        this.state.count += 1;
    }

    public serialize(): TestState {
        return this.state;
    }
}

type Mock = ReturnType<typeof vi.fn>;

type FakeClient = Client & {
    isReady: Mock;
    channels: { fetch: Mock };
};

function makeClient(ready = false): FakeClient {
    const client = new EventEmitter() as unknown as FakeClient;

    client.isReady = vi.fn(() => ready);
    client.channels = { fetch: vi.fn() };

    return client;
}

function makeMessage(overrides: Record<string, unknown> = {}) {
    return {
        id: 'message-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        edit: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as Message & {
        edit: Mock;
        delete: Mock;
    };
}

function makeChannel(message: Message, sendable = true) {
    return {
        isSendable: () => sendable,
        send: vi.fn().mockResolvedValue(message),
    } as unknown as TextBasedChannel & { send: Mock };
}

function makeInteraction(
    message: Message,
    overrides: {
        replied?: boolean;
        deferred?: boolean;
        customId?: string;
    } = {},
) {
    return {
        isMessageComponent: () => true,
        message,
        customId: overrides.customId ?? 'test-button',
        user: { id: 'user-1' },
        replied: overrides.replied ?? false,
        deferred: overrides.deferred ?? false,
        reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as MessageComponentInteraction & { reply: Mock };
}

function makePanelChannel(message: Message) {
    return {
        isTextBased: () => true,
        messages: {
            fetch: vi.fn().mockResolvedValue(message),
        },
    };
}

function makeStoreRecord(overrides: Partial<StoredPanel> = {}): StoredPanel {
    return {
        id: 'panel-1',
        type: 'test',
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'message-1',
        ...overrides,
    };
}

describe('Panel', () => {
    it('starts unattached with public access', () => {
        const panel = new TestPanel('panel-1');

        expect(panel.id).toBe('panel-1');
        expect(panel.type).toBe('test');
        expect(panel.message).toBeNull();
        expect(panel.access).toEqual({ type: 'everyone' });
    });

    it('has no serialized state by default', () => {
        class EmptyPanel extends Panel {
            public readonly type = 'empty';

            public build(): PanelContent {
                return {};
            }

            public onInteraction(): void {}
        }

        expect(new EmptyPanel('panel-1').serialize()).toBeUndefined();
    });
});

describe('PanelRegistry', () => {
    it('registers and resolves factories', () => {
        const registry = new PanelRegistry();
        const factory = (record: StoredPanel) => new TestPanel(record.id);

        registry.define('test', factory);

        expect(registry.has('test')).toBe(true);
        expect(registry.resolve('test')).toBe(factory);
    });

    it('rejects an empty type', () => {
        const registry = new PanelRegistry();

        expect(() => registry.define('   ', vi.fn())).toThrow(
            'Panel type must not be empty.',
        );
    });

    it('rejects duplicate types', () => {
        const registry = new PanelRegistry();

        registry.define('test', vi.fn());

        expect(() => registry.define('test', vi.fn())).toThrow(
            'Duplicate panel type: "test".',
        );
    });

    it('removes a registered factory', () => {
        const registry = new PanelRegistry();

        registry.define('test', vi.fn());

        expect(registry.delete('test')).toBe(true);
        expect(registry.has('test')).toBe(false);
        expect(registry.delete('test')).toBe(false);
    });
});

describe('PanelManager', () => {
    let client: FakeClient;
    let manager: PanelManager;
    let store: MemoryPanelStore;

    beforeEach(() => {
        client = makeClient();
        store = new MemoryPanelStore();
        manager = new PanelManager(client, { store, autoRestore: false });
    });

    describe('registration', () => {
        it('registers a panel and calls onCreate', async () => {
            const panel = new TestPanel('panel-1');
            const onCreate = vi.spyOn(panel, 'onCreate');

            await manager.register(panel);

            expect(onCreate).toHaveBeenCalledOnce();
            expect(manager.get('panel-1')).toBe(panel);
            expect(manager.size).toBe(1);
        });

        it('rejects a duplicate panel ID', async () => {
            await manager.register(new TestPanel('panel-1'));

            await expect(
                manager.register(new TestPanel('panel-1')),
            ).rejects.toThrow(
                'A panel with ID "panel-1" is already registered.',
            );
        });

        it('removes a panel from the registry when onCreate fails', async () => {
            const panel = new TestPanel('panel-1');

            vi.spyOn(panel, 'onCreate').mockRejectedValue(
                new Error('creation failed'),
            );

            await expect(manager.register(panel)).rejects.toThrow(
                'creation failed',
            );

            expect(manager.get('panel-1')).toBeUndefined();
        });

        it('rejects a blank panel ID', async () => {
            await expect(
                manager.register(new TestPanel('   ')),
            ).rejects.toThrow('Panel ID must not be empty.');
        });

        it('rejects a blank panel type', async () => {
            class BlankTypePanel extends TestPanel {
                public readonly type = '   ';
            }

            await expect(
                manager.register(new BlankTypePanel('panel-1')),
            ).rejects.toThrow('Panel type must not be empty.');
        });

        it('defines panel factories', () => {
            const factory = (record: StoredPanel) => new TestPanel(record.id);

            expect(manager.define('test', factory)).toBe(manager);
            expect(manager.registry.resolve('test')).toBe(factory);
        });
    });

    describe('send', () => {
        it('sends, attaches, persists, and emits panelSent', async () => {
            const message = makeMessage();
            const channel = makeChannel(message);
            const panel = new TestPanel('panel-1', {
                label: 'hello',
                count: 2,
            });
            const onCreate = vi.spyOn(panel, 'onCreate');
            const onSent = vi.fn();

            manager.on('panelSent', onSent);

            const result = await manager.send(panel, channel);

            expect(result).toBe(message);
            expect(channel.send).toHaveBeenCalledWith({
                content: 'hello:2',
            });
            expect(panel.message).toBe(message);
            expect(manager.getByMessageId('message-1')).toBe(panel);
            expect(onCreate).toHaveBeenCalledOnce();
            expect(onSent).toHaveBeenCalledWith(panel, message);

            const records = await store.load();

            expect(records).toEqual([
                {
                    id: 'panel-1',
                    type: 'test',
                    guildId: 'guild-1',
                    channelId: 'channel-1',
                    messageId: 'message-1',
                    data: { label: 'hello', count: 2 },
                },
            ]);
        });

        it('rejects an unsendable channel', async () => {
            const channel = makeChannel(makeMessage(), false);

            await expect(
                manager.send(new TestPanel('panel-1'), channel),
            ).rejects.toThrow('This channel is not sendable.');

            expect(channel.send).not.toHaveBeenCalled();
        });

        it('rejects an already attached panel', async () => {
            const panel = new TestPanel('panel-1');

            await manager.send(panel, makeChannel(makeMessage()));

            await expect(
                manager.send(panel, makeChannel(makeMessage())),
            ).rejects.toThrow('This panel is already attached to a message.');
        });

        it('rejects a different instance reusing a registered ID', async () => {
            await manager.register(new TestPanel('panel-1'));

            await expect(
                manager.send(
                    new TestPanel('panel-1'),
                    makeChannel(makeMessage()),
                ),
            ).rejects.toThrow(
                'A panel with ID "panel-1" is already registered.',
            );
        });

        it('preserves embeds and components from build()', async () => {
            const {
                EmbedBuilder,
                ActionRowBuilder,
                ButtonBuilder,
                ButtonStyle,
            } = await import('discord.js');

            class RichPanel extends TestPanel {
                public build(): PanelContent {
                    return {
                        content: 'rich',
                        embeds: [new EmbedBuilder().setTitle('Title')],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('test')
                                    .setLabel('Test')
                                    .setStyle(ButtonStyle.Primary),
                            ),
                        ],
                    };
                }
            }

            const message = makeMessage();
            const channel = makeChannel(message);

            await manager.send(new RichPanel('panel-1'), channel);

            const payload = channel.send.mock.calls[0]![0];

            expect(payload.content).toBe('rich');
            expect(payload.embeds).toHaveLength(1);
            expect(payload.components).toHaveLength(1);
        });
    });

    describe('attach', () => {
        it('attaches a panel to an existing message and persists it', async () => {
            const panel = new TestPanel('panel-1');
            const message = makeMessage();
            const onCreate = vi.spyOn(panel, 'onCreate');
            const onLoad = vi.spyOn(panel, 'onLoad');

            await manager.attach(panel, message);

            expect(panel.message).toBe(message);
            expect(manager.get('panel-1')).toBe(panel);
            expect(manager.getByMessageId('message-1')).toBe(panel);
            expect(onCreate).toHaveBeenCalledOnce();
            expect(onLoad).not.toHaveBeenCalled();
            expect(await store.load()).toHaveLength(1);
        });

        it('rejects a message already attached to another panel', async () => {
            const message = makeMessage();

            await manager.attach(new TestPanel('panel-1'), message);

            await expect(
                manager.attach(new TestPanel('panel-2'), message),
            ).rejects.toThrow(
                'Message "message-1" is already attached to panel "panel-1".',
            );

            expect(manager.get('panel-2')).toBeUndefined();
        });
    });

    describe('interactions', () => {
        it('routes an interaction to the attached panel and persists state', async () => {
            const panel = new TestPanel('panel-1');
            const message = makeMessage();
            const onInteraction = vi.spyOn(panel, 'onInteraction');

            await manager.attach(panel, message);

            const interaction = makeInteraction(message);

            client.emit('interactionCreate', interaction);

            await vi.waitFor(() => {
                expect(onInteraction).toHaveBeenCalledOnce();
            });

            expect(onInteraction).toHaveBeenCalledWith(interaction);

            await vi.waitFor(async () => {
                const records = await store.load();

                expect(records[0]?.data).toEqual({
                    label: 'initial',
                    count: 1,
                });
            });
        });

        it('ignores interactions for unknown messages', async () => {
            const interaction = makeInteraction(makeMessage());

            client.emit('interactionCreate', interaction);

            await new Promise<void>((resolve) => setImmediate(resolve));

            expect(interaction.reply).not.toHaveBeenCalled();
        });

        it('rejects interactions denied by a custom access filter', async () => {
            const panel = new TestPanel('panel-1');
            const message = makeMessage();
            const filter = vi.fn().mockResolvedValue(false);

            panel.access = { type: 'custom', filter };

            await manager.attach(panel, message);

            const interaction = makeInteraction(message);

            client.emit('interactionCreate', interaction);

            await vi.waitFor(() => {
                expect(interaction.reply).toHaveBeenCalledWith({
                    content: 'You cannot control this panel.',
                    flags: expect.any(Number),
                });
            });

            expect(filter).toHaveBeenCalledWith(interaction, panel);
        });

        it('allows interactions permitted by a custom access filter', async () => {
            const panel = new TestPanel('panel-1');
            const message = makeMessage();

            panel.access = {
                type: 'custom',
                filter: () => true,
            };

            await manager.attach(panel, message);

            const onInteraction = vi.spyOn(panel, 'onInteraction');

            client.emit('interactionCreate', makeInteraction(message));

            await vi.waitFor(() => {
                expect(onInteraction).toHaveBeenCalledOnce();
            });
        });

        it('reports handler failures and replies with an error', async () => {
            const panel = new TestPanel('panel-1');
            const message = makeMessage();
            const error = new Error('handler failed');
            const errorListener = vi.fn();

            vi.spyOn(panel, 'onInteraction').mockRejectedValue(error);

            await manager.attach(panel, message);

            manager.on('panelError', errorListener);

            const interaction = makeInteraction(message);

            client.emit('interactionCreate', interaction);

            await vi.waitFor(() => {
                expect(errorListener).toHaveBeenCalledWith(error, panel);
            });

            expect(interaction.reply).toHaveBeenCalledWith({
                content: 'An error occurred while handling this interaction.',
                flags: expect.any(Number),
            });
        });

        it('does not reply again when the handler already responded', async () => {
            const panel = new TestPanel('panel-1');
            const message = makeMessage();
            const errorListener = vi.fn();

            vi.spyOn(panel, 'onInteraction').mockRejectedValue(
                new Error('handler failed'),
            );

            await manager.attach(panel, message);

            manager.on('panelError', errorListener);

            const interaction = makeInteraction(message, { replied: true });

            client.emit('interactionCreate', interaction);

            await vi.waitFor(() => {
                expect(errorListener).toHaveBeenCalled();
            });

            expect(interaction.reply).not.toHaveBeenCalled();
        });
    });

    describe('refresh', () => {
        it('edits the message using build() and persists the panel', async () => {
            const panel = new TestPanel('panel-1');
            const message = makeMessage();

            await manager.attach(panel, message);

            panel.state = { label: 'refreshed', count: 4 };

            const result = await manager.refresh(panel);

            expect(result).toBe(message);
            expect(message.edit).toHaveBeenCalledWith({
                content: 'refreshed:4',
            });

            await vi.waitFor(async () => {
                const records = await store.load();

                expect(records[0]?.data).toEqual({
                    label: 'refreshed',
                    count: 4,
                });
            });
        });

        it('rejects refreshing an unattached panel', async () => {
            await expect(
                manager.refresh(new TestPanel('panel-1')),
            ).rejects.toThrow('This panel is not attached to a message.');
        });
    });

    describe('save', () => {
        it('persists a tracked panel', async () => {
            const panel = new TestPanel('panel-1');

            await manager.attach(panel, makeMessage());

            panel.state = { label: 'saved', count: 9 };

            await manager.save(panel);

            expect((await store.load())[0]?.data).toEqual({
                label: 'saved',
                count: 9,
            });
        });

        it('rejects saving an untracked panel', async () => {
            await expect(
                manager.save(new TestPanel('panel-1')),
            ).rejects.toThrow('Panel "panel-1" is not registered.');
        });
    });

    describe('unregister', () => {
        it('calls onDestroy and removes the panel and record', async () => {
            const panel = new TestPanel('panel-1');
            const message = makeMessage();
            const onDestroy = vi.spyOn(panel, 'onDestroy');
            const onUnregistered = vi.fn();

            await manager.attach(panel, message);

            manager.on('panelUnregistered', onUnregistered);

            await manager.unregister('panel-1');

            expect(onDestroy).toHaveBeenCalledOnce();
            expect(onUnregistered).toHaveBeenCalledWith(panel);
            expect(manager.get('panel-1')).toBeUndefined();
            expect(manager.getByMessageId('message-1')).toBeUndefined();
            expect(await store.load()).toEqual([]);
        });

        it('does nothing for an unknown panel', async () => {
            await expect(
                manager.unregister('missing'),
            ).resolves.toBeUndefined();
        });

        it('removes a stored record even if the store was not loaded yet', async () => {
            const storedStore = new MemoryPanelStore([makeStoreRecord()]);
            const storedManager = new PanelManager(client, {
                store: storedStore,
                autoRestore: false,
            });

            await storedManager.register(new TestPanel('panel-1'));
            await storedManager.unregister('panel-1');

            expect(await storedStore.load()).toEqual([]);
        });
    });

    describe('delete', () => {
        it('deletes the message and unregisters the panel', async () => {
            const panel = new TestPanel('panel-1');
            const message = makeMessage();

            await manager.attach(panel, message);

            await manager.delete('panel-1');

            expect(message.delete).toHaveBeenCalledOnce();
            expect(manager.get('panel-1')).toBeUndefined();
            expect(await store.load()).toEqual([]);
        });
    });
});

describe('PanelManager restoration', () => {
    function makeRestoreClient(message: Message) {
        const client = makeClient();

        client.channels.fetch.mockResolvedValue(makePanelChannel(message));

        return client;
    }

    it('restores a panel from a stored record and calls onLoad', async () => {
        const message = makeMessage({
            id: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
        });
        const client = makeRestoreClient(message);
        const record = makeStoreRecord({
            data: { label: 'restored', count: 3 },
        });
        const store = new MemoryPanelStore([record]);
        const manager = new PanelManager(client, {
            store,
            autoRestore: false,
        });

        let restoredPanel: TestPanel | undefined;

        manager.define('test', (stored) => {
            restoredPanel = new TestPanel(stored.id, stored.data as TestState);
            vi.spyOn(restoredPanel, 'onLoad');

            return restoredPanel;
        });

        const onRestored = vi.fn();

        manager.on('panelRestored', onRestored);

        await manager.restore();

        expect(restoredPanel).toBeDefined();
        expect(manager.get('panel-1')).toBe(restoredPanel);
        expect(manager.getByMessageId('message-1')).toBe(restoredPanel);
        expect(restoredPanel?.message).toBe(message);
        expect(restoredPanel?.onLoad).toHaveBeenCalledOnce();
        expect(onRestored).toHaveBeenCalledWith(restoredPanel, message);
        expect(client.channels.fetch).toHaveBeenCalledWith('channel-1');
    });

    it('routes interactions for a restored panel', async () => {
        const message = makeMessage();
        const client = makeRestoreClient(message);
        const store = new MemoryPanelStore([
            makeStoreRecord({ data: { label: 'restored', count: 0 } }),
        ]);
        const manager = new PanelManager(client, {
            store,
            autoRestore: false,
        });

        let restoredPanel: TestPanel | undefined;

        manager.define('test', (stored) => {
            restoredPanel = new TestPanel(stored.id, stored.data as TestState);

            return restoredPanel;
        });

        await manager.restore();

        client.emit('interactionCreate', makeInteraction(message));

        await vi.waitFor(() => {
            expect(restoredPanel?.state.count).toBe(1);
        });

        await vi.waitFor(async () => {
            expect((await store.load())[0]?.data).toEqual({
                label: 'restored',
                count: 1,
            });
        });
    });

    it('emits an error when no factory is registered', async () => {
        const client = makeRestoreClient(makeMessage());
        const manager = new PanelManager(client, {
            store: new MemoryPanelStore([makeStoreRecord()]),
            autoRestore: false,
        });
        const errorListener = vi.fn();

        manager.on('panelError', errorListener);

        await manager.restore();

        expect(errorListener).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'No factory is registered for panel type "test".',
            }),
        );
        expect(manager.size).toBe(0);
    });

    it('rejects a factory that returns a mismatched ID', async () => {
        const client = makeRestoreClient(makeMessage());
        const manager = new PanelManager(client, {
            store: new MemoryPanelStore([makeStoreRecord()]),
            autoRestore: false,
        });
        const errorListener = vi.fn();

        manager.define('test', () => new TestPanel('other-id'));
        manager.on('panelError', errorListener);

        await manager.restore();

        expect(errorListener).toHaveBeenCalledWith(
            expect.objectContaining({
                message:
                    'Panel factory for "test" returned panel "other-id", expected "panel-1".',
            }),
        );
        expect(manager.size).toBe(0);
    });

    it('rejects a factory that returns a mismatched type', async () => {
        class OtherPanel extends TestPanel {
            public readonly type = 'other';
        }

        const client = makeRestoreClient(makeMessage());
        const manager = new PanelManager(client, {
            store: new MemoryPanelStore([makeStoreRecord()]),
            autoRestore: false,
        });
        const errorListener = vi.fn();

        manager.define('test', (record) => new OtherPanel(record.id));
        manager.on('panelError', errorListener);

        await manager.restore();

        expect(errorListener).toHaveBeenCalledWith(
            expect.objectContaining({
                message:
                    'Panel "panel-1" returned type "other", expected "test".',
            }),
        );
        expect(manager.size).toBe(0);
    });

    it('removes a record whose message no longer exists', async () => {
        const client = makeClient();

        client.channels.fetch.mockRejectedValue({ code: 10003 });

        const store = new MemoryPanelStore([makeStoreRecord()]);
        const manager = new PanelManager(client, {
            store,
            autoRestore: false,
        });
        const errorListener = vi.fn();

        manager.define('test', (record) => new TestPanel(record.id));
        manager.on('panelError', errorListener);

        await manager.restore();

        expect(manager.size).toBe(0);
        expect(await store.load()).toEqual([]);
        expect(errorListener).toHaveBeenCalledWith(
            expect.objectContaining({
                message:
                    'Panel "panel-1" points to a message that no longer exists.',
            }),
            expect.any(TestPanel),
        );
    });

    it('removes the panel when onLoad fails', async () => {
        const client = makeRestoreClient(makeMessage());
        const manager = new PanelManager(client, {
            store: new MemoryPanelStore([makeStoreRecord()]),
            autoRestore: false,
        });
        const error = new Error('load failed');
        const errorListener = vi.fn();

        manager.define('test', (record) => {
            const panel = new TestPanel(record.id);

            vi.spyOn(panel, 'onLoad').mockRejectedValue(error);

            return panel;
        });
        manager.on('panelError', errorListener);

        await manager.restore();

        expect(manager.size).toBe(0);
        expect(manager.getByMessageId('message-1')).toBeUndefined();
        expect(errorListener).toHaveBeenCalledWith(error);
    });

    it('is idempotent while a restoration is in progress', async () => {
        const client = makeRestoreClient(makeMessage());
        const store = new MemoryPanelStore([makeStoreRecord()]);
        const manager = new PanelManager(client, {
            store,
            autoRestore: false,
        });
        const load = vi.spyOn(store, 'load');

        manager.define('test', (record) => new TestPanel(record.id));

        await Promise.all([manager.restore(), manager.restore()]);

        expect(load).toHaveBeenCalledOnce();
        expect(manager.size).toBe(1);
    });

    it('auto-restores once the client becomes ready', async () => {
        const message = makeMessage();
        const client = makeRestoreClient(message);
        const manager = new PanelManager(client, {
            store: new MemoryPanelStore([
                makeStoreRecord({ data: { label: 'auto', count: 1 } }),
            ]),
        });

        manager.define(
            'test',
            (record) => new TestPanel(record.id, record.data as TestState),
        );

        client.emit('clientReady');

        await vi.waitFor(() => {
            expect(manager.get('panel-1')).toBeDefined();
        });
    });

    it('auto-restores when created for an already ready client', async () => {
        const message = makeMessage();
        const readyClient = makeClient(true);

        readyClient.channels.fetch.mockResolvedValue(makePanelChannel(message));

        const manager = new PanelManager(readyClient, {
            store: new MemoryPanelStore([makeStoreRecord()]),
        });

        manager.define('test', (record) => new TestPanel(record.id));

        await vi.waitFor(() => {
            expect(manager.get('panel-1')).toBeDefined();
        });
    });
});

describe('MemoryPanelStore', () => {
    it('loads and saves records', async () => {
        const store = new MemoryPanelStore();
        const records = [makeStoreRecord()];

        await store.save(records);

        expect(await store.load()).toEqual(records);
    });

    it('accepts initial records', async () => {
        const records = [makeStoreRecord()];
        const store = new MemoryPanelStore(records);

        expect(await store.load()).toEqual(records);
    });
});

describe('JsonFilePanelStore', () => {
    let directory: string;
    let filePath: string;

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'dodo-panels-'));
        filePath = join(directory, 'nested', 'panels.json');
    });

    afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    it('returns an empty list when the file does not exist', async () => {
        const store = new JsonFilePanelStore(filePath);

        expect(await store.load()).toEqual([]);
    });

    it('writes and reads records, creating parent directories', async () => {
        const store = new JsonFilePanelStore(filePath);
        const records = [
            makeStoreRecord({ data: { label: 'json', count: 2 } }),
        ];

        await store.save(records);

        expect(await store.load()).toEqual(records);
    });

    it('returns an empty list for an empty file', async () => {
        const store = new JsonFilePanelStore(filePath);

        await store.save([]);
        await writeFile(filePath, '   ', 'utf8');

        expect(await store.load()).toEqual([]);
    });

    it('rejects malformed JSON', async () => {
        const store = new JsonFilePanelStore(filePath);

        await store.save([]);
        await writeFile(filePath, '{not json', 'utf8');

        await expect(store.load()).rejects.toThrow();
    });

    it('rejects a file that is not an array of records', async () => {
        const store = new JsonFilePanelStore(filePath);

        await store.save([]);
        await writeFile(filePath, JSON.stringify({ panels: [] }), 'utf8');

        await expect(store.load()).rejects.toThrow(
            `Invalid panel store file: "${filePath}".`,
        );
    });

    it('rejects records with missing required fields', async () => {
        const store = new JsonFilePanelStore(filePath);

        await store.save([]);
        await writeFile(
            filePath,
            JSON.stringify([{ id: 'panel-1', type: 'test' }]),
            'utf8',
        );

        await expect(store.load()).rejects.toThrow(
            `Invalid panel store file: "${filePath}".`,
        );
    });
});
