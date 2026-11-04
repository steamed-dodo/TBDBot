import { GatewayDispatchEvents } from 'discord-api-types/v10';
import { describe, expect, it } from 'vitest';

import { createMockClient } from '../../src/testing/client';
import {
    CACHE_INVALIDATION_EVENTS,
    TIER_ONE_EVENTS,
} from '../../src/core/EventRouter';

describe('framework client', () => {
    it('translates the ready dispatch into a typed event', async () => {
        const mock = createMockClient();

        const ready = new Promise<{ applicationId: string }>((resolve) => {
            mock.client.on('ready', (info) => resolve(info));
        });

        mock.dispatch(GatewayDispatchEvents.Ready, {
            v: 10,
            user: { id: 'bot-1' },
            guilds: [],
            session_id: 'session-1',
            resume_gateway_url: 'wss://gateway.discord.gg',
            application: { id: 'app-1', flags: 0 },
        });

        const info = await ready;

        expect(info.applicationId).toBe('app-1');
        expect(mock.client.application).toBe('app-1');
        expect(mock.client.ready).toBe(true);
    });

    it('translates a message dispatch into a typed event', async () => {
        const mock = createMockClient();

        const message = new Promise<{ messageId: string }>((resolve) => {
            mock.client.on('messageCreate', (event) => resolve(event));
        });

        mock.dispatch(GatewayDispatchEvents.MessageCreate, {
            id: 'message-1',
            channel_id: 'channel-1',
            guild_id: 'guild-1',
            content: 'hello',
        });

        const event = await message;

        expect(event.messageId).toBe('message-1');
        expect(event.channelId).toBe('channel-1');
        expect(event.guildId).toBe('guild-1');
    });

    it('translates a guild role dispatch into a typed event', async () => {
        const mock = createMockClient();

        const role = new Promise<{ roleId: string }>((resolve) => {
            mock.client.on('guildRoleUpdate', (event) => resolve(event));
        });

        mock.dispatch(GatewayDispatchEvents.GuildRoleUpdate, {
            guild_id: 'guild-1',
            role: { id: 'role-1', name: 'Role' },
        });

        const event = await role;

        expect(event.roleId).toBe('role-1');
        expect(event.guildId).toBe('guild-1');
    });

    it('creates a framework interaction for an interaction dispatch', async () => {
        const mock = createMockClient();

        const interaction = new Promise<{ commandName: string | null }>(
            (resolve) => {
                mock.client.on('interactionCreate', (event) => resolve(event));
            },
        );

        mock.dispatch(GatewayDispatchEvents.InteractionCreate, {
            id: 'interaction-1',
            application_id: 'app-1',
            type: 2,
            token: 'token',
            version: 1,
            locale: 'en-US',
            app_permissions: '8',
            entitlements: [],
            authorizing_integration_owners: {},
            attachment_size_limit: 1,
            channel_id: 'channel-1',
            guild_id: 'guild-1',
            member: {
                user: { id: 'user-1', username: 'tester', discriminator: '0' },
                roles: [],
                joined_at: new Date(0).toISOString(),
                permissions: '8',
            },
            data: { id: 'cmd-1', name: 'ping', type: 1 },
        });

        const event = await interaction;

        expect(event.commandName).toBe('ping');
        expect(event.userId).toBe('user-1');
        expect(event.guildId).toBe('guild-1');
    });

    it('dispatches interactions to the registered handlers', async () => {
        const mock = createMockClient();

        const handled: string[] = [];

        mock.client.handleInteractions((interaction) => {
            handled.push(interaction.customId ?? '');

            return true;
        });

        mock.client.dispatchInteraction(
            mock.createInteraction({
                id: 'interaction-1',
                application_id: 'app-1',
                type: 3,
                token: 'token',
                version: 1,
                locale: 'en-US',
                app_permissions: '8',
                entitlements: [],
                authorizing_integration_owners: {},
                attachment_size_limit: 1,
                channel_id: 'channel-1',
                guild_id: 'guild-1',
                user: { id: 'user-1', username: 'tester', discriminator: '0' },
                member: {
                    user: {
                        id: 'user-1',
                        username: 'tester',
                        discriminator: '0',
                    },
                    roles: [],
                    joined_at: new Date(0).toISOString(),
                    permissions: '8',
                },
                data: {
                    custom_id: 'ui:abc:confirm',
                    component_type: 2,
                },
                message: { id: 'message-1', channel_id: 'channel-1' },
            } as never),
        );

        expect(handled).toEqual(['ui:abc:confirm']);
    });

    it('stops accepting interactions once it is destroyed', async () => {
        const mock = createMockClient();

        const handled: string[] = [];

        mock.client.handleInteractions((interaction) => {
            handled.push(interaction.customId ?? '');

            return true;
        });

        await mock.client.destroy();

        await mock.client.dispatchInteraction(
            mock.createInteraction({
                id: 'interaction-1',
                application_id: 'app-1',
                type: 3,
                token: 'token',
                version: 1,
                locale: 'en-US',
                app_permissions: '8',
                entitlements: [],
                authorizing_integration_owners: {},
                attachment_size_limit: 1,
                channel_id: 'channel-1',
                user: { id: 'user-1', username: 'tester', discriminator: '0' },
                data: { custom_id: 'ui:abc:confirm', component_type: 2 },
                message: { id: 'message-1', channel_id: 'channel-1' },
            } as never),
        );

        expect(handled).toEqual([]);
    });

    it('runs the shutdown tasks in reverse order', async () => {
        const mock = createMockClient();
        const order: string[] = [];

        mock.client.onShutdown(() => {
            order.push('first');
        });

        mock.client.onShutdown(() => {
            order.push('second');
        });

        await mock.client.destroy();

        expect(order).toEqual(['second', 'first']);
        expect(mock.gateway.destroyed).toBe(true);
    });

    it('connects the gateway', async () => {
        const mock = createMockClient();

        await mock.client.connect();

        expect(mock.gateway.connected).toBe(true);
        expect(mock.client.connected).toBe(true);
    });

    describe('event router tiers', () => {
        it('re-emits an untyped dispatch under its raw name', async () => {
            const mock = createMockClient();

            const raw = new Promise<unknown>((resolve) => {
                mock.client.on(
                    GatewayDispatchEvents.ApplicationCommandPermissionsUpdate,
                    (payload: unknown) => resolve(payload),
                );
            });

            mock.dispatch(
                GatewayDispatchEvents.ApplicationCommandPermissionsUpdate,
                { id: 'command-1', permissions: [] },
            );

            await expect(raw).resolves.toMatchObject({ id: 'command-1' });
        });

        it('types every event the cache invalidation depends on', () => {
            for (const event of CACHE_INVALIDATION_EVENTS) {
                expect(TIER_ONE_EVENTS).toContain(event);
            }
        });
    });
});
