import type {
    APIGuild,
    APIGuildMember,
    APIOverwrite,
    APIRole,
} from 'discord-api-types/v10';

import { PermissionsBitField, parsePermissions } from './bitfield';

/**
 * The channel shape required to resolve channel-level permissions.
 */
export interface PermissionChannel {
    /** ID of the channel. */
    readonly id: string;

    /** Permission overwrites applied to the channel. */
    readonly permission_overwrites?: readonly APIOverwrite[];
}

/**
 * The inputs required to resolve a member's effective permissions.
 */
export interface PermissionResolutionInput {
    /** The guild the member belongs to. */
    readonly guild: Pick<APIGuild, 'id' | 'owner_id'>;

    /** Every role defined in the guild, including `@everyone`. */
    readonly roles: readonly APIRole[];

    /** The member whose permissions are being resolved. */
    readonly member: Pick<APIGuildMember, 'roles'> & {
        readonly user: { id: string };
    };

    /** The channel the permissions apply to, when resolving channel-level permissions. */
    readonly channel?: PermissionChannel | null;
}

/**
 * The result of a permission resolution.
 */
export interface ResolvedPermissions {
    /** The member's guild-level permissions. */
    readonly guild: PermissionsBitField;

    /** The member's permissions in the requested channel. */
    readonly channel: PermissionsBitField;

    /** Whether the member bypasses channel overwrites. */
    readonly administrator: boolean;
}

/**
 * Resolves the effective permissions of a member in a guild and, optionally,
 * in a channel.
 *
 * The algorithm follows Discord's documented rules:
 *
 * 1. Start with the permissions of `@everyone`.
 * 2. Add the permissions of every role the member holds.
 * 3. Apply the channel's `@everyone` overwrite.
 * 4. Apply the union of the role overwrites for the member's roles.
 * 5. Apply the member-specific overwrite.
 *
 * Denies always win over allows, and role overwrites are unioned before the
 * member overwrite is applied.
 *
 * @param input - The guild, role, member and channel data to resolve from.
 * @returns The resolved permissions.
 */
export function resolvePermissions(
    input: PermissionResolutionInput,
): ResolvedPermissions {
    const { guild, roles, member, channel } = input;

    const everyoneRole = roles.find((role) => role.id === guild.id);
    const memberRoles = roles.filter((role) =>
        member.roles.includes(role.id),
    );

    const base = new PermissionsBitField(
        parsePermissions(everyoneRole?.permissions ?? 0),
    );

    for (const role of memberRoles) {
        base.add(parsePermissions(role.permissions));
    }

    const administrator = base.has(PermissionsBitField.Flags.Administrator);
    const guildOwner = guild.owner_id === member.user.id;

    if (guildOwner || administrator) {
        const all = new PermissionsBitField(PermissionsBitField.All);

        return {
            guild: all,
            channel: all,
            administrator: true,
        };
    }

    const resolved = new PermissionsBitField(base.bitfield);

    if (!channel) {
        return {
            guild: resolved,
            channel: resolved,
            administrator: false,
        };
    }

    const overwrites = channel.permission_overwrites ?? [];
    const everyoneOverwrite = overwrites.find(
        (overwrite) => overwrite.id === guild.id,
    );

    if (everyoneOverwrite) {
        resolved.remove(parsePermissions(everyoneOverwrite.deny));
        resolved.add(parsePermissions(everyoneOverwrite.allow));
    }

    let roleAllow = 0n;
    let roleDeny = 0n;

    for (const overwrite of overwrites) {
        if (overwrite.id === guild.id || overwrite.id === member.user.id) {
            continue;
        }

        if (!member.roles.includes(overwrite.id)) {
            continue;
        }

        roleAllow |= parsePermissions(overwrite.allow);
        roleDeny |= parsePermissions(overwrite.deny);
    }

    if (roleDeny !== 0n || roleAllow !== 0n) {
        resolved.remove(roleDeny);
        resolved.add(roleAllow);
    }

    const memberOverwrite = overwrites.find(
        (overwrite) => overwrite.id === member.user.id,
    );

    if (memberOverwrite) {
        resolved.remove(parsePermissions(memberOverwrite.deny));
        resolved.add(parsePermissions(memberOverwrite.allow));
    }

    return {
        guild: resolved,
        channel: resolved,
        administrator: false,
    };
}
