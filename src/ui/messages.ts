import type { API } from '@discordjs/core';
import type { APIMessage } from 'discord-api-types/v10';

import type { RenderedMessage } from './render';

/**
 * Where a widget's message lives.
 *
 * The distinction matters: an ephemeral message is not addressable by
 * channel and message ID, so it has to be edited through the interaction
 * webhook instead.
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
          /** The message is an ephemeral interaction response. */
          readonly kind: 'ephemeral';

          /** ID of the application that owns the interaction. */
          readonly applicationId: string;

          /** Continuation token of the interaction. */
          readonly token: string;

          /** ID of the interaction that created the message. */
          readonly interactionId: string;
      };

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
 */
export async function editTarget(
    api: API,
    target: MessageTarget,
    message: RenderedMessage,
): Promise<void> {
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
 */
export async function deleteTarget(
    api: API,
    target: MessageTarget,
): Promise<void> {
    if (target.kind === 'channel') {
        await api.channels.deleteMessage(target.channelId, target.messageId);

        return;
    }

    await api.interactions.deleteReply(target.applicationId, target.token);
}
