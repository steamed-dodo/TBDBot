import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { beforeEach, describe, expect, it } from 'vitest';

import { MessageExpiredError } from '../../src/ui/errors';
import {
    INTERACTION_TOKEN_TTL,
    deleteTarget,
    editTarget,
} from '../../src/ui/messages';
import type { MessageTarget } from '../../src/ui/messages';
import { MockTransport } from '../../src/testing/mock';

function createApi(transport: MockTransport): API {
    const rest = new REST({ makeRequest: transport.makeRequest });

    rest.setToken('test-token');

    return new API(rest);
}

const channelTarget: MessageTarget = {
    kind: 'channel',
    channelId: 'channel-1',
    messageId: 'message-1',
};

function interactionTarget(expiresAt: number): MessageTarget {
    return {
        kind: 'interaction',
        applicationId: 'app-1',
        token: 'token-1',
        interactionId: 'interaction-1',
        expiresAt,
    };
}

describe('message targets', () => {
    let transport: MockTransport;
    let api: API;

    beforeEach(() => {
        transport = new MockTransport();
        api = createApi(transport);
    });

    it('edits a channel message through the channel path', async () => {
        await editTarget(api, channelTarget, { content: 'hello' });

        const request = transport.requests.at(-1);

        expect(request?.method).toBe('PATCH');
        expect(request?.route).toBe(
            '/channels/{channel_id}/messages/{message_id}',
        );
        expect(request?.url).toContain(
            '/channels/channel-1/messages/message-1',
        );
    });

    it('edits an interaction response through the webhook path', async () => {
        await editTarget(
            api,
            interactionTarget(Date.now() + INTERACTION_TOKEN_TTL),
            { content: 'hello' },
        );

        const request = transport.requests.at(-1);

        expect(request?.method).toBe('PATCH');
        expect(request?.route).toBe(
            '/webhooks/{application_id}/{interaction_token}/messages/{message_id}',
        );
        expect(decodeURIComponent(request?.url ?? '')).toContain(
            '/webhooks/app-1/token-1/messages/@original',
        );
    });

    it('refuses to edit an expired ephemeral message', async () => {
        await expect(
            editTarget(api, interactionTarget(Date.now() - 1), {
                content: 'hello',
            }),
        ).rejects.toThrow(MessageExpiredError);

        expect(transport.requests).toHaveLength(0);
    });

    it('refuses to delete an expired ephemeral message', async () => {
        await expect(
            deleteTarget(api, interactionTarget(Date.now() - 1)),
        ).rejects.toThrow(MessageExpiredError);

        expect(transport.requests).toHaveLength(0);
    });

    it('explains what to do when a message has expired', async () => {
        const error = new MessageExpiredError(Date.now() - 1);

        expect(error.message).toContain('15 minutes');
        expect(error.message).toContain('send the message to a channel');
        expect(error.name).toBe('MessageExpiredError');
    });

    it('never expires a channel message', async () => {
        await editTarget(api, channelTarget, { content: 'hello' });

        expect(transport.requests).toHaveLength(1);
    });
});
