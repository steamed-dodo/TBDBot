import type { InteractionsAPI } from '@discordjs/core';
import type {
    APIAllowedMentions,
    APIApplicationCommandAutocompleteInteraction,
    APIApplicationCommandInteraction,
    APIEmbed,
    APIInteraction,
    APIInteractionDataResolved,
    APIMessageComponentInteraction,
    APIMessageTopLevelComponent,
    APIModalSubmitInteraction,
    ApplicationCommandOptionType,
    MessageFlags,
} from 'discord-api-types/v10';
import { ComponentType, InteractionType } from 'discord-api-types/v10';

import type {
    AutocompleteResponseBody,
    Interaction,
    MessageEditBody,
    MessageResponseBody,
    ModalResponseBody,
} from './types';

/**
 * Parses a permission bitfield that Discord may send as a string or a number.
 *
 * Discord's v10 API returns permission bitfields as strings, and 64-bit
 * permission values exceed `Number.MAX_SAFE_INTEGER`, so every permission
 * value is normalised to `bigint` here.
 *
 * @param value - The raw permission value.
 * @returns The permission bitfield as a `bigint`.
 */
export function parsePermissions(
    value: string | number | bigint | null | undefined,
): bigint {
    if (value === null || value === undefined) {
        return 0n;
    }

    if (typeof value === 'bigint') {
        return value;
    }

    if (typeof value === 'number') {
        return BigInt(Math.trunc(value));
    }

    const trimmed = value.trim();

    if (trimmed === '') {
        return 0n;
    }

    try {
        return BigInt(trimmed);
    } catch {
        return 0n;
    }
}

function isComponentInteraction(raw: APIInteraction): raw is APIMessageComponentInteraction {
    return raw.type === InteractionType.MessageComponent;
}

function isModalSubmitInteraction(raw: APIInteraction): raw is APIModalSubmitInteraction {
    return raw.type === InteractionType.ModalSubmit;
}

function isCommandInteraction(raw: APIInteraction): raw is APIApplicationCommandInteraction {
    return raw.type === InteractionType.ApplicationCommand;
}

function isAutocompleteInteraction(
    raw: APIInteraction,
): raw is APIApplicationCommandAutocompleteInteraction {
    return raw.type === InteractionType.ApplicationCommandAutocomplete;
}

function hasValues(
    data: { component_type: ComponentType; values?: unknown },
): data is { component_type: ComponentType; values: string[] } {
    return data.component_type !== ComponentType.Button && Array.isArray(data.values);
}

/**
 * Creates a framework {@link Interaction} from a raw Discord payload.
 *
 * @param raw - The payload Discord sent.
 * @param api - The REST facade used to respond to the interaction.
 * @returns A plain-data view over the interaction.
 */
