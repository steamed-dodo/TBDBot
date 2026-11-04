/**
 * The kinds of data the cache can hold.
 */
export type CacheKind =
    | 'roles'
    | 'channel'
    | 'guild'
    | 'guildMember'
    | 'user'
    | 'message'
    | 'thread'
    | 'invite';

/**
 * The configuration of a single cache kind.
 */
export interface CacheKindOptions {
    /** Whether the kind is cached at all. */
    readonly enabled: boolean;

    /**
     * How long an entry lives, in milliseconds.
     *
     * When omitted, entries are retained for the lifetime of the process,
     * which is what `discord.js` does for the kinds it does not sweep.
     */
    readonly ttl?: number;

    /**
     * Maximum number of entries kept for the kind.
     *
     * For messages the limit applies per channel.
     */
    readonly maxSize?: number;
}

/**
 * The cache tiers.
 *
 * - `minimal`: the two lookups permission checks need. On by default.
 * - `inclusive`: the caches `discord.js` keeps, with the same limits.
 */
export type CacheTier = 'minimal' | 'inclusive';

/**
 * The default configuration of every cache kind.
 *
 * The inclusive tier matches `discord.js`: messages are bounded by count,
 * threads and invites are bounded by age, and everything else is retained
 * for the lifetime of the process.
 */
export const CACHE_DEFAULTS: Record<CacheKind, CacheKindOptions> = {
    roles: { enabled: true },
    channel: { enabled: true },
    guild: { enabled: false },
    guildMember: { enabled: false },
    user: { enabled: false },
    message: { enabled: false, maxSize: 200, ttl: 3_600_000 },
    thread: { enabled: false, ttl: 14_400_000 },
    invite: { enabled: false, ttl: 14_400_000 },
};

/**
 * The kinds enabled by the minimal tier.
 */
export const MINIMAL_TIER_KINDS: readonly CacheKind[] = ['roles', 'channel'];

/**
 * The default sweep interval, in milliseconds.
 *
 * `discord.js` sweeps hourly, and the framework does the same so that the
 * observable contract — an entry lives no longer than its lifetime plus one
 * sweep interval — matches.
 */
export const DEFAULT_SWEEP_INTERVAL = 3_600_000;
