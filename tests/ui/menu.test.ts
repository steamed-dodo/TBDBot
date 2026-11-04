import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createInteraction } from '../../src/interaction/interaction';
import { MockTransport } from '../../src/testing/mock';
import { createComponentInteraction } from '../../src/testing/factories';
import { Menu } from '../../src/ui/menu/Menu';
import { Wizard } from '../../src/ui/menu/Wizard';
import { WidgetRouter } from '../../src/ui/router';
import type { FlowState, Step } from '../../src/ui/menu/types';

function createApi(transport: MockTransport): API {
    const rest = new REST({ makeRequest: transport.makeRequest });

    rest.setToken('test-token');

    return new API(rest);
}

const linearSteps: readonly Step[] = [
    {
        id: 'one',
        render: () => ({ content: 'first' }),
    },
    {
        id: 'two',
        render: () => ({ content: 'second' }),
    },
    {
        id: 'three',
        render: () => ({ content: 'third' }),
    },
];

describe('menu', () => {
    let transport: MockTransport;
    let api: API;
    let router: WidgetRouter;

    const state = (): FlowState =>
        router.stateOf<FlowState>('menu123') as FlowState;

    beforeEach(() => {
        transport = new MockTransport();
        transport.on('/channels/', {
            body: { id: 'message-1', channel_id: 'channel-1' },
        });
        api = createApi(transport);
        router = new WidgetRouter(api);
    });

    it('requires at least one step', () => {
        expect(() => new Menu({ api, steps: [] })).toThrow(TypeError);
    });

    it('rejects duplicate step ids', () => {
        expect(
            () =>
                new Menu({
                    api,
                    steps: [
                        { id: 'a', render: () => ({}) },
                        { id: 'a', render: () => ({}) },
                    ],
                }),
        ).toThrow(TypeError);
    });

    it('rejects an unknown first step', () => {
        expect(
            () =>
                new Menu({
                    api,
                    steps: linearSteps,
                    firstStep: 'missing',
                }),
        ).toThrow(TypeError);
    });

    it('renders the active step', async () => {
        const menu = new Menu({
            api,
            steps: linearSteps,
            routingId: 'menu123',
        });

        const content = await menu.render(menu.initialState());

        expect(content.content).toBe('first');
    });

    it('renders the navigation chrome with reserved actions', async () => {
        const menu = new Menu({
            api,
            steps: linearSteps,
            routingId: 'menu123',
        });

        const content = await menu.render(menu.initialState());
        const row = content.components?.[0];

        expect(row?.[0]?.action).toBe('~previous');
        expect(row?.[1]?.action).toBe('~next');
    });

    it('disables the previous button on the first step', async () => {
        const menu = new Menu({
            api,
            steps: linearSteps,
            routingId: 'menu123',
        });

        const content = await menu.render(menu.initialState());
        const row = content.components?.[0];

        expect(row?.[0]?.disabled).toBe(true);
        expect(row?.[1]?.disabled).toBe(false);
    });

    it('advances to the next step', async () => {
        const menu = new Menu({
            api,
            steps: linearSteps,
            routingId: 'menu123',
            access: { type: 'everyone' },
        });

        await router.register(menu, null, menu.initialState());

        await router.handle(
            createInteraction(
                createComponentInteraction('ui:menu123:~next'),
                api.interactions,
            ),
        );

        expect(state().currentStepId).toBe('two');
    });

    it('goes back to the previous step', async () => {
        const menu = new Menu({
            api,
            steps: linearSteps,
            routingId: 'menu123',
            access: { type: 'everyone' },
        });

        await router.register(menu, null, menu.initialState());

        await router.handle(
            createInteraction(
                createComponentInteraction('ui:menu123:~next'),
                api.interactions,
            ),
        );

        await router.handle(
            createInteraction(
                createComponentInteraction('ui:menu123:~previous'),
                api.interactions,
            ),
        );

        expect(state().currentStepId).toBe('one');
    });

    it('sends the menu and registers it with the router', async () => {
        const menu = new Menu({
            api,
            steps: linearSteps,
            routingId: 'menu123',
        });

        const messageId = await menu.send('channel-1', router);

        expect(messageId).toBe('message-1');
        expect(router.get('menu123')).toBeDefined();
        expect(menu.messageTarget).toEqual({
            kind: 'channel',
            channelId: 'channel-1',
            messageId: 'message-1',
        });
        expect(menu.messageId).toBe('message-1');
        expect(menu.channelId).toBe('channel-1');
    });

    it('denies users that are not the owner', async () => {
        const menu = new Menu({
            api,
            steps: linearSteps,
            routingId: 'menu123',
            userId: 'owner-1',
            access: { type: 'caller-only' },
        });

        await router.register(menu, null, menu.initialState());

        await router.handle(
            createInteraction(
                createComponentInteraction('ui:menu123:~next', {
                    userId: 'someone-else',
                }),
                api.interactions,
            ),
        );

        expect(state().currentStepId).toBe('one');
        expect(
            transport.requests.some((request) =>
                request.url.includes('/callback'),
            ),
        ).toBe(true);
    });
});