export function createInteraction(raw: APIInteraction, api: InteractionsAPI): Interaction {
    const member = raw.member ?? null;
    const user = raw.user ?? member?.user ?? null;

    const commandData =
        isCommandInteraction(raw) || isAutocompleteInteraction(raw)
            ? (raw.data as {
                  name: string;
                  options?: unknown[];
                  resolved?: APIInteractionDataResolved;
              })
            : undefined;

    const focusedOption = (() => {
        if (!isAutocompleteInteraction(raw)) {
            return null;
        }

        const focused = (
            raw.data as unknown as {
                focused_option?: {
                    name: string;
                    type: ApplicationCommandOptionType;
                    value: string;
                };
            }
        ).focused_option;

        if (!focused) {
            return null;
        }

        return {
            name: focused.name,
            type: focused.type,
            value: focused.value,
        };
    })();

    const resolved = (() => {
        if (isComponentInteraction(raw)) {
            const data = raw.data as {
                resolved?: APIInteractionDataResolved;
            };

            return (data.resolved ?? null) as APIInteractionDataResolved | null;
        }

        if (commandData) {
            return (commandData.resolved ?? null) as APIInteractionDataResolved | null;
        }

        return null;
    })();

    const componentType = isComponentInteraction(raw)
        ? raw.data.component_type
        : null;

    const values = (() => {
        if (isComponentInteraction(raw) && hasValues(raw.data)) {
            return [...raw.data.values];
        }

        return [] as string[];
    })();

    const customId = (() => {
        if (isComponentInteraction(raw)) {
            return raw.data.custom_id;
        }

        if (isModalSubmitInteraction(raw)) {
            return raw.data.custom_id;
        }

        return null;
    })();

    const applicationId = raw.application_id;
    const locale = 'locale' in raw ? (raw.locale ?? null) : null;
    const guildLocale = 'guild_locale' in raw ? (raw.guild_locale ?? null) : null;

    const interaction: Interaction = {
        raw,
        id: raw.id,
        token: raw.token,
        applicationId,
        type: raw.type,
        guildId: raw.guild_id ?? null,
        channelId: raw.channel?.id ?? raw.channel_id ?? null,
        userId: user?.id ?? '',
        user,
        member,
        locale,
        guildLocale,
        appPermissions: parsePermissions(raw.app_permissions),
        memberPermissions: member ? parsePermissions(member.permissions) : null,
        componentType,
        customId,
        values,
        resolved,
        commandName: commandData?.name ?? null,
        commandOptions: commandData?.options ?? [],
        focusedOption,

        isCommand: () => isCommandInteraction(raw),
        isComponent: () => isComponentInteraction(raw),
        isModalSubmit: () => isModalSubmitInteraction(raw),
        isAutocomplete: () => isAutocompleteInteraction(raw),

        async reply(body: MessageResponseBody): Promise<void> {
            await api.reply(interaction.id, interaction.token, toCallbackData(body));
        },

        async defer(body?: { readonly flags?: MessageFlags }): Promise<void> {
            await api.defer(
                interaction.id,
                interaction.token,
                body?.flags === undefined ? {} : { flags: body.flags },
            );
        },

        async deferUpdate(): Promise<void> {
            await api.deferMessageUpdate(interaction.id, interaction.token, {});
        },

        async updateMessage(body: MessageEditBody): Promise<void> {
            await api.updateMessage(
                interaction.id,
                interaction.token,
                toCallbackData(body) as never,
            );
        },

        async editReply(body: MessageEditBody): Promise<void> {
            await api.editReply(
                interaction.applicationId,
                interaction.token,
                toCallbackData(body) as never,
            );
        },

        async followUp(body: MessageResponseBody): Promise<void> {
            await api.followUp(
                interaction.applicationId,
                interaction.token,
                toCallbackData(body) as never,
            );
        },

        async createModal(body: ModalResponseBody): Promise<void> {
            await api.createModal(interaction.id, interaction.token, {
                custom_id: body.customId,
                title: body.title,
                components: [...body.components] as never,
            });
        },

        async createAutocompleteResponse(
            body: AutocompleteResponseBody,
        ): Promise<void> {
            await api.createAutocompleteResponse(
                interaction.id,
                interaction.token,
                {
                    choices: body.choices.map((choice) => ({
                        name: choice.name,
                        value: choice.value,
                    })),
                },
            );
        },
    };

    return interaction;
}

interface CallbackData {
    content?: string;
    embeds?: APIEmbed[];
    components?: APIMessageTopLevelComponent[];
    allowed_mentions?: APIAllowedMentions;
    flags?: MessageFlags;
    tts?: boolean;
}

function toCallbackData(body: MessageResponseBody | MessageEditBody): CallbackData {
    const result: CallbackData = {};

    if (body.content !== undefined && body.content !== null) {
        result.content = body.content;
    }

    if (body.embeds !== undefined) {
        result.embeds = [...body.embeds];
    }

    if (body.components !== undefined) {
        result.components = [...body.components];
    }

    if (body.allowed_mentions !== undefined) {
        result.allowed_mentions = body.allowed_mentions;
    }

    if (body.flags !== undefined) {
        result.flags = body.flags;
    }

    if ('tts' in body && body.tts !== undefined) {
        result.tts = body.tts;
    }

    return result;
}
