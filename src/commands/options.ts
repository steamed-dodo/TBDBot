import {
    ApplicationCommandOptionType,
    ChannelType,
    ComponentType,
} from 'discord-api-types/v10';
import type {
    APIApplicationCommandInteractionDataOption,
    APIApplicationCommandInteractionDataSubcommandGroupOption,
    APIApplicationCommandInteractionDataSubcommandOption,
    APIApplicationCommandOptionChoice,
    APIInteractionDataResolved,
} from 'discord-api-types/v10';

import type { Interaction } from '../interaction/types';

/**
 * A leaf option of an interaction.
 *
 * Subcommands and subcommand groups are excluded: they hold nested options
 * rather than values.
 */
export type CommandDataOption = Exclude<
    APIApplicationCommandInteractionDataOption,
    | APIApplicationCommandInteractionDataSubcommandGroupOption
    | APIApplicationCommandInteractionDataSubcommandOption
>;

/**
 * A discord.js-style typed accessor over the options of an interaction.
 *
 * The resolver is created per interaction and is cheap: it holds the raw
 * options array and performs linear lookups by name. No schema lookup is
 * needed at runtime — the type check is against the runtime option's own
 * `type` field, which is what makes the mismatch check meaningful.
 */
export class CommandOptionResolver {
    /** Resolved entities referenced by the interaction. */
    public readonly resolved: APIInteractionDataResolved;

    private readonly rawOptions: readonly APIApplicationCommandInteractionDataOption[];

    private readonly interaction: Interaction;

    private readonly leafOptions: readonly CommandDataOption[];

    private readonly subcommandName: string | null;

    private readonly subcommandGroupName: string | null;

    private readonly focused: CommandDataOption | undefined;

    /**
     * @param interaction - The interaction whose options are resolved.
     */
    constructor(interaction: Interaction) {
        this.interaction = interaction;
        this.resolved = interaction.resolved ?? {};

        const raw = (interaction.raw as {
            data?: { options?: APIApplicationCommandInteractionDataOption[] };
        }).data?.options ?? [];

        this.rawOptions = raw;

        let group:
            | APIApplicationCommandInteractionDataSubcommandGroupOption
            | undefined;
        let subcommand:
            | APIApplicationCommandInteractionDataSubcommandOption
            | undefined;

        for (const option of raw) {
            if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
                group = option;
                break;
            }

            if (option.type === ApplicationCommandOptionType.Subcommand) {
                subcommand = option;
                break;
            }
        }

        this.subcommandGroupName = group?.name ?? null;

        if (group) {
            subcommand = group.options?.find(
                (option) =>
                    option.type === ApplicationCommandOptionType.Subcommand,
            );
        }

