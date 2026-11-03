import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { PanelStore, StoredPanel } from './types';

/**
 * In-memory {@link PanelStore} implementation.
 *
 * Stored panels only survive for the lifetime of the process. Use
 * {@link JsonFilePanelStore} or a custom store if panels must survive
 * restarts.
 */
export class MemoryPanelStore implements PanelStore {
    private records: StoredPanel[];

    constructor(initialRecords: readonly StoredPanel[] = []) {
        this.records = [...initialRecords];
    }

    async load(): Promise<readonly StoredPanel[]> {
        return [...this.records];
    }

    async save(panels: readonly StoredPanel[]): Promise<void> {
        this.records = [...panels];
    }
}

/**
 * JSON file backed {@link PanelStore} implementation.
 *
 * Records are written atomically by writing to a temporary file and renaming
 * it over the destination. This avoids leaving a partially written file if
 * the process exits during a save.
 *
 * @example
 * ```ts
 * const manager = new PanelManager(client, {
 *     store: new JsonFilePanelStore('./data/panels.json'),
 * });
 * ```
 */
export class JsonFilePanelStore implements PanelStore {
    /**
     * @param filePath - Path to the JSON file used to persist panel records.
     */
    constructor(public readonly filePath: string) {}

    async load(): Promise<readonly StoredPanel[]> {
        let contents: string;

        try {
            contents = await readFile(this.filePath, 'utf8');
        } catch (error) {
            if (isFileNotFoundError(error)) {
                return [];
            }

            throw error;
        }

        if (!contents.trim()) {
            return [];
        }

        const parsed: unknown = JSON.parse(contents);

        if (!Array.isArray(parsed) || !parsed.every(isStoredPanel)) {
            throw new TypeError(
                `Invalid panel store file: "${this.filePath}".`,
            );
        }

        return parsed as StoredPanel[];
    }

    async save(panels: readonly StoredPanel[]): Promise<void> {
        await mkdir(dirname(this.filePath), { recursive: true });

        const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;

        try {
            await writeFile(
                temporaryPath,
                `${JSON.stringify(panels, null, 4)}\n`,
                'utf8',
            );

            await rename(temporaryPath, this.filePath);
        } finally {
            await rm(temporaryPath, { force: true }).catch(() => undefined);
        }
    }
}

function isFileNotFoundError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'ENOENT'
    );
}

function isStoredPanel(value: unknown): value is StoredPanel {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const record = value as Record<string, unknown>;

    return (
        typeof record.id === 'string' &&
        record.id.length > 0 &&
        typeof record.type === 'string' &&
        record.type.length > 0 &&
        (typeof record.guildId === 'string' || record.guildId === null) &&
        typeof record.channelId === 'string' &&
        record.channelId.length > 0 &&
        typeof record.messageId === 'string' &&
        record.messageId.length > 0
    );
}
