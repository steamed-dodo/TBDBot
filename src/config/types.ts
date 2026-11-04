/**
 * A configuration schema.
 *
 * The schema is a plain record of field definitions, which keeps it
 * serializable and easy to validate.
 */
export type ConfigSchema = Record<string, ConfigField>;

/**
 * A single configuration field.
 */
export type ConfigField =
    StringField | NumberField | BooleanField | ObjectField;

/**
 * A string field.
 */
export interface StringField {
    /** The type of the field. */
    readonly type: 'string';

    /** Whether the field must be present. */
    readonly required?: boolean;

    /** Value used when the field is absent. */
    readonly default?: string;

    /** Whether the value must be redacted when the config is logged. */
    readonly secret?: boolean;

    /** Environment variable the value is read from. */
    readonly env?: string;

    /** Pattern the value must match. */
    readonly pattern?: RegExp;

    /** Minimum length of the value. */
    readonly minLength?: number;

    /** Maximum length of the value. */
    readonly maxLength?: number;

    /** Transformation applied to the raw value. */
    readonly transform?: (value: string) => string;
}

/**
 * A numeric field.
 */
export interface NumberField {
    /** The type of the field. */
    readonly type: 'number';

    /** Whether the field must be present. */
    readonly required?: boolean;

    /** Value used when the field is absent. */
    readonly default?: number;

    /** Whether the value must be redacted when the config is logged. */
    readonly secret?: boolean;

    /** Environment variable the value is read from. */
    readonly env?: string;

    /** Smallest accepted value. */
    readonly min?: number;

    /** Largest accepted value. */
    readonly max?: number;

    /** Whether the value must be an integer. */
    readonly integer?: boolean;

    /** Transformation applied to the raw value. */
    readonly transform?: (value: number) => number;
}

/**
 * A boolean field.
 */
export interface BooleanField {
    /** The type of the field. */
    readonly type: 'boolean';

    /** Whether the field must be present. */
    readonly required?: boolean;

    /** Value used when the field is absent. */
    readonly default?: boolean;

    /** Whether the value must be redacted when the config is logged. */
    readonly secret?: boolean;

    /** Environment variable the value is read from. */
    readonly env?: string;

    /** Strings treated as `true`. */
    readonly truthy?: readonly string[];

    /** Strings treated as `false`. */
    readonly falsy?: readonly string[];
}

/**
 * A nested object field.
 */
export interface ObjectField {
    /** The type of the field. */
    readonly type: 'object';

    /** The schema of the nested object. */
    readonly schema: ConfigSchema;

    /** Whether the field must be present. */
    readonly required?: boolean;

    /** Value used when the field is absent. */
    readonly default?: Record<string, unknown>;

    /** Whether the value must be redacted when the config is logged. */
    readonly secret?: boolean;

    /** Environment variable the value is read from. */
    readonly env?: string;
}

/**
 * A source of configuration values.
 */
export interface ConfigSource {
    /** Name of the source, used in error messages. */
    readonly name: string;

    /** Loads the raw values of the source. */
    load(): Promise<Record<string, unknown>> | Record<string, unknown>;
}

/**
 * The result of loading a configuration.
 */
export interface LoadedConfig {
    /** The validated configuration values. */
    readonly values: Record<string, unknown>;

    /** The sources the values were read from, keyed by field name. */
    readonly origins: Record<string, string>;
}

/**
 * Thrown when a configuration cannot be validated.
 */
export class ConfigError extends Error {
    /**
     * @param message - The error message.
     * @param issues - The individual validation problems.
     */
    constructor(
        message: string,
        public readonly issues: readonly string[] = [],
    ) {
        super(message);

        this.name = 'ConfigError';
    }
}