        this.subcommandName = subcommand?.name ?? null;
        this.leafOptions = (subcommand?.options ??
            raw) as readonly CommandDataOption[];
        this.focused = this.findFocused();
    }

    /**
     * Reads a string option.
     *
     * @param name - Name of the option.
     * @param required - Whether the option must be present.
     * @returns The value, or `null` when the option is absent.
     */
    public getString(name: string, required = false): string | null {
        const option = this.getOption(name, ApplicationCommandOptionType.String);

        if (!option) {
            return this.missing(name, required);
        }

        return option.value as string;
    }

    /**
     * Reads an integer option.
     *
     * @param name - Name of the option.
     * @param required - Whether the option must be present.
     * @returns The value, or `null` when the option is absent.
     */
    public getInteger(name: string, required = false): number | null {
        const option = this.getOption(name, ApplicationCommandOptionType.Integer);

        if (!option) {
            return this.missing(name, required);
        }

        return option.value as number;
    }

    /**
     * Reads a number option.
     *
     * @param name - Name of the option.
     * @param required - Whether the option must be present.
     * @returns The value, or `null` when the option is absent.
     */
    public getNumber(name: string, required = false): number | null {
        const option = this.getOption(name, ApplicationCommandOptionType.Number);

        if (!option) {
            return this.missing(name, required);
        }

        return option.value as number;
    }

    /**
     * Reads a boolean option.
     *
     * @param name - Name of the option.
     * @param required - Whether the option must be present.
     * @returns The value, or `null` when the option is absent.
     */
    public getBoolean(name: string, required = false): boolean | null {
        const option = this.getOption(name, ApplicationCommandOptionType.Boolean);

        if (!option) {
            return this.missing(name, required);
        }

        return option.value as boolean;
    }

    /**
     * Reads a user option.
     *
     * @param name - Name of the option.
     * @param required - Whether the option must be present.
     * @returns The user ID, or `null` when the option is absent.
     */
    public getUser(name: string, required = false): string | null {
        const option = this.getOption(name, ApplicationCommandOptionType.User);

        if (!option) {
            return this.missing(name, required);
        }

        return option.value as string;
    }

    /**
     * Reads a member option.
     *
     * @param name - Name of the option.
     * @returns The member ID, or `null` when the option is absent.
     */
    public getMember(name: string): string | null {
        const option = this.getOption(name, ApplicationCommandOptionType.User);

        return option ? (option.value as string) : null;
    }

    /**
     * Reads a role option.
     *
     * @param name - Name of the option.
     * @param required - Whether the option must be present.
     * @returns The role ID, or `null` when the option is absent.
     */
    public getRole(name: string, required = false): string | null {
        const option = this.getOption(name, ApplicationCommandOptionType.Role);

        if (!option) {
            return this.missing(name, required);
        }

        return option.value as string;
    }

    /**
     * Reads a channel option.
     *
     * @param name - Name of the option.
     * @param required - Whether the option must be present.
     * @param channelTypes - Channel types the option accepts.
     * @returns The channel ID, or `null` when the option is absent.
     */
    public getChannel(
        name: string,
        required = false,
        channelTypes?: readonly ChannelType[],
    ): string | null {
        const option = this.getOption(name, ApplicationCommandOptionType.Channel);

        if (!option) {
            return this.missing(name, required);
        }

        const value = option.value as string;

        if (channelTypes && channelTypes.length > 0) {
            const resolved = this.resolved.channels?.[value];

            if (
                resolved &&
                !channelTypes.includes(resolved.type as ChannelType)
            ) {
                throw new TypeError(
                    `Option "${name}" must be one of ${channelTypes.join(', ')}.`,
                );
            }
        }

        return value;
    }

    /**
     * Reads a mentionable option.
     *
     * @param name - Name of the option.
     * @param required - Whether the option must be present.
     * @returns The mentionable ID, or `null` when the option is absent.
     */
    public getMentionable(name: string, required = false): string | null {
        const option = this.getOption(
            name,
            ApplicationCommandOptionType.Mentionable,
        );

        if (!option) {
            return this.missing(name, required);
        }

        return option.value as string;
    }

    /**
     * Reads an attachment option.
     *
     * @param name - Name of the option.
     * @param required - Whether the option must be present.
     * @returns The attachment ID, or `null` when the option is absent.
     */
    public getAttachment(name: string, required = false): string | null {
        const option = this.getOption(
            name,
            ApplicationCommandOptionType.Attachment,
        );

        if (!option) {
            return this.missing(name, required);
        }

        return option.value as string;
    }

    /**
     * Reads the name of the invoked subcommand.
     *
     * @param required - Whether the subcommand must be present.
     * @returns The subcommand name, or `null` when there is none.
     */
    public getSubcommand(required = false): string | null {
        if (this.subcommandName === null && required) {
            throw new Error('No subcommand was used.');
        }

        return this.subcommandName;
    }

    /**
     * Reads the name of the invoked subcommand group.
     *
     * @param required - Whether the group must be present.
     * @returns The group name, or `null` when there is none.
     */
    public getSubcommandGroup(required = false): string | null {
        if (this.subcommandGroupName === null && required) {
            throw new Error('No subcommand group was used.');
        }

        return this.subcommandGroupName;
    }

    /**
     * Reads the focused option of an autocomplete interaction.
     *
     * @param getFull - Whether the full choice object is returned.
     * @returns The focused value, or `null` when nothing is focused.
     */
    public getFocused(
        getFull = false,
    ): string | APIApplicationCommandOptionChoice | null {
        if (!this.focused) {
            return null;
        }

        if (!getFull) {
            return (this.focused as { value: string }).value;
        }

        const focused = this.focused as {
            value: string;
            options?: APIApplicationCommandOptionChoice[];
        };

        const choice = focused.options?.find(
            (option) => option.value === focused.value,
        );

        return choice ?? focused.value;
    }

    /**
     * The raw options of the interaction.
     */
    public get options(): readonly APIApplicationCommandInteractionDataOption[] {
        return this.rawOptions;
    }

    /**
     * The options of the leaf subcommand, with subcommands hoisted away.
     */
    public get leaf(): readonly CommandDataOption[] {
        return this.leafOptions;
    }

    private findFocused(): CommandDataOption | undefined {
        const data = (
            this.interaction.raw as {
                data?: {
                    focused_option?: CommandDataOption;
                };
            }
        ).data;

        if (data?.focused_option) {
            return data.focused_option;
        }

        for (const option of this.leafOptions) {
            const candidate = option as unknown as { focused?: boolean };

            if (candidate.focused) {
                return option;
            }
        }

        return undefined;
    }

    private getOption(
        name: string,
        type: ApplicationCommandOptionType,
    ): CommandDataOption | undefined {
        const option = this.leafOptions.find(
            (candidate) => candidate.name === name,
        );

        if (!option) {
            return undefined;
        }

        if (option.type !== type) {
            throw new TypeError(
                `Option "${name}" is of type ${option.type}, not ${type}.`,
            );
        }

        return option;
    }

    private missing(name: string, required: boolean): null {
        if (required) {
            throw new Error(`Required option "${name}" is missing.`);
        }

        return null;
    }
}

/**
 * The component type used by select menus, re-exported for convenience.
 */
export const SELECT_COMPONENT_TYPE = ComponentType.StringSelect;
