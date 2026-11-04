import type {
    APIApplicationCommandInteraction,
    APIChannel,
    APIGuild,
    APIGuildMember,
    APIInteraction,
    APIInteractionGuildMember,
    APIMessage,
    APIRole,
    APIUser,
    ApplicationCommandOptionType,
    ComponentType,
    InteractionType,
} from 'discord-api-types/v10';
import { ComponentType as ComponentTypes, InteractionType as InteractionTypes } from 'discord-api-types/v10';

/** A snowflake used by the payload builders. */
export const TEST_ID = '123456789012345678';

/** A second snowflake used by the payload builders. */
export const TEST_ID_2 = '987654321098765432';

/**
 * Builds a user payload.
 *
 * @param overrides - Values overriding the defaults.
 * @returns The user payload.
 */
export function createUser(overrides: Partial<APIUser> = {}): APIUser {
    return {
        id: TEST_ID,
        username: 'tester',
        discriminator: '0',
        global_name: null,
        avatar: null,
        ...overrides,
    } as APIUser;
}

/**
 * Builds a guild payload.
 *
 * @param overrides - Values overriding the defaults.
 * @returns The guild payload.
 */
export function createGuild(overrides: Partial<APIGuild> = {}): APIGuild {
    return {
        id: TEST_ID,
        name: 'Test Guild',
        icon: null,
        owner_id: TEST_ID,
        permissions: '8',
        ...overrides,
    } as APIGuild;
}

/**
 * Builds a guild member payload.
 *
 * @param overrides - Values overriding the defaults.
 * @returns The member payload.
 */
export function createMember(
    overrides: Partial<APIGuildMember> = {},
): APIGuildMember {
    return {
        user: createUser(),
        roles: [],
        joined_at: new Date(0).toISOString(),
        deaf: false,
        mute: false,
        flags: 0,
        ...overrides,
    } as APIGuildMember;
}

/**
 * Builds a role payload.
 *
 * @param overrides - Values overriding the defaults.
 * @returns The role payload.
 */
export function createRole(overrides: Partial<APIRole> = {}): APIRole {
    return {
        id: TEST_ID,
        name: '@everyone',
        color: 0,
        colors: {
            primary_color: 0,
            secondary_color: null,
            tertiary_color: null,
        },
        hoist: false,
        position: 0,
        permissions: '8',
        managed: false,
        mentionable: false,
        flags: 0,
        ...overrides,
    } as APIRole;
}

/**
 * Builds a channel payload.
 *
 * @param overrides - Values overriding the defaults.
 * @returns The channel payload.
 */
export function createChannel(
    overrides: Partial<APIChannel> = {},
): APIChannel {
    return {
        id: TEST_ID,
        type: 0,
        guild_id: TEST_ID,
        name: 'test-channel',
        position: 0,
        permission_overwrites: [],
        ...overrides,
    } as APIChannel;
}

/**
 * Builds a message payload.
 *
 * @param overrides - Values overriding the defaults.
 * @returns The message payload.
 */
export function createMessage(overrides: Partial<APIMessage> = {}): APIMessage {
    return {
        id: TEST_ID,
        channel_id: TEST_ID,
        guild_id: TEST_ID,
        author: createUser(),
        content: '',
        timestamp: new Date(0).toISOString(),
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        mention_roles: [],
        attachments: [],
        embeds: [],
        reactions: [],
        pinned: false,
        type: 0,
        ...overrides,
    } as APIMessage;
}

/**
 * Options accepted by the interaction factories.
 */
export interface InteractionFactoryOptions {
    /** ID of the interaction. */
    readonly id?: string;

    /** Continuation token of the interaction. */
    readonly token?: string;

    /** ID of the application. */
    readonly applicationId?: string;

    /** ID of the guild. */
    readonly guildId?: string | null;

    /** ID of the channel. */
    readonly channelId?: string | null;

    /** ID of the user. */
    readonly userId?: string;

    /** The user payload. */
    readonly user?: APIUser;

    /** The member payload. */
    readonly member?: APIGuildMember;

    /** Permissions of the application in the channel. */
    readonly appPermissions?: string;

    /** Permissions of the member in the channel. */
    readonly memberPermissions?: string;
}

