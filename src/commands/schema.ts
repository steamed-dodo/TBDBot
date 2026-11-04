import type { SlashCommandBuilder } from '@discordjs/builders';
import {
    ApplicationCommandOptionType,
    ChannelType,
} from 'discord-api-types/v10';
import type {
    APIApplicationCommandOption,
    APIApplicationCommandOptionChoice,
} from 'discord-api-types/v10';

/**
 * The type of an application command option.
 */
export type CommandOptionType = APIApplicationCommandOption['type'];

/**
 * A choice declared by an option.
 */
export interface OptionChoiceSchema {
    /** Name displayed to the user. */
    readonly name: string;

    /** Value stored when the choice is picked. */
    readonly value: string | number;
}

/**
 * The derived schema of a single command option.
 */
export interface OptionSchema {
    /** Name of the option. */
    readonly name: string;

    /** Type of the option. */
    readonly type: CommandOptionType;

    /** Description of the option. */
    readonly description: string;

    /** Whether the option must be supplied. */
    readonly required: boolean;

    /** Choices declared by the option, when it has any. */
    readonly choices?: readonly OptionChoiceSchema[];

    /** Minimum numeric value accepted. */
    readonly minValue?: number;

    /** Maximum numeric value accepted. */
    readonly maxValue?: number;

    /** Minimum length accepted. */
    readonly minLength?: number;

    /** Maximum length accepted. */
    readonly maxLength?: number;

    /** Channel types accepted by the option. */
    readonly channelTypes?: readonly ChannelType[];

    /** Whether the option supports autocomplete. */
    readonly autocomplete: boolean;

    /** Options nested inside a subcommand or subcommand group. */
    readonly options?: readonly OptionSchema[];
}

/**
 * The derived schema of a command.
 */
export interface CommandSchema {
    /** Name of the command. */
    readonly name: string;

    /** Description of the command. */
    readonly description: string;

    /** Options declared by the command. */
    readonly options: readonly OptionSchema[];
}

/**
 * Derives the schema of a command from its builder.
 *
 * The builder retains the full declaration of every option, so the schema
 * can be derived without the framework maintaining a parallel description
 * of the command.
 *
 * @param builder - The command builder.
 * @returns The derived schema.
 */
export function deriveSchemaFromBuilder(
    builder: SlashCommandBuilder,
): CommandSchema {
    const options = builder.options as unknown as readonly APIApplicationCommandOption[];

    return {
        name: builder.name,
        description: builder.description,
        options: options.map(deriveOptionSchema),
    };
}

/**
 * Derives the schema of a command from raw command JSON.
 *
 * @param command - The raw command JSON.
 * @returns The derived schema.
 */
export function deriveSchemaFromCommand(
    command: {
        readonly name: string;
        readonly description: string;
        readonly options?: readonly APIApplicationCommandOption[];
    },
): CommandSchema {
    return {
        name: command.name,
        description: command.description,
        options: (command.options ?? []).map(deriveOptionSchema),
    };
}

function deriveOptionSchema(
    option: APIApplicationCommandOption,
): OptionSchema {
    const base = {
        name: option.name,
        type: option.type,
        description: option.description ?? '',
        required: option.required ?? false,
        autocomplete: 'autocomplete' in option ? (option.autocomplete ?? false) : false,
    };

    const choices = 'choices' in option ? option.choices : undefined;

    return {
        ...base,
        ...(choices && choices.length > 0
            ? {
                  choices: choices.map((choice) => ({
                      name: choice.name,
                      value: choice.value,
                  })),
              }
            : {}),
        ...('min_value' in option && option.min_value !== undefined
            ? { minValue: option.min_value }
            : {}),
        ...('max_value' in option && option.max_value !== undefined
            ? { maxValue: option.max_value }
            : {}),
        ...('min_length' in option && option.min_length !== undefined
            ? { minLength: option.min_length }
            : {}),
        ...('max_length' in option && option.max_length !== undefined
            ? { maxLength: option.max_length }
            : {}),
        ...('channel_types' in option && option.channel_types !== undefined
            ? { channelTypes: option.channel_types }
            : {}),
        ...('options' in option && option.options
            ? { options: option.options.map(deriveOptionSchema) }
            : {}),
    };
}

/**
 * Finds an option in a schema by name.
 *
 * @param schema - The schema to search.
 * @param name - Name of the option.
 * @returns The option schema, or `undefined` when it does not exist.
 */
export function findOptionSchema(
    schema: CommandSchema,
    name: string,
): OptionSchema | undefined {
    return schema.options.find((option) => option.name === name);
}

/**
 * Validates a command's schema at registration time.
 *
 * Catching a malformed command at boot rather than when a user invokes it
 * is one of the main reasons the framework keeps a derived schema around.
 *
 * @param schema - The schema to validate.
 * @throws {TypeError} When the schema is invalid.
 */
export function validateSchema(schema: CommandSchema): void {
    if (!schema.name || !schema.name.trim()) {
        throw new TypeError('A command must have a name.');
    }

    if (!schema.description || !schema.description.trim()) {
        throw new TypeError(
            `Command "${schema.name}" must have a description.`,
        );
    }

    validateOptions(schema, schema.options, schema.name);
}

function validateOptions(
    schema: CommandSchema,
    options: readonly OptionSchema[],
    path: string,
): void {
    const seen = new Set<string>();

    for (const option of options) {
        if (seen.has(option.name)) {
            throw new TypeError(
                `Command "${path}" declares the option "${option.name}" more than once.`,
            );
        }

        seen.add(option.name);

        if (
            option.minValue !== undefined &&
            option.maxValue !== undefined &&
            option.minValue > option.maxValue
        ) {
            throw new TypeError(
                `Option "${path}.${option.name}" has a minimum value greater than its maximum.`,
            );
        }

        if (
            option.minLength !== undefined &&
            option.maxLength !== undefined &&
            option.minLength > option.maxLength
        ) {
            throw new TypeError(
                `Option "${path}.${option.name}" has a minimum length greater than its maximum.`,
            );
        }

        if (option.choices) {
            const values = new Set(
                option.choices.map((choice) => String(choice.value)),
            );

            if (values.size !== option.choices.length) {
                throw new TypeError(
                    `Option "${path}.${option.name}" declares duplicate choices.`,
                );
            }
        }

        if (option.type === ApplicationCommandOptionType.Subcommand) {
            if (option.options && option.options.length === 0) {
                throw new TypeError(
                    `Subcommand "${path}.${option.name}" must declare at least one option.`,
                );
            }
        }

        if (option.options) {
            validateOptions(schema, option.options, `${path}.${option.name}`);
        }
    }
}

/**
 * Checks whether a choice is part of an option's declared choices.
 *
 * @param option - The option schema.
 * @param value - The value to check.
 * @returns `true` when the value is allowed.
 */
export function isChoiceAllowed(
    option: OptionSchema,
    value: string | number,
): boolean {
    if (!option.choices || option.choices.length === 0) {
        return true;
    }

    return option.choices.some((choice) => choice.value === value);
}

/**
 * Finds a choice declared by an option.
 *
 * @param option - The option schema.
 * @param value - The value to look for.
 * @returns The matching choice, when there is one.
 */
export function findChoice(
    option: OptionSchema,
    value: string | number,
): APIApplicationCommandOptionChoice | undefined {
    return option.choices?.find((choice) => choice.value === value);
}
