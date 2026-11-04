import type {
    APIAllowedMentions,
    APIButtonComponent,
    APIEmbed,
    APIMessageComponentEmoji,
    APIMessageTopLevelComponent,
    APIStringSelectComponent,
    MessageFlags,
} from 'discord-api-types/v10';
import { ComponentType } from 'discord-api-types/v10';

import {
    createCustomId,
    createReservedAction,
    MAX_CUSTOM_ID_LENGTH,
    assertValidAction,
} from './ids';
import type { ReservedAction } from './ids';
import type {
    ButtonSpec,
    ComponentButtonStyle,
    ComponentRow,
    ComponentSpec,
    EmojiSpec,
    RenderedContent,
    SelectSpec,
} from './types';

/** Maximum number of action rows on a message. */
export const MAX_ACTION_ROWS = 5;

/** Maximum number of components in a single action row. */
export const MAX_COMPONENTS_PER_ROW = 5;

/** Maximum number of embeds on a message. */
export const MAX_EMBEDS = 10;

/**
 * Allowed mentions applied when the widget does not specify its own.
 *
 * Mentions are suppressed by default: a widget rendering user-supplied text
 * must not be able to ping everyone by accident.
 */
export const DEFAULT_ALLOWED_MENTIONS: APIAllowedMentions = { parse: [] };

/**
 * Framework-wide defaults applied by the rendering pipeline.
 */
export interface RenderDefaults {
    /** Allowed mentions applied when the widget does not specify its own. */
    readonly allowedMentions?: APIAllowedMentions;

    /** Message flags applied to the rendered message. */
    readonly flags?: MessageFlags;

    /** Whether the message should be read out by text-to-speech. */
    readonly tts?: boolean;
}

/**
 * The message payload produced by the rendering pipeline.
 */
export interface RenderedMessage {
    /** Plain-text content of the message. */
    readonly content?: string;

    /** Embeds attached to the message. */
    readonly embeds?: APIEmbed[];

    /** Component rows attached to the message. */
    readonly components?: APIMessageTopLevelComponent[];

    /** Controls which mentions are allowed to ping. */
    readonly allowed_mentions?: APIAllowedMentions;

    /** Message flags applied to the message. */
    readonly flags?: MessageFlags;

    /** Whether the message is read out by text-to-speech. */
    readonly tts?: boolean;
}

/**
 * Builds a button specification.
 *
 * This helper exists so that the correct thing is easy: the framework owns
 * the `custom_id`, so users describe *what* a button does rather than
 * minting ids themselves.
 *
 * @param action - User-defined action dispatched when the button is pressed.
 * @param label - Text displayed on the button.
 * @param options - Optional presentation details.
 * @returns The button specification.
 */
export function button(
    action: string,
    label: string,
    options: {
        readonly style?: ComponentButtonStyle;
        readonly emoji?: EmojiSpec;
        readonly disabled?: boolean;
    } = {},
): ButtonSpec {
    assertValidAction(action);

    if (!label) {
        throw new TypeError('Button label must be a non-empty string.');
    }

    return {
        type: 'button',
        action,
        label,
        ...(options.style === undefined ? {} : { style: options.style }),
        ...(options.emoji === undefined ? {} : { emoji: options.emoji }),
        ...(options.disabled === undefined ? {} : { disabled: options.disabled }),
    };
}

/**
 * Builds a select menu specification.
 *
 * @param action - User-defined action dispatched when a value is selected.
 * @param options - Options offered by the select menu.
 * @param details - Optional presentation details.
 * @returns The select menu specification.
 */
export function select(
    action: string,
    options: readonly {
        readonly label: string;
        readonly value: string;
        readonly description?: string;
        readonly emoji?: EmojiSpec;
        readonly default?: boolean;
    }[],
    details: {
        readonly placeholder?: string;
        readonly disabled?: boolean;
    } = {},
): SelectSpec {
    assertValidAction(action);

    if (!Array.isArray(options) || options.length === 0) {
        throw new TypeError('Select menu must define at least one option.');
    }

    if (options.length > 25) {
        throw new RangeError('Select menu must not define more than 25 options.');
    }

    return {
        type: 'select',
        action,
        options: options.map((option) => ({
            label: option.label,
            value: option.value,
            ...(option.description === undefined
                ? {}
                : { description: option.description }),
            ...(option.emoji === undefined ? {} : { emoji: option.emoji }),
            ...(option.default === undefined ? {} : { default: option.default }),
        })),
        ...(details.placeholder === undefined
            ? {}
            : { placeholder: details.placeholder }),
        ...(details.disabled === undefined ? {} : { disabled: details.disabled }),
    };
}

/**
 * Builds a select menu specification for a reserved navigation action.
 *
 * @param action - The reserved navigation action.
 * @param options - Options offered by the select menu.
 * @param details - Optional presentation details.
 * @returns The select menu specification.
 */
export function navigationSelect(
    action: ReservedAction,
    options: readonly {
        readonly label: string;
        readonly value: string;
        readonly description?: string;
        readonly emoji?: EmojiSpec;
        readonly default?: boolean;
    }[],
    details: {
        readonly placeholder?: string;
        readonly disabled?: boolean;
    } = {},
): SelectSpec {
    if (!Array.isArray(options) || options.length === 0) {
        throw new TypeError('Select menu must define at least one option.');
    }

    if (options.length > 25) {
        throw new RangeError('Select menu must not define more than 25 options.');
    }

    return {
        type: 'select',
        action: createReservedAction(action),
        options: options.map((option) => ({
            label: option.label,
            value: option.value,
            ...(option.description === undefined
                ? {}
                : { description: option.description }),
            ...(option.emoji === undefined ? {} : { emoji: option.emoji }),
            ...(option.default === undefined ? {} : { default: option.default }),
        })),
        ...(details.placeholder === undefined
            ? {}
            : { placeholder: details.placeholder }),
        ...(details.disabled === undefined ? {} : { disabled: details.disabled }),
    };
}

