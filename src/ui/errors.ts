/**
 * Thrown when a widget tries to update a message that can no longer be
 * edited.
 *
 * An ephemeral message lives on the interaction webhook, and the interaction
 * token that addresses it is valid for fifteen minutes. After that the
 * message cannot be edited by the framework or by anyone else, so the
 * framework fails loudly instead of making a doomed request.
 *
 * The remedy is to deliver the message to a channel: a channel message is
 * addressed by channel and message ID and can be edited for as long as the
 * message exists.
 */
export class MessageExpiredError extends Error {
    /**
     * @param expiresAt - The moment the message stopped being editable.
     */
    constructor(public readonly expiresAt: number) {
        super(
            `The message expired at ${new Date(expiresAt).toISOString()} and can no longer be edited. ` +
                'Ephemeral messages can only be edited for 15 minutes after the interaction that created them; ' +
                'send the message to a channel instead.',
        );

        this.name = 'MessageExpiredError';
    }
}
