import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Store } from './types';

/**
 * JSON file backed {@link Store} implementation.
 *
 * The whole file is rewritten on every write. Writes are atomic: the data is
 * written to a temporary file which is then renamed over the destination, so
 * a crash during a write cannot leave a partially written file behind.
 */
export class JsonFileStore<TValue = unknown> implements Store<TValue> {
    private cache: Record<string, TValue> | null = null;

    /**
     * @param filePath - Path to the JSON file used to persist the values.
     */
    constructor(public readonly filePath: string) {}

    async get(key: string): Promise<TValue | undefined> {
        const values = await this.read();

        return values[key];
    }

    async set(key: string, value: TValue): Promise<void> {
        const values = await this.read();

        values[key] = value;

        await this.write(values);
    }

    async delete(key: string): Promise<void> {
        const values = await this.read();

        if (!(key in values)) {
            return;
        }

        delete values[key];

        await this.write(values);
    }

    async keys(): Promise<string[]> {
        return Object.keys(await this.read());
    }

    async has(key: string): Promise<boolean> {
        return key in (await this.read());
    }

    async clear(): Promise<void> {
        await this.write({});
    }

    private async read(): Promise<Record<string, TValue>> {
        if (this.cache) {
            return this.cache;
        }

        let contents: string;

        try {
            contents = await readFile(this.filePath, 'utf8');
        } catch (error) {
            if (isFileNotFoundError(error)) {
                this.cache = {};

                return this.cache;
            }

            throw error;
        }

        if (!contents.trim()) {
            this.cache = {};

            return this.cache;
        }

        const parsed: unknown = JSON.parse(contents);

        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new TypeError(`Invalid store file: "${this.filePath}".`);
        }

        this.cache = parsed as Record<string, TValue>;

        return this.cache;
    }

    private async write(values: Record<string, TValue>): Promise<void> {
        await mkdir(dirname(this.filePath), { recursive: true });

        const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;

        try {
            await writeFile(
                temporaryPath,
                `${JSON.stringify(values, null, 4)}\n`,
                'utf8',
            );

            await rename(temporaryPath, this.filePath);
        } finally {
            await rm(temporaryPath, { force: true }).catch(() => undefined);
        }

        this.cache = values;
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
