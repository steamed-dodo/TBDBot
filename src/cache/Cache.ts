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

    /**
     * The ids tracked for eviction, in write order.
     *
     * The key is the eviction bucket: messages are bounded per channel, so
     * their bucket is the channel, and every other kind is bounded as a
     * whole. Keeping the ids in process means a write never has to scan the
     * store to count how many entries a kind holds.
     */
    private readonly eviction = new Map<string, string[]>();

    /**
     * The guild an entry belongs to, keyed by its store key.
     *
     * Channels carry their guild in the cached value rather than in their
     * id, so a reverse index is what lets `delete()` and the sweeper
     * unindex a channel without reading it back from the store.
     */
    private readonly entryGuild = new Map<string, string>();

    /**
     * The entries that belong to a guild, by kind.
     *
     * Channels and members are keyed by their own identity rather than by
     * their guild, so a guild invalidation cannot reach them without an
     * index. The index is what makes `invalidateGuild` complete.
     */
    private readonly guildIndex = new Map<
        string,
        Map<CacheKind, Set<string>>
    >();

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
            await this.removeEntry(kind, id);

            return undefined;
        }

        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
            await this.removeEntry(kind, id);

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

        this.indexEntry(kind, id, value);
        await this.enforceLimits(kind, id);
    }

    /**
     * Removes an entry from the cache.
     *
     * @param kind - The kind of the entry.
     * @param id - The identifier of the entry.
     */
    public async delete(kind: CacheKind, id: string): Promise<void> {
        await this.removeEntry(kind, id);
    }

    /**
     * Removes every entry of a kind from the cache.
     *
     * @param kind - The kind to clear.
     */
    public async clear(kind?: CacheKind): Promise<void> {
        if (kind) {
            const prefix = `${kind}:`;

            for (const key of await this.listKeys(prefix)) {
                await this.store.delete(key);
            }

            for (const [guildId, kinds] of this.guildIndex) {
                const entries = kinds.get(kind);

                if (entries) {
                    for (const id of entries) {
                        this.entryGuild.delete(this.key(kind, id));
                    }

                    kinds.delete(kind);
                }

                if (kinds.size === 0) {
                    this.guildIndex.delete(guildId);
                }
            }

            this.untrackKind(kind);

            return;
        }

        await this.store.clear();
        this.eviction.clear();
        this.entryGuild.clear();
        this.guildIndex.clear();
    }

    /**
     * Removes every entry belonging to a guild.
     *
     * The guild's roles and the guild itself are keyed by the guild ID, and
     * its channels and members are reached through the guild index, so a
     * single invalidation clears all of them.
     *
     * @param guildId - ID of the guild.
     */
    public async invalidateGuild(guildId: string): Promise<void> {
        await this.removeEntry('roles', guildId);
        await this.removeEntry('guild', guildId);

        const kinds = this.guildIndex.get(guildId);

        if (!kinds) {
            return;
        }

        for (const [kind, ids] of kinds) {
            for (const id of [...ids]) {
                await this.removeEntry(kind, id);
            }
        }

        this.guildIndex.delete(guildId);
    }

    /**
     * Reclaims the entries whose lifetime has elapsed.
     */
    public async sweep(): Promise<void> {
        const now = Date.now();

        for (const key of await this.listKeys()) {
            const raw = await this.store.get(key);

            if (raw === undefined) {
                continue;
            }

            let expired = false;

            try {
                const entry = JSON.parse(raw) as CacheEntry;

                expired = entry.expiresAt !== null && entry.expiresAt <= now;
            } catch {
                expired = true;
            }

            if (!expired) {
                continue;
            }

            const parsed = this.splitKey(key);

            if (parsed) {
                await this.removeEntry(parsed.kind, parsed.id);
            } else {
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

    /**
     * Lists the keys of the store in batches.
     *
     * The cursor is walked rather than the whole keyspace materialised in
     * one call, because a remote store must not be asked for a full
     * listing: Redis's `KEYS` blocks the server, and `SCAN` does not.
     *
     * @param prefix - Only keys with this prefix are returned.
     * @returns The matching keys.
     */
    private async listKeys(prefix = ''): Promise<string[]> {
        const keys: string[] = [];
        let cursor = '0';

        do {
            const page = await this.store.scan(cursor);

            cursor = page.cursor;

            for (const key of page.keys) {
                if (key.startsWith(prefix)) {
                    keys.push(key);
                }
            }
        } while (cursor !== '0');

        return keys;
    }

    /**
     * Records which guild an entry belongs to.
     *
     * @param kind - The kind of the entry.
     * @param id - The identifier of the entry.
     * @param value - The cached value.
     */
    private indexEntry(kind: CacheKind, id: string, value: unknown): void {
        const guildId = this.guildOf(kind, id, value);

        if (guildId === null) {
            return;
        }

        this.entryGuild.set(this.key(kind, id), guildId);

        let kinds = this.guildIndex.get(guildId);

        if (!kinds) {
            kinds = new Map();

            this.guildIndex.set(guildId, kinds);
        }

        let entries = kinds.get(kind);

        if (!entries) {
            entries = new Set();

            kinds.set(kind, entries);
        }

        entries.add(id);
    }

    /**
     * Removes an entry from the guild index.
     *
     * The guild is read from the reverse index rather than from the cached
     * value, so this works for every caller — `delete()`, the sweeper and
     * the eviction path — without each one having to fetch the entry first.
     *
     * @param kind - The kind of the entry.
     * @param id - The identifier of the entry.
     */
    private unindexEntry(kind: CacheKind, id: string): void {
        const entryKey = this.key(kind, id);
        const guildId = this.entryGuild.get(entryKey);

        if (guildId === undefined) {
            return;
        }

        this.entryGuild.delete(entryKey);

        const kinds = this.guildIndex.get(guildId);
        const entries = kinds?.get(kind);

        entries?.delete(id);

        if (entries && entries.size === 0) {
            kinds?.delete(kind);
        }

        if (kinds && kinds.size === 0) {
            this.guildIndex.delete(guildId);
        }
    }

    /**
     * The guild an entry belongs to, when it can be determined.
     *
     * @param kind - The kind of the entry.
     * @param id - The identifier of the entry.
     * @param value - The cached value, when it is known.
     * @returns The guild ID, or `null`.
     */
    private guildOf(
        kind: CacheKind,
        id: string,
        value: unknown,
    ): string | null {
        if (kind === 'channel') {
            const guildId = (value as { guild_id?: string } | undefined)
                ?.guild_id;

            return typeof guildId === 'string' ? guildId : null;
        }

        if (kind === 'guildMember') {
            const separator = id.indexOf(':');

            return separator === -1 ? null : id.slice(0, separator);
        }

        return null;
    }

    private async enforceLimits(kind: CacheKind, id: string): Promise<void> {
        const maxSize = this.options[kind]?.maxSize;

        if (maxSize === undefined) {
            return;
        }

        const keys = this.trackForEviction(kind, id);

        while (keys.length > maxSize) {
            const oldest = keys.shift();

            if (!oldest) {
                continue;
            }

            await this.store.delete(this.key(kind, oldest));
            this.unindexEntry(kind, oldest);
        }

        if (keys.length === 0) {
            this.eviction.delete(this.bucketOf(kind, id));
        }
    }

    /**
     * Removes an entry from the store and from every in-process index.
     *
     * @param kind - The kind of the entry.
     * @param id - The identifier of the entry.
     */
    private async removeEntry(kind: CacheKind, id: string): Promise<void> {
        await this.store.delete(this.key(kind, id));
        this.unindexEntry(kind, id);
        this.untrackEntry(kind, id);
    }

    /**
     * The eviction bucket an entry belongs to.
     *
     * Messages are bounded per channel; every other kind is bounded as a
     * whole, so its bucket is the kind itself.
     *
     * @param kind - The kind of the entry.
     * @param id - The identifier of the entry.
     * @returns The bucket key.
     */
    private bucketOf(kind: CacheKind, id: string): string {
        return kind === 'message'
            ? `message:${id.split(':')[0] ?? ''}`
            : kind;
    }

    /**
     * Records an entry as the newest in its eviction bucket.
     *
     * Re-writing an entry moves it to the end rather than adding it twice,
     * so a repeated write cannot make an older copy of the same entry look
     * like the oldest one and evict the current value.
     *
     * @param kind - The kind of the entry.
     * @param id - The identifier of the entry.
     * @returns The bucket's ids, oldest first.
     */
    private trackForEviction(kind: CacheKind, id: string): string[] {
        const bucket = this.bucketOf(kind, id);
        const keys = (this.eviction.get(bucket) ?? []).filter(
            (key) => key !== id,
        );

        keys.push(id);
        this.eviction.set(bucket, keys);

        return keys;
    }

    /**
     * Forgets an entry from its eviction bucket.
     *
     * @param kind - The kind of the entry.
     * @param id - The identifier of the entry.
     */
    private untrackEntry(kind: CacheKind, id: string): void {
        const bucket = this.bucketOf(kind, id);
        const keys = this.eviction.get(bucket);

        if (!keys) {
            return;
        }

        const next = keys.filter((key) => key !== id);

        if (next.length === 0) {
            this.eviction.delete(bucket);
        } else {
            this.eviction.set(bucket, next);
        }
    }

    /**
     * Forgets every eviction bucket of a kind.
     *
     * @param kind - The kind to forget.
     */
    private untrackKind(kind: CacheKind): void {
        if (kind === 'message') {
            for (const bucket of [...this.eviction.keys()]) {
                if (bucket.startsWith('message:')) {
                    this.eviction.delete(bucket);
                }
            }

            return;
        }

        this.eviction.delete(kind);
    }

    /**
     * Splits a store key into the kind and the id it was built from.
     *
     * @param key - The store key.
     * @returns The parts, or `null` when the key is not a cache key.
     */
    private splitKey(key: string): { kind: CacheKind; id: string } | null {
        const separator = key.indexOf(':');

        if (separator === -1) {
            return null;
        }

        const kind = key.slice(0, separator);

        if (!Object.hasOwn(CACHE_DEFAULTS, kind)) {
            return null;
        }

        return { kind: kind as CacheKind, id: key.slice(separator + 1) };
    }
}
