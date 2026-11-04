import { readFile } from 'node:fs/promises';

import type {
    ConfigField,
    ConfigSchema,
    ConfigSource,
    LoadedConfig,
} from './types';
import { ConfigError } from './types';

/**
 * A source backed by the process environment.
 *
 * @param prefix - Prefix prepended to every environment variable name.
 * @param environment - The environment to read from.
 * @returns The source.
 */
export function envSource(
    prefix = '',
    environment: NodeJS.ProcessEnv = process.env,
): ConfigSource {
    return {
        name: 'environment',
        load(): Record<string, unknown> {
            const values: Record<string, unknown> = {};

            for (const [key, value] of Object.entries(environment)) {
                if (value === undefined) {
                    continue;
                }

                values[prefix ? `${prefix}${key}` : key] = value;
            }

            return values;
        },
    };
}

/**
 * A source backed by a JSON file.
 *
 * @param filePath - Path to the JSON file.
 * @param name - Name of the source, used in error messages.
 * @returns The source.
 */
export function fileSource(
    filePath: string,
    name = `file:${filePath}`,
): ConfigSource {
    return {
        name,
        async load(): Promise<Record<string, unknown>> {
            let contents: string;

            try {
                contents = await readFile(filePath, 'utf8');
            } catch (error) {
                if (
                    typeof error === 'object' &&
                    error !== null &&
                    'code' in error &&
                    (error as { code?: unknown }).code === 'ENOENT'
                ) {
                    return {};
                }

                throw error;
            }

            if (!contents.trim()) {
                return {};
            }

            const parsed: unknown = JSON.parse(contents);

            if (
                typeof parsed !== 'object' ||
                parsed === null ||
                Array.isArray(parsed)
            ) {
                throw new ConfigError(
                    `Configuration file "${filePath}" must contain an object.`,
                );
            }

            return parsed as Record<string, unknown>;
        },
    };
}

/**
 * A source backed by a plain object.
 *
 * @param values - The values of the source.
 * @param name - Name of the source, used in error messages.
 * @returns The source.
 */
export function objectSource(
    values: Record<string, unknown>,
    name = 'object',
): ConfigSource {
    return {
        name,
        load(): Record<string, unknown> {
            return { ...values };
        },
    };
}

/**
 * Loads and validates a configuration.
 *
 * The sources are consulted in order, and the first source that provides a
 * value wins. This makes the precedence explicit rather than implicit.
 *
 * @param schema - The schema of the configuration.
 * @param sources - The sources to read from, highest precedence first.
 * @returns The validated configuration.
 * @throws {ConfigError} When the configuration is invalid.
 */
export async function loadConfig(
    schema: ConfigSchema,
    sources: readonly ConfigSource[],
): Promise<LoadedConfig> {
    const loaded = await Promise.all(
        sources.map(async (source) => ({
            name: source.name,
            values: await source.load(),
        })),
    );

    const issues: string[] = [];
    const values: Record<string, unknown> = {};
    const origins: Record<string, string> = {};

    for (const [key, field] of Object.entries(schema)) {
        const result = resolveField(key, field, loaded);

        if (result.issue) {
            issues.push(result.issue);

            continue;
        }

        values[key] = result.value;
        origins[key] = result.origin;
    }

    if (issues.length > 0) {
        throw new ConfigError(
            `Invalid configuration:\n- ${issues.join('\n- ')}`,
            issues,
        );
    }

    return { values, origins };
}

interface FieldResult {
    readonly value: unknown;
    readonly origin: string;
    readonly issue?: string;
}

function resolveField(
    key: string,
    field: ConfigField,
    loaded: readonly { name: string; values: Record<string, unknown> }[],
): FieldResult {
    const lookup = field.env ?? key;
    const candidates = [lookup, lookup.toUpperCase()];

    for (const source of loaded) {
        for (const candidate of candidates) {
            if (!(candidate in source.values)) {
                continue;
            }

            const raw = source.values[candidate];

            if (raw === undefined || raw === null || raw === '') {
                continue;
            }

            return coerce(key, field, raw, source.name);
        }
    }

    if (field.required) {
        return {
            value: undefined,
            origin: loaded[0]?.name ?? 'none',
            issue: `"${key}" is required but was not provided.`,
        };
    }

    if (field.default !== undefined) {
        return {
            value: field.default,
            origin: 'default',
        };
    }

    return { value: undefined, origin: 'none' };
}