describe('wizard', () => {
    let transport: MockTransport;
    let api: API;
    let router: WidgetRouter;

    const wizardSteps: readonly Step[] = [
        {
            id: 'language',
            render: () => ({ content: 'pick a language' }),
            choices: [
                { value: 'ts', label: 'TypeScript' },
                { value: 'js', label: 'JavaScript' },
            ],
            next: 'framework',
        },
        {
            id: 'framework',
            render: () => ({ content: 'pick a framework' }),
            choices: [{ value: 'discord', label: 'discord.js' }],
        },
    ];

    const state = (): FlowState =>
        router.stateOf<FlowState>('wiz123') as FlowState;

    beforeEach(() => {
        transport = new MockTransport();
        api = createApi(transport);
        router = new WidgetRouter(api);
    });

    it('renders a back button', async () => {
        const wizard = new Wizard({
            api,
            steps: wizardSteps,
            routingId: 'wiz123',
        });

        const content = await wizard.render(wizard.initialState());
        const row = content.components?.[content.components.length - 1];

        expect(row?.[0]?.action).toBe('~back');
    });

    it('records the answer of the selected choice', async () => {
        const wizard = new Wizard({
            api,
            steps: wizardSteps,
            routingId: 'wiz123',
            access: { type: 'everyone' },
        });

        await router.register(wizard, null, wizard.initialState());

        await router.handle(
            createInteraction(
                createComponentInteraction('ui:wiz123:~choice:ts'),
                api.interactions,
            ),
        );

        expect(state().answers).toEqual({ language: 'ts' });
        expect(state().currentStepId).toBe('framework');
    });

    it('completes the wizard when the last choice is picked', async () => {
        const wizard = new Wizard({
            api,
            steps: wizardSteps,
            routingId: 'wiz123',
            access: { type: 'everyone' },
        });

        await router.register(wizard, null, wizard.initialState());

        await router.handle(
            createInteraction(
                createComponentInteraction('ui:wiz123:~choice:ts'),
                api.interactions,
            ),
        );

        await router.handle(
            createInteraction(
                createComponentInteraction('ui:wiz123:~choice:discord'),
                api.interactions,
            ),
        );

        expect(state().completed).toBe(true);
    });

    it('clears abandoned answers when going back', async () => {
        const wizard = new Wizard({
            api,
            steps: wizardSteps,
            routingId: 'wiz123',
            access: { type: 'everyone' },
        });

        await router.register(wizard, null, wizard.initialState());

        await router.handle(
            createInteraction(
                createComponentInteraction('ui:wiz123:~choice:ts'),
                api.interactions,
            ),
        );

        expect(state().answers).toEqual({ language: 'ts' });

        await router.handle(
            createInteraction(
                createComponentInteraction('ui:wiz123:~back'),
                api.interactions,
            ),
        );

        expect(state().currentStepId).toBe('language');
        expect(state().answers).toEqual({});
    });

    it('calls the completion handler', async () => {
        let completed = false;

        const wizard = new Wizard({
            api,
            steps: wizardSteps,
            routingId: 'wiz123',
            access: { type: 'everyone' },
            onComplete: () => {
                completed = true;
            },
        });

        await router.register(wizard, null, wizard.initialState());

        await router.handle(
            createInteraction(
                createComponentInteraction('ui:wiz123:~choice:ts'),
                api.interactions,
            ),
        );

        await router.handle(
            createInteraction(
                createComponentInteraction('ui:wiz123:~choice:discord'),
                api.interactions,
            ),
        );

        expect(completed).toBe(true);
    });
});
