import { MemoryStore } from '../store/memory';
import type { Store } from '../store/types';
import {
    CACHE_DEFAULTS,
    DEFAULT_SWEEP_INTERVAL,
    MINIMAL_TIER_KINDS,
} from './types';
import type { CacheKind, CacheKindOptions, CacheTier } from './types';

/**
 * An entry stored in the cache.
 */
interface CacheEntry<TValue = unknown> {
    /** The cached value. */
    readonly value: TValue;

    /** Timestamp, in milliseconds, at which the entry was written. */
    readonly storedAt: number;

    /** Timestamp, in milliseconds, at which the entry expires. */
    readonly expiresAt: number | null;
}

/**
 * Configuration options used to construct a {@link Cache}.
 */
export interface CacheOptions {
    /**
     * The tier of the cache.
     *
     * @defaultValue 'minimal'
     */
    readonly tier?: CacheTier;

    /**
     * The store the entries are kept in.
     *
     * @defaultValue A new in-memory store.
     */
    readonly store?: Store<string>;

    /**
     * Per-kind configuration, overriding the tier defaults.
     */
    readonly kinds?: Partial<Record<CacheKind, Partial<CacheKindOptions>>>;

    /**
     * How often expired entries are reclaimed, in milliseconds.
     *
     * @defaultValue 3600000
     */
    readonly sweepInterval?: number;

    /**
     * Whether the sweep timer is started automatically.
     *
     * @defaultValue true
     */
    readonly autoSweep?: boolean;
}

/**
 * A two-tier cache with pluggable stores.
 *
 * The tiering exists because the two use cases have genuinely different
 * requirements: permission checks need the role and overwrite lookups, and
 * everything else is a deliberate memory cost that the user has to opt into.
 */
export class Cache {
    /** The tier of the cache. */
    public readonly tier: CacheTier;

    /** The store the entries are kept in. */
    public readonly store: Store<string>;

    private readonly options: Record<CacheKind, CacheKindOptions>;

    private readonly sweepInterval: number;

    private readonly messageKeys = new Map<string, string[]>();

    private timer: ReturnType<typeof setInterval> | null = null;

    /**
     * @param options - Cache configuration.
     */
    constructor(options: CacheOptions = {}) {
        this.tier = options.tier ?? 'minimal';
        this.store = options.store ?? new MemoryStore<string>();
        this.sweepInterval = options.sweepInterval ?? DEFAULT_SWEEP_INTERVAL;

        this.options = {} as Record<CacheKind, CacheKindOptions>;

        for (const kind of Object.keys(CACHE_DEFAULTS) as CacheKind[]) {
            const defaults = CACHE_DEFAULTS[kind];
            const enabled =
                this.tier === 'inclusive' || MINIMAL_TIER_KINDS.includes(kind);

            this.options[kind] = {
                ...defaults,
                enabled,
                ...(options.kinds?.[kind] ?? {}),
            };
        }

        if (options.autoSweep !== false) {
            this.startSweeper();
        }
    }

    /**
     * Checks whether a kind is cached.
     *
     * @param kind - The kind to check.
     */
    public isEnabled(kind: CacheKind): boolean {
        return this.options[kind]?.enabled ?? false;
    }

    /**
     * Reads a cached value.
     *
     * @param kind - The kind of the entry.
     * @param id - The identifier of the entry.
     * @returns The cached value, or `undefined` when it is not cached.
     */
    public async get<TValue = unknown>(
        kind: CacheKind,
        id: string,
    ): Promise<TValue | undefined> {
        if (!this.isEnabled(kind)) {
            return undefined;
        }

        const raw = await this.store.get(this.key(kind, id));

        if (raw === undefined) {
            return undefined;
        }

        let entry: CacheEntry<TValue>;

        try {
            entry = JSON.parse(raw) as CacheEntry<TValue>;
        } catch {
            await this.store.delete(this.key(kind, id));

            return undefined;
        }

        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
            await this.store.delete(this.key(kind, id));

            return undefined;
        }

