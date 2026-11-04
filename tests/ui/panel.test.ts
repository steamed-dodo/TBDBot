import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryPanelStore } from '../../src/ui/panel/PanelStore';
import { PanelManager } from '../../src/ui/panel/PanelManager';
import { Menu } from '../../src/ui/menu/Menu';
import type { FlowState } from '../../src/ui/menu/types';
import { Panel } from '../../src/ui/panel/Panel';
import { WidgetRouter } from '../../src/ui/router';
import { MockTransport } from '../../src/testing/mock';
import { createComponentInteraction } from '../../src/testing/factories';
import { createInteraction } from '../../src/interaction/interaction';

class TestPanel extends Panel<{ count: number }> {
    public readonly type = 'test';

    public readonly received: string[] = [];

    public build() {
        return { content: `panel ${this.id}` };
    }

    public onAction(action: string): void {
        this.received.push(action);
    }

    public serialize() {
        return { count: this.received.length };
    }
}

function createApi(transport: MockTransport): API {
    const rest = new REST({ makeRequest: transport.makeRequest });

    rest.setToken('test-token');

    return new API(rest);
}

describe('panel manager', () => {
    let transport: MockTransport;
    let api: API;
    let router: WidgetRouter;
    let store: MemoryPanelStore;

    beforeEach(() => {
        transport = new MockTransport();
        transport.on('/channels/', {
            body: { id: 'message-1', channel_id: 'channel-1' },
        });
        api = createApi(transport);
        router = new WidgetRouter(api);
        store = new MemoryPanelStore();
    });

    it('attaches a panel and persists its record', async () => {
        const manager = new PanelManager({ api, router, store });
        const panel = new TestPanel('panel-1', 'route123');

        const messageId = await manager.attach(panel, 'channel-1', 'guild-1');

        expect(messageId).toBe('message-1');
        expect(panel.messageId).toBe('message-1');
        expect(panel.channelId).toBe('channel-1');

        const records = await store.load();

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            id: 'panel-1',
            type: 'test',
            routingId: 'route123',
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'message-1',
        });
    });

    it('registers the panel with the router', async () => {
        const manager = new PanelManager({ api, router, store });
        const panel = new TestPanel('panel-1', 'route123');

        await manager.attach(panel, 'channel-1');

        expect(router.get('route123')).toBe(panel);
    });

    it('restores panels and re-registers their custom ids', async () => {
        const manager = new PanelManager({ api, router, store });

        manager.define(
            'test',
            (record) => new TestPanel(record.id, record.routingId),
        );

        await store.save([
            {
                id: 'panel-1',
                type: 'test',
                routingId: 'route123',
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'message-1',
            },
        ]);

        await manager.start();

        const panel = manager.get('panel-1');

        expect(panel).toBeDefined();
        expect(panel?.messageId).toBe('message-1');
        expect(router.get('route123')).toBe(panel);
    });

    it('routes interactions to a restored panel', async () => {
        const manager = new PanelManager({ api, router, store });
        const received: string[] = [];

        manager.define('test', (record) => {
            const panel = new TestPanel(record.id, record.routingId);

            panel.onAction = (action: string) => {
                received.push(action);
            };

            return panel;
        });

        await store.save([
            {
                id: 'panel-1',
                type: 'test',
                routingId: 'route123',
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'message-1',
            },
        ]);

        await manager.start();

        await router.handle(
            createInteraction(
                createComponentInteraction('ui:route123:refresh'),
                api.interactions,
            ),
        );

        expect(received).toEqual(['refresh']);
    });

    it('fails the queued interactions when the panel type is unknown', async () => {
        const manager = new PanelManager({ api, router, store });

        router.expect('route123');

        await store.save([
            {
                id: 'panel-1',
                type: 'unknown',
                routingId: 'route123',
                guildId: null,
                channelId: 'channel-1',
                messageId: 'message-1',
            },
        ]);

        await manager.start();

        expect(router.pendingCount).toBe(0);
        expect(manager.get('panel-1')).toBeUndefined();
    });

    it('removes a panel and forgets its record', async () => {
        const manager = new PanelManager({ api, router, store });
        const panel = new TestPanel('panel-1', 'route123');

        await manager.attach(panel, 'channel-1');
        await manager.remove(panel, { deleteMessage: true });

        expect(manager.get('panel-1')).toBeUndefined();
        expect(router.get('route123')).toBeUndefined();
        expect(await store.load()).toHaveLength(0);
    });

    it('persists and restores a menu', async () => {
        const manager = new PanelManager({ api, router, store });
        const steps = [
            { id: 'one', render: () => ({ content: 'first' }) },
            { id: 'two', render: () => ({ content: 'second' }) },
        ];

        const menu = new Menu({
            api,
            steps,
            routingId: 'menu123',
            type: 'menu',
            access: { type: 'everyone' },
        });

        manager.define('menu', (record) => {
            const restored = new Menu({
                api,
                steps,
                routingId: record.routingId,
                type: record.type,
            });

            restored.restore(record.data);

            return restored as never;
        });

        await manager.attach(menu as never, 'channel-1', 'guild-1');

        await router.update('menu123', {
            ...menu.initialState(),
            currentStepId: 'two',
            history: ['one', 'two'],
        });

        await manager.refresh(menu as never);

        const records = await store.load();

        expect(records[0]?.type).toBe('menu');
        expect(records[0]?.routingId).toBe('menu123');
        expect(records[0]?.data).toMatchObject({ currentStepId: 'two' });

        const restoredManager = new PanelManager({ api, router, store });

        restoredManager.define('menu', (record) => {
            const restored = new Menu({
                api,
                steps,
                routingId: record.routingId,
                type: record.type,
            });

            restored.restore(record.data);

            return restored as never;
        });

        await restoredManager.start();

        const restored = restoredManager.get(menu.id) as unknown as Menu;

        expect(restored).toBeDefined();
        expect(router.stateOf<FlowState>('menu123')?.currentStepId).toBe('two');
        expect(router.get('menu123')).toBe(restored);
    });
});
