import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createInteraction } from '../../src/interaction/interaction';
import { MockTransport } from '../../src/testing/mock';
import {
    createComponentInteraction,
    createModalSubmitInteraction,
} from '../../src/testing/factories';
import { Modal } from '../../src/ui/modal/Modal';
import { WidgetRouter } from '../../src/ui/router';

function createApi(transport: MockTransport): API {
    const rest = new REST({ makeRequest: transport.makeRequest });

    rest.setToken('test-token');

    return new API(rest);
}

describe('modal', () => {
    let transport: MockTransport;
    let api: API;
    let router: WidgetRouter;

    beforeEach(() => {
        transport = new MockTransport();
        api = createApi(transport);
        router = new WidgetRouter(api);
    });

    it('requires at least one field', () => {
        expect(() => new Modal({ api, title: 'T', fields: [] })).toThrow(
            TypeError,
        );
    });

    it('mints a custom id that the router can parse', () => {
        const modal = new Modal({
            api,
            title: 'Feedback',
            fields: [{ id: 'message', label: 'Message' }],
            routingId: 'modal123',
        });

        expect(modal.customId).toBe('ui:modal123:submit');
    });

    it('opens a modal with the configured fields', async () => {
        const modal = new Modal({
            api,
            title: 'Feedback',
            fields: [
                { id: 'message', label: 'Message' },
                { id: 'rating', label: 'Rating' },
            ],
            routingId: 'modal123',
        });

        const interaction = createInteraction(
            createComponentInteraction('ui:modal123:~open'),
            api.interactions,
        );

        await modal.open(interaction, router);

        const request = transport.requests.at(-1);

        expect(request?.url).toContain('/callback');
        expect(request?.body).toMatchObject({
            type: 9,
            data: {
                custom_id: 'ui:modal123:submit',
                title: 'Feedback',
            },
        });
    });

    it('extracts the submitted values', async () => {
        const modal = new Modal({
            api,
            title: 'Feedback',
            fields: [{ id: 'message', label: 'Message' }],
            routingId: 'modal123',
        });

        await router.register(modal);

        await router.handle(
            createInteraction(
                createModalSubmitInteraction('ui:modal123:submit', {
                    message: 'hello there',
                }),
                api.interactions,
            ),
        );

        expect(modal.submittedValues).toEqual({ message: 'hello there' });
        expect(modal.state.submitted).toBe(true);
    });
});
