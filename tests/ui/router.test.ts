import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Interaction } from '../../src/interaction/types';
import { createInteraction } from '../../src/interaction/interaction';
import { MockTransport } from '../../src/testing/mock';
import {
    createComponentInteraction,
    createSelectInteraction,
} from '../../src/testing/factories';
import { WidgetRouter } from '../../src/ui/router';
import type { ActionContext, Widget } from '../../src/ui/types';

function createApi(transport: MockTransport): API {
    const rest = new REST({ makeRequest: transport.makeRequest });

    rest.setToken('test-token');

    return new API(rest);
}

interface TestWidget extends Widget {
    readonly actions: string[];
    readonly navigation: string[];
}

function createWidget(routingId: string): TestWidget {
    const actions: string[] = [];
    const navigation: string[] = [];

    return {
        id: routingId,
        routingId,
        state: undefined,
        actions,
        navigation,
        render: () => ({ content: 'hello' }),
        onAction(action: string) {
            actions.push(action);
        },
        onNavigation(action: string) {
            navigation.push(action);
        },
    };
}

describe('widget router', () => {
    let transport: MockTransport;
    let api: API;
    let router: WidgetRouter;

    const asInteraction = (
        raw: Parameters<typeof createInteraction>[0],
    ): Interaction => createInteraction(raw, api.interactions);

    beforeEach(() => {
        transport = new MockTransport();
        api = createApi(transport);
        router = new WidgetRouter(api);
    });

    it('dispatches a user action to the widget', async () => {
        const widget = createWidget('abc123');
        await router.register(widget);

        const handled = await router.handle(
            asInteraction(createComponentInteraction('ui:abc123:confirm')),
        );

        expect(handled).toBe(true);
        expect(widget.actions).toEqual(['confirm']);
        expect(widget.navigation).toEqual([]);
    });

    it('dispatches reserved actions to the navigation handler', async () => {
        const widget = createWidget('abc123');
        await router.register(widget);

        await router.handle(
            asInteraction(createComponentInteraction('ui:abc123:~next')),
        );

        expect(widget.navigation).toEqual(['next']);
        expect(widget.actions).toEqual([]);
    });

    it('ignores interactions that do not belong to the namespace', async () => {
        const widget = createWidget('abc123');
        await router.register(widget);

        const handled = await router.handle(
            asInteraction(createComponentInteraction('other:abc123:confirm')),
        );

        expect(handled).toBe(false);
    });

    it('ignores custom ids that are not framework minted', async () => {
        const widget = createWidget('abc123');
        await router.register(widget);

        const handled = await router.handle(
            asInteraction(createComponentInteraction('confirm')),
        );

        expect(handled).toBe(false);
    });

    it('passes the selected values to the action context', async () => {
        const widget = createWidget('abc123');
        let received: ActionContext | undefined;

        await router.register({
            ...widget,
            onAction(_action, context) {
                received = context;
            },
        });

        await router.handle(
            asInteraction(
                createSelectInteraction('ui:abc123:pick', ['one', 'two']),
            ),
        );

        expect(received?.values).toEqual(['one', 'two']);
        expect(received?.rawCustomId).toBe('ui:abc123:pick');
    });

    describe('cold start queue', () => {
        it('queues interactions for an expected widget', async () => {
            router.expect('abc123');

            const handled = await router.handle(
                asInteraction(createComponentInteraction('ui:abc123:confirm')),
            );

            expect(handled).toBe(true);
            expect(router.pendingCount).toBe(1);
        });

        it('defers queued interactions immediately', async () => {
            router.expect('abc123');

            await router.handle(
                asInteraction(createComponentInteraction('ui:abc123:confirm')),
            );

            expect(transport.requests).toHaveLength(1);
            expect(transport.requests[0]?.url).toContain(
                '/interactions/123456789012345678/test-token/callback',
            );
        });

        it('drains the queue when the widget is registered', async () => {
            router.expect('abc123');

            await router.handle(
                asInteraction(createComponentInteraction('ui:abc123:confirm')),
            );

            const widget = createWidget('abc123');
            await router.register(widget);

            expect(widget.actions).toEqual(['confirm']);
            expect(router.pendingCount).toBe(0);
        });

        it('drops the oldest interaction when the per-widget limit is reached', async () => {
            const bounded = new WidgetRouter(api, {
                maxQueuedPerWidget: 2,
            });

            bounded.expect('abc123');

            await bounded.handle(
                asInteraction(createComponentInteraction('ui:abc123:first')),
            );
            await bounded.handle(
                asInteraction(createComponentInteraction('ui:abc123:second')),
            );
            await bounded.handle(
                asInteraction(createComponentInteraction('ui:abc123:third')),
            );

            expect(bounded.pendingCount).toBe(2);

            const widget = createWidget('abc123');
            await bounded.register(widget);

            expect(widget.actions).toEqual(['second', 'third']);
        });

        it('drops the oldest interaction when the overall limit is reached', async () => {
            const bounded = new WidgetRouter(api, {
                maxQueuedTotal: 1,
            });

            bounded.expect('aaa');
            bounded.expect('bbb');

            await bounded.handle(
                asInteraction(createComponentInteraction('ui:aaa:one')),
            );
            await bounded.handle(
                asInteraction(createComponentInteraction('ui:bbb:two')),
            );

            expect(bounded.pendingCount).toBe(1);
        });

        it('fails the queued interactions when the widget cannot be restored', async () => {
            router.expect('abc123');

            await router.handle(
                asInteraction(createComponentInteraction('ui:abc123:confirm')),
            );

            await router.failQueued('abc123', 'Gone.');

            expect(router.pendingCount).toBe(0);
            expect(
                transport.requests.some((request) =>
                    request.url.includes('/webhooks/'),
                ),
            ).toBe(true);
        });

        it('discards interactions that expired while queued', async () => {
            const bounded = new WidgetRouter(api, {
                queueTtl: -1,
            });

            bounded.expect('abc123');

            await bounded.handle(
                asInteraction(createComponentInteraction('ui:abc123:confirm')),
            );

            const widget = createWidget('abc123');
            await bounded.register(widget);

            expect(widget.actions).toEqual([]);
        });
    });

    describe('refresh', () => {
        it('re-renders a widget and edits its message', async () => {
            const widget = createWidget('abc123');

            await router.register(widget, {
                kind: 'channel',
                channelId: 'channel-1',
                messageId: 'message-1',
            });

            await router.refresh('abc123');

            const edit = transport.requests.find((request) =>
                request.url.includes('/channels/channel-1/messages/message-1'),
            );

            expect(edit).toBeDefined();
            expect(edit?.method).toBe('PATCH');
        });

        it('does nothing when the widget has no message', async () => {
            const widget = createWidget('abc123');
            await router.register(widget);

            await router.refresh('abc123');

            expect(transport.requests).toHaveLength(0);
        });
    });
});
