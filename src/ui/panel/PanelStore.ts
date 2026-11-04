import { JsonFileStore, MemoryStore } from '../../store/index';
import type { Store } from '../../store/index';
import type { PanelStore, StoredPanel } from './types';

/**
 * Key used by the store-backed panel stores.
 */
const PANELS_KEY = 'panels';

/**
 * In-memory {@link PanelStore} implementation.
 *
 * Stored panels only survive for the lifetime of the process.
 */
export class MemoryPanelStore implements PanelStore {
    private readonly store: Store<readonly StoredPanel[]>;

    /**
     * @param initialRecords - Records the store starts with.
     */
    constructor(initialRecords: readonly StoredPanel[] = []) {
        this.store = new MemoryStore<readonly StoredPanel[]>([
            [PANELS_KEY, [...initialRecords]],
        ]);
    }

    async load(): Promise<readonly StoredPanel[]> {
        const records = await this.store.get(PANELS_KEY);

        return records ? [...records] : [];
    }

    async save(panels: readonly StoredPanel[]): Promise<void> {
        await this.store.set(PANELS_KEY, [...panels]);
    }
}

/**
 * JSON file backed {@link PanelStore} implementation.
 *
 * Records are written atomically, so a crash during a write cannot leave a
 * partially written file behind.
 *
 * @example
 * ```ts
 * const manager = new PanelManager({
 *     api,
 *     router,
 *     store: new JsonFilePanelStore('./data/panels.json'),
 * });
 * ```
 */
export class JsonFilePanelStore implements PanelStore {
    private readonly store: Store<readonly StoredPanel[]>;

    /**
     * @param filePath - Path to the JSON file used to persist panel records.
     */
    constructor(public readonly filePath: string) {
        this.store = new JsonFileStore<readonly StoredPanel[]>(filePath);
    }

    async load(): Promise<readonly StoredPanel[]> {
        const records = await this.store.get(PANELS_KEY);

        return records ? [...records] : [];
    }

    async save(panels: readonly StoredPanel[]): Promise<void> {
        await this.store.set(PANELS_KEY, [...panels]);
    }
}