function baseInteraction(
    type: InteractionType,
    options: InteractionFactoryOptions,
): Record<string, unknown> {
    const guildId = options.guildId === undefined ? TEST_ID : options.guildId;
    const user = options.user ?? createUser({ id: options.userId ?? TEST_ID });

    const base: Record<string, unknown> = {
        id: options.id ?? TEST_ID,
        application_id: options.applicationId ?? TEST_ID_2,
        type,
        token: options.token ?? 'test-token',
        version: 1,
        locale: 'en-US',
        app_permissions: options.appPermissions ?? '8',
        entitlements: [],
        authorizing_integration_owners: {},
        attachment_size_limit: 8_388_608,
        user,
    };

    if (guildId) {
        base['guild_id'] = guildId;
        base['member'] = {
            ...(options.member ?? createMember({ user })),
            permissions: options.memberPermissions ?? '8',
        };
    }

    base['channel'] = {
        id: options.channelId ?? TEST_ID,
        type: 0,
    };

    return base;
}

/**
 * Builds a message component interaction payload.
 *
 * @param customId - The `custom_id` of the component.
 * @param options - Additional factory options.
 * @returns The interaction payload.
 */
export function createComponentInteraction(
    customId: string,
    options: InteractionFactoryOptions & {
        readonly componentType?: ComponentType;
        readonly values?: readonly string[];
    } = {},
): APIInteraction {
    const componentType = options.componentType ?? ComponentTypes.Button;

    const data =
        componentType === ComponentTypes.Button
            ? { custom_id: customId, component_type: componentType }
            : {
                  custom_id: customId,
                  component_type: componentType,
                  values: [...(options.values ?? [])],
              };

    return {
        ...baseInteraction(InteractionTypes.MessageComponent, options),
        data,
        message: createMessage(),
    } as unknown as APIInteraction;
}

/**
 * Builds a string select interaction payload.
 *
 * @param customId - The `custom_id` of the select menu.
 * @param values - The selected values.
 * @param options - Additional factory options.
 * @returns The interaction payload.
 */
export function createSelectInteraction(
    customId: string,
    values: readonly string[] = [],
    options: InteractionFactoryOptions = {},
): APIInteraction {
    return createComponentInteraction(customId, {
        ...options,
        componentType: ComponentTypes.StringSelect,
        values,
    });
}

/**
 * Builds an application command interaction payload.
 *
 * @param name - Name of the invoked command.
 * @param options - Additional factory options.
 * @returns The interaction payload.
 */
export function createCommandInteraction(
    name: string,
    options: InteractionFactoryOptions & {
        readonly options?: readonly {
            readonly name: string;
            readonly type: ApplicationCommandOptionType;
            readonly value: unknown;
        }[];
    } = {},
): APIInteraction {
    const payload = {
        ...baseInteraction(InteractionTypes.ApplicationCommand, options),
        data: {
            id: TEST_ID,
            name,
            type: 1,
            ...(options.options ? { options: options.options } : {}),
        },
    };

    return payload as unknown as APIInteraction;
}

/**
 * Builds a modal submission interaction payload.
 *
 * @param customId - The `custom_id` of the modal.
 * @param values - The submitted values, keyed by field ID.
 * @param options - Additional factory options.
 * @returns The interaction payload.
 */
export function createModalSubmitInteraction(
    customId: string,
    values: Readonly<Record<string, string>> = {},
    options: InteractionFactoryOptions = {},
): APIInteraction {
    const components = Object.entries(values).map(([id, value]) => ({
        type: 1,
        components: [
            {
                type: 4,
                custom_id: id,
                value,
            },
        ],
    }));

    const payload = {
        ...baseInteraction(InteractionTypes.ModalSubmit, options),
        data: {
            custom_id: customId,
            components,
        },
    };

    return payload as unknown as APIInteraction;
}

/**
 * Builds a guild member as it appears in an interaction payload.
 *
 * @param overrides - Values overriding the defaults.
 * @returns The member payload.
 */
export function createInteractionMember(
    overrides: Partial<APIInteractionGuildMember> = {},
): APIInteractionGuildMember {
    return {
        ...createMember(),
        permissions: '8',
        ...overrides,
    } as APIInteractionGuildMember;
}

/**
 * Builds an application command interaction payload with a chat input.
 *
 * @param name - Name of the invoked command.
 * @param options - Additional factory options.
 * @returns The interaction payload.
 */
export function createChatInputInteraction(
    name: string,
    options: InteractionFactoryOptions & {
        readonly options?: readonly {
            readonly name: string;
            readonly type: ApplicationCommandOptionType;
            readonly value: unknown;
        }[];
    } = {},
): APIApplicationCommandInteraction {
    return createCommandInteraction(
        name,
        options,
    ) as APIApplicationCommandInteraction;
}
