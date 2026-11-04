import { randomBytes } from 'node:crypto';

/**
 * Maximum length Discord allows for a component's `custom_id`.
 *
 * @see https://discord.com/developers/docs/interactions/message-components#custom-ids
 */
export const MAX_CUSTOM_ID_LENGTH = 100;

/**
 * Namespace reserved by the framework for its own components.
 *
 * User components must not use it; the framework validates and throws on a
 * collision.
 */
export const FRAMEWORK_NAMESPACE = 'ui';

/**
 * Marker that introduces a framework-reserved action.
 *
 * The marker is a character that cannot appear in a user-defined action
 * under the framework's own rules, so the split between the reserved part
 * and the user part is unambiguous and cannot be spoofed.
 */
export const RESERVED_ACTION_PREFIX = '~';

/**
 * Separator between the namespace, the widget id, and the action.
 */
export const CUSTOM_ID_SEPARATOR = ':';

/**
 * Number of characters in a generated routing id.
 *
 * A routing id shares the 100-character `custom_id` field with the
 * namespace and the action, so it needs to be short.
 */
export const ROUTING_ID_LENGTH = 10;

/**
 * Navigation actions reserved by the framework.
 *
 * These are the action names the framework itself emits. A widget may
 * define additional reserved-style actions, but the built-in set is the
 * contract the framework documents.
 */
export const RESERVED_ACTIONS = ['next', 'previous', 'back', 'select'] as const;

/** A reserved navigation action. */
export type ReservedAction = (typeof RESERVED_ACTIONS)[number];

/**
 * The parsed contents of a framework-minted custom id.
 */
export interface ParsedCustomId {
    /** Namespace the component belongs to. */
    readonly namespace: string;

    /** Routing id of the widget that owns the component. */
    readonly widgetId: string;

    /** Action segment, exactly as it appeared in the custom id. */
    readonly action: string;
}

/**
 * Generates a short, opaque routing id.
 *
 * The id is base-36 and URL-safe, which keeps it short while staying
 * collision-free in practice.
 *
 * @param length - Number of characters in the generated id.
 * @returns The generated routing id.
 */
export function generateRoutingId(length: number = ROUTING_ID_LENGTH): string {
    if (!Number.isInteger(length) || length <= 0) {
        throw new RangeError('Routing id length must be a positive integer.');
    }

    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
    const bytes = randomBytes(length);
    let id = '';

    for (const byte of bytes) {
        id += alphabet[byte % alphabet.length];
    }

    return id;
}

/**
 * Validates a user-defined action.
 *
 * Actions must not contain the reserved marker, otherwise the split between
 * the reserved part and the user part would be ambiguous.
 *
 * @param action - Action to validate.
 * @throws {TypeError} If the action is empty or contains the reserved marker.
 */
export function assertValidAction(action: string): void {
    if (typeof action !== 'string' || action.length === 0) {
        throw new TypeError('Action must be a non-empty string.');
    }

    if (action.includes(RESERVED_ACTION_PREFIX)) {
        throw new TypeError(
            `Action must not contain the reserved prefix "${RESERVED_ACTION_PREFIX}": "${action}".`,
        );
    }
}

/**
 * Validates a namespace.
 *
 * @param namespace - Namespace to validate.
 * @throws {TypeError} If the namespace is empty or contains a reserved character.
 */
export function assertValidNamespace(namespace: string): void {
    if (typeof namespace !== 'string' || namespace.length === 0) {
        throw new TypeError('Namespace must be a non-empty string.');
    }

    if (namespace.includes(CUSTOM_ID_SEPARATOR)) {
        throw new TypeError(
            `Namespace must not contain "${CUSTOM_ID_SEPARATOR}": "${namespace}".`,
        );
    }
}

/**
 * Builds a framework-minted custom id.
 *
 * @param namespace - Namespace the component belongs to.
 * @param widgetId - Routing id of the owning widget.
 * @param action - Action segment, without the reserved marker.
 * @returns The custom id to send to Discord.
 * @throws {RangeError} If the resulting custom id exceeds Discord's limit.
 */
export function createCustomId(
    namespace: string,
    widgetId: string,
    action: string,
): string {
    assertValidNamespace(namespace);

    if (typeof widgetId !== 'string' || widgetId.length === 0) {
        throw new TypeError('Widget id must be a non-empty string.');
    }

    if (widgetId.includes(CUSTOM_ID_SEPARATOR)) {
        throw new TypeError(
            `Widget id must not contain "${CUSTOM_ID_SEPARATOR}": "${widgetId}".`,
        );
    }

    const customId = `${namespace}${CUSTOM_ID_SEPARATOR}${widgetId}${CUSTOM_ID_SEPARATOR}${action}`;

    if (customId.length > MAX_CUSTOM_ID_LENGTH) {
        throw new RangeError(
            `Custom id is ${customId.length} characters long, which exceeds the ${MAX_CUSTOM_ID_LENGTH} character limit.`,
        );
    }

    return customId;
}

/**
 * Parses a custom id minted by the framework.
 *
 * Only the first two separators are significant: the action segment may
 * itself contain separators, which keeps the user's action vocabulary
 * completely free.
 *
 * @param customId - The `custom_id` received from Discord.
 * @returns The parsed contents, or `null` when the id was not minted by the framework.
 */
export function parseCustomId(customId: string): ParsedCustomId | null {
    if (typeof customId !== 'string') {
        return null;
    }

    const firstSeparator = customId.indexOf(CUSTOM_ID_SEPARATOR);

    if (firstSeparator <= 0) {
        return null;
    }

    const secondSeparator = customId.indexOf(
        CUSTOM_ID_SEPARATOR,
        firstSeparator + 1,
    );

    if (secondSeparator <= firstSeparator + 1) {
        return null;
    }

    const namespace = customId.slice(0, firstSeparator);
    const widgetId = customId.slice(
        firstSeparator + 1,
        secondSeparator,
    );
    const action = customId.slice(secondSeparator + 1);

    if (action.length === 0) {
        return null;
    }

    return { namespace, widgetId, action };
}

/**
 * Determines whether an action is reserved by the framework.
 *
 * @param action - Action segment of a custom id.
 * @returns `true` when the action carries the reserved marker.
 */
export function isReservedAction(action: string): boolean {
    return action.startsWith(RESERVED_ACTION_PREFIX);
}

/**
 * Splits an action into its reserved and user parts.
 *
 * @param action - Action segment of a custom id.
 * @returns Whether the action is reserved, and the name without the marker.
 */
export function splitAction(action: string): {
    readonly reserved: boolean;
    readonly name: string;
} {
    if (!isReservedAction(action)) {
        return { reserved: false, name: action };
    }

    return { reserved: true, name: action.slice(RESERVED_ACTION_PREFIX.length) };
}

/**
 * Builds the action segment for a reserved navigation action.
 *
 * @param action - The reserved navigation action.
 * @returns The action segment, including the reserved marker.
 */
export function createReservedAction(action: ReservedAction): string {
    return `${RESERVED_ACTION_PREFIX}${action}`;
}
