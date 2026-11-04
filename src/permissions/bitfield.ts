import { PermissionFlagsBits } from 'discord-api-types/v10';

/**
 * Parses a permission bitfield that Discord may send as a string or a number.
 *
 * Discord's v10 API returns permission bitfields as strings, and 64-bit
 * permission values exceed `Number.MAX_SAFE_INTEGER`, so every permission
 * value is normalised to `bigint` here.
 *
 * @param value - The raw permission value.
 * @returns The permission bitfield as a `bigint`.
 */
export function parsePermissions(
    value: string | number | bigint | null | undefined,
): bigint {
    if (value === null || value === undefined) {
        return 0n;
    }

    if (typeof value === 'bigint') {
        return value;
    }

    if (typeof value === 'number') {
        return BigInt(Math.trunc(value));
    }

    const trimmed = value.trim();

    if (trimmed === '') {
        return 0n;
    }

    try {
        return BigInt(trimmed);
    } catch {
        return 0n;
    }
}

/**
 * Anything that can be resolved into a permission bitfield.
 */
export type PermissionResolvable =
    | bigint
    | number
    | string
    | PermissionsBitField
    | keyof typeof PermissionFlagsBits;

/**
 * A `bigint`-backed permission bitfield.
 *
 * Discord's permission values are 64-bit and do not fit in a JavaScript
 * number, so the framework's own bitfield is `bigint`-backed throughout.
 */
export class PermissionsBitField {
    /** The permission flags defined by Discord. */
    public static readonly Flags = PermissionFlagsBits;

    /** Every permission flag combined. */
    public static readonly All: bigint = Object.values(
        PermissionFlagsBits,
    ).reduce((total, flag) => total | flag, 0n);

    /** The permissions granted to a member by default. */
    public static readonly Default: bigint =
        PermissionFlagsBits.ViewChannel |
        PermissionFlagsBits.SendMessages |
        PermissionFlagsBits.ReadMessageHistory;

    private bits: bigint;

    /**
     * @param bits - The initial permissions.
     */
    constructor(bits: PermissionResolvable = 0n) {
        this.bits = PermissionsBitField.resolve(bits);
    }

    /** The raw permission bitfield. */
    public get bitfield(): bigint {
        return this.bits;
    }

    /**
     * Resolves any permission-like value into a `bigint`.
     *
     * @param permission - The value to resolve.
     * @returns The resolved bitfield.
     */
    public static resolve(permission: PermissionResolvable): bigint {
        if (permission instanceof PermissionsBitField) {
            return permission.bitfield;
        }

        if (typeof permission === 'bigint') {
            return permission;
        }

        if (typeof permission === 'number') {
            return BigInt(Math.trunc(permission));
        }

        if (typeof permission === 'string') {
            if (Object.hasOwn(PermissionFlagsBits, permission)) {
                return PermissionFlagsBits[
                    permission as keyof typeof PermissionFlagsBits
                ];
            }

            return parsePermissions(permission);
        }

        return PermissionFlagsBits[permission];
    }

    /**
     * Checks whether every given permission is present.
     *
     * @param permission - Permission or permissions to check for.
     * @returns `true` when all of the permissions are present.
     */
    public has(permission: PermissionResolvable): boolean {
        const resolved = PermissionsBitField.resolve(permission);

        return (this.bits & resolved) === resolved;
    }

    /**
     * Checks whether any of the given permissions is present.
     *
     * @param permission - Permission or permissions to check for.
     * @returns `true` when at least one of the permissions is present.
     */
    public any(permission: PermissionResolvable): boolean {
        const resolved = PermissionsBitField.resolve(permission);

        return (this.bits & resolved) !== 0n;
    }

    /**
     * Adds permissions to the bitfield.
     *
     * @param permission - Permission or permissions to add.
     * @returns This bitfield.
     */
    public add(permission: PermissionResolvable): this {
        this.bits |= PermissionsBitField.resolve(permission);

        return this;
    }

    /**
     * Removes permissions from the bitfield.
     *
     * @param permission - Permission or permissions to remove.
     * @returns This bitfield.
     */
    public remove(permission: PermissionResolvable): this {
        this.bits &= ~PermissionsBitField.resolve(permission);

        return this;
    }

    /**
     * Checks whether the bitfield contains no permissions.
     *
     * @returns `true` when the bitfield is empty.
     */
    public isEmpty(): boolean {
        return this.bits === 0n;
    }

    /**
     * Checks whether two bitfields hold the same permissions.
     *
     * @param other - The bitfield to compare with.
     * @returns `true` when both hold the same permissions.
     */
    public equals(other: PermissionResolvable): boolean {
        return this.bits === PermissionsBitField.resolve(other);
    }

    /**
     * Lists the permissions held by the bitfield.
     *
     * @returns The names of the permissions that are present.
     */
    public toArray(): (keyof typeof PermissionFlagsBits)[] {
        const flags = Object.entries(PermissionFlagsBits) as [
            keyof typeof PermissionFlagsBits,
            bigint,
        ][];

        return flags
            .filter(([, value]) => (this.bits & value) === value)
            .map(([name]) => name);
    }

    /**
     * Returns the raw bitfield as a string.
     *
     * @returns The bitfield in base 10.
     */
    public toString(): string {
        return this.bits.toString();
    }

    /**
     * Returns the raw bitfield as a JSON value.
     *
     * @returns The bitfield in base 10.
     */
    public toJSON(): string {
        return this.bits.toString();
    }
}