        return entry.value;
    }

    /**
     * Writes a value to the cache.
     *
     * @param kind - The kind of the entry.
     * @param id - The identifier of the entry.
     * @param value - The value to cache.
     */
    public async set<TValue = unknown>(
        kind: CacheKind,
        id: string,
        value: TValue,
    ): Promise<void> {
        if (!this.isEnabled(kind)) {
            return;
        }

        const options = this.options[kind];
        const now = Date.now();

        const entry: CacheEntry<TValue> = {
            value,
            storedAt: now,
            expiresAt: options.ttl === undefined ? null : now + options.ttl,
        };

        await this.store.set(this.key(kind, id), JSON.stringify(entry));

        await this.enforceLimits(kind, id);
    }

    /**
     * Removes an entry from the cache.
     *
     * @param kind - The kind of the entry.
     * @param id - The identifier of the entry.
     */
    public async delete(kind: CacheKind, id: string): Promise<void> {
        await this.store.delete(this.key(kind, id));

        if (kind === 'message') {
            const channelId = id.split(':')[0];

            if (channelId) {
                const keys = this.messageKeys.get(channelId);

                if (keys) {
                    const filtered = keys.filter((key) => key !== id);

                    if (filtered.length === 0) {
                        this.messageKeys.delete(channelId);
                    } else {
                        this.messageKeys.set(channelId, filtered);
                    }
                }
            }
        }
    }

    /**
     * Removes every entry of a kind from the cache.
     *
     * @param kind - The kind to clear.
     */
    public async clear(kind?: CacheKind): Promise<void> {
        if (kind) {
            const prefix = `${kind}:`;

            for (const key of await this.store.keys()) {
                if (key.startsWith(prefix)) {
                    await this.store.delete(key);
                }
            }

            if (kind === 'message') {
                this.messageKeys.clear();
            }

            return;
        }

        await this.store.clear();
        this.messageKeys.clear();
    }

    /**
     * Removes every entry belonging to a guild.
     *
     * @param guildId - ID of the guild.
     */
    public async invalidateGuild(guildId: string): Promise<void> {
        await this.store.delete(this.key('roles', guildId));
        await this.store.delete(this.key('guild', guildId));
        await this.store.delete(this.key('guildMember', guildId));
    }

    /**
     * Reclaims the entries whose lifetime has elapsed.
     */
    public async sweep(): Promise<void> {
        const now = Date.now();

        for (const key of await this.store.keys()) {
            const raw = await this.store.get(key);

            if (raw === undefined) {
                continue;
            }

            try {
                const entry = JSON.parse(raw) as CacheEntry;

                if (entry.expiresAt !== null && entry.expiresAt <= now) {
                    await this.store.delete(key);
                }
            } catch {
                await this.store.delete(key);
            }
        }
    }

    /** Stops the sweep timer. */
    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private startSweeper(): void {
        if (this.timer) {
            return;
        }

        this.timer = setInterval(() => {
            void this.sweep();
        }, this.sweepInterval);

        this.timer.unref?.();
    }

    private key(kind: CacheKind, id: string): string {
        return `${kind}:${id}`;
    }

    private async enforceLimits(kind: CacheKind, id: string): Promise<void> {
        const maxSize = this.options[kind]?.maxSize;

        if (maxSize === undefined) {
            return;
        }

        if (kind !== 'message') {
            const prefix = `${kind}:`;
            const keys = (await this.store.keys()).filter((key) =>
                key.startsWith(prefix),
            );

            while (keys.length > maxSize) {
                const oldest = keys.shift();

                if (oldest) {
                    await this.store.delete(oldest);
                }
            }

            return;
        }

        const channelId = id.split(':')[0] ?? '';
        const keys = this.messageKeys.get(channelId) ?? [];

        keys.push(id);

        while (keys.length > maxSize) {
            const oldest = keys.shift();

            if (oldest) {
                await this.store.delete(this.key(kind, oldest));
            }
        }

        this.messageKeys.set(channelId, keys);
    }
}
