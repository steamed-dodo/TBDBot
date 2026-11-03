import type { PanelFactory } from './types';

/**
 * Registry mapping panel types to the factories used to recreate them during
 * restoration.
 *
 * Factories are registered once per panel type. The panel's `type` property
 * must match the key used here.
 */
export class PanelRegistry {
    private readonly factories = new Map<string, PanelFactory>();

    /**
     * Registers a factory for a panel type.
     *
     * @param type - Panel type handled by the factory.
     * @param factory - Function that recreates a panel from a stored record.
     * @returns This registry, allowing calls to be chained.
     *
     * @throws {TypeError} If the type is empty.
     * @throws {Error} If the type is already registered.
     */
    public define(type: string, factory: PanelFactory): this {
        if (!type.trim()) {
            throw new TypeError('Panel type must not be empty.');
        }

        if (this.factories.has(type)) {
            throw new Error(`Duplicate panel type: "${type}".`);
        }

        this.factories.set(type, factory);

        return this;
    }

    /**
     * Gets the factory registered for a panel type.
     *
     * @param type - Panel type to resolve.
     * @returns The factory, or `undefined` if the type is not registered.
     */
    public resolve(type: string): PanelFactory | undefined {
        return this.factories.get(type);
    }

    /**
     * Checks whether a panel type has a registered factory.
     *
     * @param type - Panel type to check.
     */
    public has(type: string): boolean {
        return this.factories.has(type);
    }

    /**
     * Removes the factory registered for a panel type.
     *
     * @param type - Panel type to remove.
     * @returns `true` if a factory was removed.
     */
    public delete(type: string): boolean {
        return this.factories.delete(type);
    }

    /** Removes every registered factory. */
    public clear(): void {
        this.factories.clear();
    }
}