/**
 * Converts a widget's rendered content into a Discord message payload.
 *
 * This is step two of the rendering pipeline: embeds are converted to their
 * API representation, components are given framework-minted custom ids, and
 * the accessibility and safety defaults are applied.
 *
 * @param content - Content produced by the widget.
 * @param namespace - Namespace used for the minted custom ids.
 * @param widgetId - Routing id of the widget.
 * @param defaults - Framework-wide defaults.
 * @returns The message payload to send to Discord.
 */
export function renderContent(
    content: RenderedContent,
    namespace: string,
    widgetId: string,
    defaults: RenderDefaults = {},
): RenderedMessage {
    const embeds = (content.embeds ?? []).map((embed) => embed.toJSON());

    if (embeds.length > MAX_EMBEDS) {
        throw new RangeError(
            `A message may not contain more than ${MAX_EMBEDS} embeds.`,
        );
    }

    const rows = content.components ?? [];

    if (rows.length > MAX_ACTION_ROWS) {
        throw new RangeError(
            `A message may not contain more than ${MAX_ACTION_ROWS} action rows.`,
        );
    }

    const components = rows.map((row) => renderRow(row, namespace, widgetId));

    const message: {
        content?: string;
        embeds?: APIEmbed[];
        components?: APIMessageTopLevelComponent[];
        allowed_mentions?: APIAllowedMentions;
        flags?: MessageFlags;
        tts?: boolean;
    } = {};

    if (content.content !== undefined) {
        message.content = content.content;
    }

    if (embeds.length > 0) {
        message.embeds = embeds;
    }

    if (components.length > 0) {
        message.components = components;
    }

    message.allowed_mentions =
        defaults.allowedMentions ?? DEFAULT_ALLOWED_MENTIONS;

    if (defaults.flags !== undefined) {
        message.flags = defaults.flags;
    }

    if (defaults.tts !== undefined) {
        message.tts = defaults.tts;
    }

    return message;
}

function renderRow(
    row: ComponentRow,
    namespace: string,
    widgetId: string,
): APIMessageTopLevelComponent {
    if (row.length === 0) {
        throw new TypeError('An action row must contain at least one component.');
    }

    if (row.length > MAX_COMPONENTS_PER_ROW) {
        throw new RangeError(
            `An action row may not contain more than ${MAX_COMPONENTS_PER_ROW} components.`,
        );
    }

    const selects = row.filter((component) => component.type === 'select');

    if (selects.length > 1) {
        throw new TypeError(
            'An action row may not contain more than one select menu.',
        );
    }

    if (selects.length === 1 && row.length > 1) {
        throw new TypeError(
            'A select menu must be the only component in its action row.',
        );
    }

    const components = row.map((component) =>
        renderComponent(component, namespace, widgetId),
    );

    return { type: ComponentType.ActionRow, components };
}

function renderComponent(
    component: ComponentSpec,
    namespace: string,
    widgetId: string,
): APIButtonComponent | APIStringSelectComponent {    if (component.type === 'button') {
        return renderButton(component, namespace, widgetId);
    }

    return renderSelect(component, namespace, widgetId);
}

function renderButton(
    spec: ButtonSpec,
    namespace: string,
    widgetId: string,
): APIButtonComponent {
    const customId = createCustomId(namespace, widgetId, spec.action);

    if (customId.length > MAX_CUSTOM_ID_LENGTH) {
        throw new RangeError(
            `Custom id is ${customId.length} characters long, which exceeds the ${MAX_CUSTOM_ID_LENGTH} character limit.`,
        );
    }

    return {
        type: ComponentType.Button,
        custom_id: customId,
        label: spec.label,
        ...(spec.style === undefined ? {} : { style: spec.style }),
        ...(spec.emoji === undefined ? {} : { emoji: toEmoji(spec.emoji) }),
        ...(spec.disabled === undefined ? {} : { disabled: spec.disabled }),
    } as APIButtonComponent;
}

function renderSelect(
    spec: SelectSpec,
    namespace: string,
    widgetId: string,
): APIStringSelectComponent {
    const customId = createCustomId(namespace, widgetId, spec.action);

    return {
        type: ComponentType.StringSelect,
        custom_id: customId,
        options: spec.options.map((option) => ({
            label: option.label,
            value: option.value,
            ...(option.description === undefined
                ? {}
                : { description: option.description }),
            ...(option.emoji === undefined ? {} : { emoji: toEmoji(option.emoji) }),
            ...(option.default === undefined ? {} : { default: option.default }),
        })),
        ...(spec.placeholder === undefined ? {} : { placeholder: spec.placeholder }),
        ...(spec.disabled === undefined ? {} : { disabled: spec.disabled }),
    } as APIStringSelectComponent;
}

function toEmoji(emoji: EmojiSpec): APIMessageComponentEmoji {
    return typeof emoji === 'string' ? { name: emoji } : emoji;
}