function coerce(
    key: string,
    field: ConfigField,
    raw: unknown,
    origin: string,
): FieldResult {
    switch (field.type) {
        case 'string': {
            if (typeof raw !== 'string') {
                return {
                    value: undefined,
                    origin,
                    issue: `"${key}" must be a string.`,
                };
            }

            let value = raw;

            if (field.transform) {
                value = field.transform(value);
            }

            if (
                field.minLength !== undefined &&
                value.length < field.minLength
            ) {
                return {
                    value: undefined,
                    origin,
                    issue: `"${key}" must be at least ${field.minLength} characters long.`,
                };
            }

            if (
                field.maxLength !== undefined &&
                value.length > field.maxLength
            ) {
                return {
                    value: undefined,
                    origin,
                    issue: `"${key}" must be at most ${field.maxLength} characters long.`,
                };
            }

            if (field.pattern && !field.pattern.test(value)) {
                return {
                    value: undefined,
                    origin,
                    issue: `"${key}" does not match the expected format.`,
                };
            }

            return { value, origin };
        }

        case 'number': {
            const value =
                typeof raw === 'number' ? raw : Number(String(raw).trim());

            if (!Number.isFinite(value)) {
                return {
                    value: undefined,
                    origin,
                    issue: `"${key}" must be a number.`,
                };
            }

            if (field.integer && !Number.isInteger(value)) {
                return {
                    value: undefined,
                    origin,
                    issue: `"${key}" must be an integer.`,
                };
            }

            if (field.min !== undefined && value < field.min) {
                return {
                    value: undefined,
                    origin,
                    issue: `"${key}" must be at least ${field.min}.`,
                };
            }

            if (field.max !== undefined && value > field.max) {
                return {
                    value: undefined,
                    origin,
                    issue: `"${key}" must be at most ${field.max}.`,
                };
            }

            return {
                value: field.transform ? field.transform(value) : value,
                origin,
            };
        }

        case 'boolean': {
            if (typeof raw === 'boolean') {
                return { value: raw, origin };
            }

            const text = String(raw).trim().toLowerCase();
            const truthy = (field.truthy ?? ['true', '1', 'yes', 'on']).map(
                (entry) => entry.toLowerCase(),
            );
            const falsy = (field.falsy ?? ['false', '0', 'no', 'off']).map(
                (entry) => entry.toLowerCase(),
            );

            if (truthy.includes(text)) {
                return { value: true, origin };
            }

            if (falsy.includes(text)) {
                return { value: false, origin };
            }

            return {
                value: undefined,
                origin,
                issue: `"${key}" must be a boolean.`,
            };
        }

        case 'object': {
            if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
                return {
                    value: undefined,
                    origin,
                    issue: `"${key}" must be an object.`,
                };
            }

            return { value: raw, origin };
        }

        default:
            return { value: undefined, origin };
    }
}

/**
 * Redacts the secret values of a configuration.
 *
 * @param config - The loaded configuration.
 * @param schema - The schema describing the configuration.
 * @returns A copy of the configuration with secrets replaced.
 */
export function redactConfig(
    config: LoadedConfig | Record<string, unknown>,
    schema: ConfigSchema,
): Record<string, unknown> {
    const values =
        'values' in config
            ? (config as LoadedConfig).values
            : (config as Record<string, unknown>);

    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(values)) {
        const field = schema[key];

        if (field?.secret) {
            redacted[key] = '***';

            continue;
        }

        if (field?.type === 'object' && isPlainObject(value)) {
            redacted[key] = redactConfig(value, field.schema);

            continue;
        }

        redacted[key] = value;
    }

    return redacted;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
