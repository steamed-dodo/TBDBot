import type { API } from '@discordjs/core';
import type { APIMessage } from 'discord-api-types/v10';

import { INTERACTION_TOKEN_TTL } from '../interaction/types';
import { MessageExpiredError } from './errors';
import type { RenderedMessage } from './render';

export { INTERACTION_TOKEN_TTL };

/**
 * Where a widget's message lives.
 *
 * The distinction matters: an ephemeral message is not addressable by
 * channel and message ID, so it has to be edited through the interaction
 * webhook instead — and it can only be edited for as long as the
 * interaction token is valid.
 */
export type MessageTarget =
    | {
          /** The message is a regular channel message. */
          readonly kind: 'channel';

          /** Channel containing the message. */
          readonly channelId: string;

          /** ID of the message. */
          readonly messageId: string;
      }
    | {
          /**
           * The message is the original response of an interaction.
           *
           * Interaction responses are not addressable by channel and message
           * ID, so they are edited through the interaction webhook instead.
           */
          readonly kind: 'interaction';

          /** ID of the application that owns the interaction. */
          readonly applicationId: string;

          /** Continuation token of the interaction. */
          readonly token: string;

          /** ID of the interaction that created the message. */
          readonly interactionId: string;

          /**
           * The moment the message stops being editable.
           *
           * A message delivered as an interaction response cannot be edited
           * once the interaction token has expired.
           */
          readonly expiresAt: number;
      };

/**
 * Checks that a target can still be edited.
 *
 * @param target - The target to check.
 * @throws {MessageExpiredError} When the message can no longer be edited.
 */
export function assertNotExpired(target: MessageTarget): void {
    if (target.kind !== 'interaction') {
        return;
    }

    if (Date.now() < target.expiresAt) {
        return;
    }

    throw new MessageExpiredError(target.expiresAt);
}

/**
 * Sends a message to a channel.
 *
 * @param api - The REST facade.
 * @param channelId - Channel to send the message to.
 * @param message - The message payload.
 * @returns The created message.
 */
export function sendChannelMessage(
    api: API,
    channelId: string,
    message: RenderedMessage,
): Promise<APIMessage> {
    return api.channels.createMessage(channelId, message as never);
}

/**
 * Edits the message behind a target.
 *
 * @param api - The REST facade.
 * @param target - The message to edit.
 * @param message - The new message payload.
 * @throws {MessageExpiredError} When the message can no longer be edited.
 */
export async function editTarget(
    api: API,
    target: MessageTarget,
    message: RenderedMessage,
): Promise<void> {
    assertNotExpired(target);

    if (target.kind === 'channel') {
        await api.channels.editMessage(
            target.channelId,
            target.messageId,
            message as never,
        );

        return;
    }

    await api.interactions.editReply(
        target.applicationId,
        target.token,
        message as never,
    );
}

/**
 * Deletes the message behind a target.
 *
 * Ephemeral messages cannot be deleted through the channel endpoint; they
 * are removed through the interaction webhook.
 *
 * @param api - The REST facade.
 * @param target - The message to delete.
 * @throws {MessageExpiredError} When the message can no longer be edited.
 */
export async function deleteTarget(
    api: API,
    target: MessageTarget,
): Promise<void> {
    assertNotExpired(target);

    if (target.kind === 'channel') {
        await api.channels.deleteMessage(target.channelId, target.messageId);

        return;
    }

    await api.interactions.deleteReply(target.applicationId, target.token);
}
