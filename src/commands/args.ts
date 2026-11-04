import { ApplicationCommandOptionType } from 'discord-api-types/v10';
import type { Interaction } from '../interaction/types';
import type { CommandDataOption, CommandOptionResolver } from './options';
import { findOptionSchema, isChoiceAllowed } from './schema';
import type { CommandArgs, CommandSchema, OptionSchema } from './types';

/**
 * Resolves and validates the arguments of an invocation.
 *
 * The builder remains the source of truth: the schema is derived from it at
 * registration time and the incoming options are validated against that
 * schema here. The result is a plain record, so it is trivially
 * serializable, easy to log, and simple to test.
 *
 * @param schema - The derived schema of the command.
 * @param options - The option resolver of the interaction.
 * @returns The validated arguments.
 */
export function resolveArgs(
    schema: CommandSchema,
    options: CommandOptionResolver,
): CommandArgs {
    const args: CommandArgs = {};
    const branch = invokedBranch(schema, options);

    for (const option of options.leaf) {
        const optionSchema = findOptionSchema(branch, option.name);

        if (!optionSchema) {
            continue;
        }

        validateOption(option, optionSchema);
        args[option.name] = readValue(option, optionSchema);
    }

    for (const option of collectRequired(branch)) {
        if (!Object.hasOwn(args, option.name)) {
            throw new Error(
                `Required option "${option.name}" is missing for command "${schema.name}".`,
            );
        }
    }

    return args;
}

/**
 * The schema options of the branch that was invoked.
 *
 * @param schema - The schema of the command.
 * @param options - The resolver of the interaction.
 * @returns The options of the invoked subcommand.
 */
function invokedBranch(
    schema: CommandSchema,
    options: CommandOptionResolver,
): CommandSchema {
    let current: readonly OptionSchema[] = schema.options;

    const groupName = options.getSubcommandGroup();

    if (groupName !== null) {
        const group = current.find((option) => option.name === groupName);

        current = group?.options ?? [];
    }

    const subcommandName = options.getSubcommand();

    if (subcommandName !== null) {
        const subcommand = current.find(
            (option) => option.name === subcommandName,
        );

        current = subcommand?.options ?? [];
    }

    return { ...schema, options: current };
}

/**
 * Collects the required options of a schema, at any depth.
 *
 * @param schema - The schema to walk.
 * @returns The required options.
 */
function collectRequired(schema: CommandSchema): OptionSchema[] {
    const required: OptionSchema[] = [];

    const visit = (options: readonly OptionSchema[]): void => {
        for (const option of options) {
            if (option.required) {
                required.push(option);
            }

            if (option.options) {
                visit(option.options);
            }
        }
    };

    visit(schema.options);

    return required;
}

function validateOption(option: CommandDataOption, schema: OptionSchema): void {
    if (option.type !== schema.type) {
        throw new TypeError(
            `Option "${schema.name}" is of type ${option.type}, not ${schema.type}.`,
        );
    }

    if (
        schema.type === ApplicationCommandOptionType.Integer ||
        schema.type === ApplicationCommandOptionType.Number
    ) {
        const value = option.value as number;

        if (schema.minValue !== undefined && value < schema.minValue) {
            throw new RangeError(
                `Option "${schema.name}" must be at least ${schema.minValue}.`,
            );
        }

        if (schema.maxValue !== undefined && value > schema.maxValue) {
            throw new RangeError(
                `Option "${schema.name}" must be at most ${schema.maxValue}.`,
            );
        }
    }

    if (schema.type === ApplicationCommandOptionType.String) {
        const value = option.value as string;

        if (schema.minLength !== undefined && value.length < schema.minLength) {
            throw new RangeError(
                `Option "${schema.name}" must be at least ${schema.minLength} characters long.`,
            );
        }

        if (schema.maxLength !== undefined && value.length > schema.maxLength) {
            throw new RangeError(
                `Option "${schema.name}" must be at most ${schema.maxLength} characters long.`,
            );
        }
    }

    if (
        schema.type === ApplicationCommandOptionType.String &&
        schema.choices &&
        schema.choices.length > 0
    ) {
        const value = option.value as string;

        if (!isChoiceAllowed(schema, value)) {
            throw new RangeError(
                `Option "${schema.name}" does not accept the value "${value}".`,
            );
        }
    }
}

function readValue(option: CommandDataOption, schema: OptionSchema): unknown {
    switch (schema.type) {
        case ApplicationCommandOptionType.Integer:
        case ApplicationCommandOptionType.Number:
            return option.value as number;
        case ApplicationCommandOptionType.Boolean:
            return option.value as boolean;
        case ApplicationCommandOptionType.String:
        case ApplicationCommandOptionType.User:
        case ApplicationCommandOptionType.Role:
        case ApplicationCommandOptionType.Channel:
        case ApplicationCommandOptionType.Mentionable:
        case ApplicationCommandOptionType.Attachment:
            return option.value as string;
        default:
            return option.value;
    }
}

/**
 * Builds the argument record of an interaction without a command schema.
 *
 * @param interaction - The interaction to read.
 * @returns The raw arguments.
 */
export function rawArgs(interaction: Interaction): CommandArgs {
    const data = (
        interaction.raw as {
            data?: {
                options?: readonly {
                    name: string;
                    value?: unknown;
                }[];
            };
        }
    ).data;

    const args: CommandArgs = {};

    for (const option of data?.options ?? []) {
        args[option.name] = option.value;
    }

    return args;
}
