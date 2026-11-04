import { MessageFlags } from 'discord-api-types/v10';

import type { Interaction } from '../interaction/types';
import { PermissionsBitField } from '../permissions/bitfield';
import type { PermissionResolvable } from '../permissions/bitfield';
import type { Store } from '../store/types';
import type { CommandContext, Middleware } from './types';

/**
 * Replies to an interaction with an ephemeral error message.
 *
 * @param interaction - The interaction to answer.
 * @param content - Message shown to the user.
 */
export async function deny(
    interaction: Interaction,
    content: string,
): Promise<void> {
    try {
        await interaction.reply({
            content,
            flags: MessageFlags.Ephemeral,
        });
    } catch {
        // The interaction may already have been answered.
    }
}

/**
 * Restricts a command to guild interactions.
 *
 * @returns The middleware.
 */
export function guildOnlyMiddleware(): Middleware {
    return async (context, next) => {
        if (!context.interaction.guildId) {
            await deny(
                context.interaction,
                'This command can only be used in a server.',
            );

            return;
        }

        await next();
    };
}

/**
 * Restricts a command to the bot's owners.
 *
 * @param ownerIds - IDs of the bot's owners.
 * @returns The middleware.
 */
export function ownerOnlyMiddleware(ownerIds: readonly string[]): Middleware {
    return async (context, next) => {
        if (!ownerIds.includes(context.interaction.userId)) {
            await deny(context.interaction, 'This command is owner-only.');

            return;
        }

        await next();
    };
}

/**
 * Options accepted by {@link permissionMiddleware}.
 */
export interface PermissionMiddlewareOptions {
    /**
     * Resolves the permissions of the invoking member.
     *
     * When omitted, the permissions Discord included in the interaction
     * payload are used.
     */
    readonly resolve?: (
        interaction: Interaction,
    ) => Promise<PermissionsBitField | null> | PermissionsBitField | null;
}

/**
 * Requires the invoking member to hold a set of permissions.
 *
 * @param permission - The permission or permissions required.
 * @param options - Middleware options.
 * @returns The middleware.
 */
export function permissionMiddleware(
    permission: PermissionResolvable | readonly PermissionResolvable[],
    options: PermissionMiddlewareOptions = {},
): Middleware {
    const list: readonly PermissionResolvable[] = Array.isArray(permission)
        ? (permission as readonly PermissionResolvable[])
        : [permission as PermissionResolvable];

    const required = list.map((entry) => PermissionsBitField.resolve(entry));

    return async (context, next) => {
        const permissions = options.resolve
            ? await options.resolve(context.interaction)
            : context.interaction.memberPermissions === null
              ? null
              : new PermissionsBitField(context.interaction.memberPermissions);

        if (!permissions) {
            await deny(
                context.interaction,
                'This command cannot be used in direct messages.',
            );

            return;
        }

        for (const flag of required) {
            if (!permissions.has(flag)) {
                await deny(
                    context.interaction,
                    'You do not have permission to use this command.',
                );

                return;
            }
        }

        await next();
    };
}

/**
 * Options accepted by {@link cooldownMiddleware}.
 */
export interface CooldownMiddlewareOptions {
    /**
     * Store used to persist the cooldown timestamps.
     *
     * @defaultValue An in-memory map.
     */
    readonly store?: Store<number>;

    /**
     * Builds the key the cooldown is stored under.
     *
     * @defaultValue The command name and the user ID.
     */
    readonly key?: (context: CommandContext) => string;
}

/**
 * Limits how often a command may be used.
 *
 * @param cooldown - The cooldown, in milliseconds.
 * @param options - Middleware options.
 * @returns The middleware.
 */
export function cooldownMiddleware(
    cooldown: number,
    options: CooldownMiddlewareOptions = {},
): Middleware {
    const fallback = new Map<string, number>();
    const store = options.store;

    const read = async (key: string): Promise<number | undefined> => {
        if (store) {
            return store.get(key);
        }

        return fallback.get(key);
    };

    const write = async (key: string, value: number): Promise<void> => {
        if (store) {
            await store.set(key, value);

            return;
        }

        fallback.set(key, value);
    };

    return async (context, next) => {
        const key =
            options.key?.(context) ??
            `cooldown:${context.command.name}:${context.interaction.userId}`;

        const now = Date.now();
        const previous = await read(key);

        if (previous !== undefined && now < previous + cooldown) {
            const remaining = Math.ceil((previous + cooldown - now) / 1000);

            await deny(
                context.interaction,
                `Please wait ${remaining} more second${remaining === 1 ? '' : 's'} before using this command again.`,
            );

            return;
        }

        await write(key, now);
        await next();
    };
}
