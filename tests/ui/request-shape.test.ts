import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createInteraction } from '../../src/interaction/interaction';
import { MockTransport } from '../../src/testing/mock';
import {
    createComponentInteraction,
    createSelectInteraction,
} from '../../src/testing/factories';
import { createCustomId } from '../../src/ui/ids';
import { WidgetRouter } from '../../src/ui/router';
import { Menu } from '../../src/ui/menu/Menu';
import type { Step } from '../../src/ui/menu/types';

/**
 * These tests assert on the *shape* of the request the framework makes, not
 * merely on the fact that a request happened.
 *
 * The specific trap they guard against is the ephemeral edit path: editing
 * an ephemeral message must go to the webhook path, and editing a channel
 * message must go to the channel path. A test that only checks "an edit
 * happened" passes either way, and the mistake is invisible until
 * production.
 */
describe('request shape', () => {
    let transport: MockTransport;
    let api: API;
    let router: WidgetRouter;

    const steps: readonly Step[] = [
        { id: 'one', render: () => ({ content: 'first' }) },
        { id: 'two', render: () => ({ content: 'second' }) },
    ];

    const interaction = (customId: string, values: string[] = []) =>
        createInteraction(
            values.length > 0
                ? createSelectInteraction(customId, values)
                : createComponentInteraction(customId),
            api.interactions,
        );

    beforeEach(() => {
        transport = new MockTransport();
        transport.on('/channels/', {
            body: { id: 'message-1', channel_id: 'channel-1' },
        });

        const rest = new REST({ makeRequest: transport.makeRequest });

        rest.setToken('test-token');

        api = new API(rest);
        router = new WidgetRouter(api);
    });

    it('delivers an ephemeral message through the interaction callback', async () => {
        const menu = new Menu({
            api,
            steps,
            routingId: 'menu123',
            access: { type: 'everyone' },
        });

        await menu.reply(interaction('ui:menu123:~open'), {}, router);

        const request = transport.requests.at(-1);

        expect(request?.method).toBe('POST');
        expect(request?.route).toBe(
            '/interactions/{interaction_id}/{interaction_token}/callback',
        );
        expect(request?.body).toMatchObject({
            type: 4,
            data: { flags: 64 },
        });
    });

    it('delivers a channel message through the channel path', async () => {
        const menu = new Menu({
            api,
            steps,
            routingId: 'menu123',
            access: { type: 'everyone' },
        });

        await menu.send('channel-1', router);

        const request = transport.requests.at(-1);

        expect(request?.method).toBe('POST');
        expect(request?.route).toBe('/channels/{channel_id}/messages');
    });

    it('updates an ephemeral message through the webhook path', async () => {
        const menu = new Menu({
            api,
            steps,
            routingId: 'menu123',
            access: { type: 'everyone' },
        });

        await menu.reply(interaction('ui:menu123:~open'), {}, router);

        transport.requests.length = 0;

        await router.handle(interaction('ui:menu123:~next'));

        const edit = transport.requests.find(
            (request) => request.method === 'PATCH',
        );

        expect(edit?.route).toBe(
            '/webhooks/{application_id}/{interaction_token}/messages/{message_id}',
        );
        expect(
            transport.requests.some((request) =>
                request.route.startsWith('/channels/'),
            ),
        ).toBe(false);
    });

    it('updates a channel message through the channel path', async () => {
        const menu = new Menu({
            api,
            steps,
            routingId: 'menu123',
            access: { type: 'everyone' },
        });

        await menu.send('channel-1', router);

        transport.requests.length = 0;

        await router.handle(interaction('ui:menu123:~next'));

        const edit = transport.requests.find(
            (request) => request.method === 'PATCH',
        );

        expect(edit?.route).toBe(
            '/channels/{channel_id}/messages/{message_id}',
        );
        expect(
            transport.requests.some((request) =>
                request.route.startsWith('/webhooks/'),
            ),
        ).toBe(false);
    });

    it('defers a reply with the deferred message response type', async () => {
        await interaction('ui:menu123:~open').defer();

        const request = transport.requests.at(-1);

        expect(request?.route).toBe(
            '/interactions/{interaction_id}/{interaction_token}/callback',
        );
        expect(request?.body).toMatchObject({ type: 5 });
    });

    it('defers a component update with the deferred message update type', async () => {
        await interaction('ui:menu123:~next').deferUpdate();

        const request = transport.requests.at(-1);

        expect(request?.route).toBe(
            '/interactions/{interaction_id}/{interaction_token}/callback',
        );
        expect(request?.body).toMatchObject({ type: 6 });
    });

    it('updates a component message with the update message response type', async () => {
        await interaction('ui:menu123:~next').updateMessage({
            content: 'updated',
        });

        const request = transport.requests.at(-1);

        expect(request?.route).toBe(
            '/interactions/{interaction_id}/{interaction_token}/callback',
        );
        expect(request?.body).toMatchObject({ type: 7 });
    });

    it('deletes an ephemeral message through the webhook path', async () => {
        const { deleteTarget } = await import('../../src/ui/messages');

        await deleteTarget(api, {
            kind: 'interaction',
            applicationId: 'app-1',
            token: 'token-1',
            interactionId: 'interaction-1',
            expiresAt: Date.now() + 60_000,
        });

        const request = transport.requests.at(-1);

        expect(request?.method).toBe('DELETE');
        expect(request?.route).toBe(
            '/webhooks/{application_id}/{interaction_token}/messages/{message_id}',
        );
        expect(decodeURIComponent(request?.url ?? '')).toContain(
            '/webhooks/app-1/token-1/messages/@original',
        );
    });

    it('defers a queued interaction before it waits for the widget', async () => {
        router.expect('menu123');

        await router.handle(interaction('ui:menu123:~next'));

        const request = transport.requests.at(-1);

        expect(request?.route).toBe(
            '/interactions/{interaction_id}/{interaction_token}/callback',
        );
        expect(request?.body).toMatchObject({ type: 5 });
        expect(router.pendingCount).toBe(1);
    });

    it('never generates a custom id longer than 100 characters', () => {
        expect(() => createCustomId('ui', 'menu123', 'a'.repeat(100))).toThrow(
            RangeError,
        );

        const customId = createCustomId('ui', 'menu123', 'a'.repeat(80));

        expect(customId.length).toBeLessThanOrEqual(100);
    });
});
