import type {
    APIAllowedMentions,
    APIEmbed,
    APIGuildMember,
    APIInteractionDataResolved,
    APIMessageTopLevelComponent,
    APIUser,
    ApplicationCommandOptionType,
    ComponentType,
    InteractionType,
    MessageFlags,
    Snowflake,
} from 'discord-api-types/v10';

import type { APIInteraction } from 'discord-api-types/v10';

/**
 * Body accepted by {@link Interaction.reply}.
 *
 * The framework owns the response `type`; callers only describe the message
 * contents. Attachments are deliberately not supported yet — see the design
 * document's "File attachments are deferred" note.
 */
export interface MessageResponseBody {
    /** Plain-text content of the message. */
    readonly content?: string;

    /** Embeds attached to the message. */
    readonly embeds?: readonly APIEmbed[];

    /** Component rows attached to the message. */
    readonly components?: readonly APIMessageTopLevelComponent[];

    /** Controls which mentions are allowed to ping. */
    readonly allowed_mentions?: APIAllowedMentions;

    /** Message flags, for example `MessageFlags.Ephemeral`. */
    readonly flags?: MessageFlags;

    /** Whether the message should be read out by text-to-speech. */
    readonly tts?: boolean;
}

/**
 * Body accepted by {@link Interaction.editReply}.
 */
export interface MessageEditBody {
    /** New plain-text content of the message. */
    readonly content?: string | null;

    /** New embeds attached to the message. */
    readonly embeds?: readonly APIEmbed[];

    /** New component rows attached to the message. */
    readonly components?: readonly APIMessageTopLevelComponent[];

    /** Controls which mentions are allowed to ping. */
    readonly allowed_mentions?: APIAllowedMentions;

    /** Message flags, for example `MessageFlags.Ephemeral`. */
    readonly flags?: MessageFlags;
}

/**
 * Body accepted by {@link Interaction.createModal}.
 */
export interface ModalResponseBody {
    /** Routing key of the modal, used to route the submit event back. */
    readonly customId: string;

    /** Title displayed at the top of the modal. */
    readonly title: string;

    /** Component rows displayed inside the modal. */
    readonly components: readonly APIMessageTopLevelComponent[];
}

/**
 * A single autocomplete choice offered back to Discord.
 */
export interface AutocompleteChoice {
    /** Name displayed to the user. */
    readonly name: string;

    /** Value sent back to the bot when the choice is picked. */
    readonly value: string;
}

/**
 * Body accepted by {@link Interaction.createAutocompleteResponse}.
 */
export interface AutocompleteResponseBody {
    /** Choices offered to the user. */
    readonly choices: readonly AutocompleteChoice[];
}

/**
 * A framework view over a raw Discord interaction.
 *
 * The payload is plain data and stays plain data: there is no class
 * hierarchy, no cache, and no lazy guild/channel lookups. Helpers are thin
 * wrappers over the REST facade.
 */
export interface Interaction {
    /** The payload Discord sent. */
    readonly raw: APIInteraction;

    /** ID of the interaction. */
    readonly id: string;

    /** Continuation token used to respond to the interaction. */
    readonly token: string;

    /** ID of the application the interaction targets. */
    readonly applicationId: string;

    /** Type of the interaction. */
    readonly type: InteractionType;

    /** Guild the interaction came from, or `null` in a direct message. */
    readonly guildId: string | null;

    /** Channel the interaction came from, or `null` when unavailable. */
    readonly channelId: string | null;

    /** ID of the user who triggered the interaction. */
    readonly userId: string;

    /** The triggering user, when Discord supplied it. */
    readonly user: APIUser | null;

    /** Guild membership of the triggering user, for guild interactions. */
    readonly member: APIGuildMember | null;

    /** Locale of the triggering user. */
    readonly locale: string | null;

    /** Preferred locale of the guild, for guild interactions. */
    readonly guildLocale: string | null;

    /**
     * Permissions the application has in the interaction's channel.
     *
     * Permission bitfields exceed `Number.MAX_SAFE_INTEGER`, so they are
     * exposed as `bigint`.
     */
    readonly appPermissions: bigint;

    /**
     * Permissions the triggering member has in the interaction's channel.
     *
     * `null` when the interaction did not come from a guild.
     */
    readonly memberPermissions: bigint | null;

    /** Type of the component that triggered the interaction, when applicable. */
    readonly componentType: ComponentType | null;

    /** `custom_id` of the component that triggered the interaction. */
    readonly customId: string | null;

    /** Values selected in a select menu, when applicable. */
    readonly values: readonly string[];

    /** Resolved entities referenced by the interaction, when applicable. */
    readonly resolved: APIInteractionDataResolved | null;

    /** Name of the invoked application command, when applicable. */
    readonly commandName: string | null;

    /** Options supplied to the invoked application command. */
    readonly commandOptions: readonly unknown[];

    /** Type of the focused option during an autocomplete interaction. */
    readonly focusedOption: { name: string; type: ApplicationCommandOptionType; value: string } | null;

    /** Whether this interaction is an application command invocation. */
    isCommand(): boolean;

    /** Whether this interaction is a message component interaction. */
    isComponent(): boolean;

    /** Whether this interaction is a modal submission. */
    isModalSubmit(): boolean;

    /** Whether this interaction is an autocomplete request. */
    isAutocomplete(): boolean;

    /** Replies to the interaction with a new message. */
    reply(body: MessageResponseBody): Promise<void>;

    /** Defers the interaction, showing the "thinking" state. */
    defer(body?: { readonly flags?: MessageFlags }): Promise<void>;

    /** Defers a component update. */
    deferUpdate(): Promise<void>;

    /** Updates the message the component interaction was triggered on. */
    updateMessage(body: MessageEditBody): Promise<void>;

    /** Edits the initial response of the interaction. */
    editReply(body: MessageEditBody): Promise<void>;

    /** Sends a follow-up message. */
    followUp(body: MessageResponseBody): Promise<void>;

    /** Opens a modal in response to the interaction. */
    createModal(body: ModalResponseBody): Promise<void>;

    /** Responds to an autocomplete request. */
    createAutocompleteResponse(body: AutocompleteResponseBody): Promise<void>;
}

/** A snowflake that identifies a Discord entity. */
export type EntityId = Snowflake;
