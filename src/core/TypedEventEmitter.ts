import { EventEmitter } from 'node:events';

import type { FrameworkEventMap } from './types';

/**
 * An {@link EventEmitter} with a typed event surface.
 *
 * The framework exposes friendly, named events (see {@link FrameworkEventMap})
 * instead of raw gateway dispatch names. This base class keeps the familiar
 * `on`/`once`/`off`/`emit` surface while making the payload types known.
 */
export class TypedEventEmitter extends EventEmitter {
    /**
     * Registers a listener for a framework event.
     *
     * @param event - Name of the event.
     * @param listener - Listener invoked with the event payload.
     */
    public override on<K extends keyof FrameworkEventMap>(
        event: K,
        listener: (...args: FrameworkEventMap[K]) => void,
    ): this {
        return super.on(event, listener as (...args: unknown[]) => void);
    }

    /**
     * Registers a one-shot listener for a framework event.
     *
     * @param event - Name of the event.
     * @param listener - Listener invoked with the event payload.
     */
    public override once<K extends keyof FrameworkEventMap>(
        event: K,
        listener: (...args: FrameworkEventMap[K]) => void,
    ): this {
        return super.once(event, listener as (...args: unknown[]) => void);
    }

    /**
     * Removes a listener for a framework event.
     *
     * @param event - Name of the event.
     * @param listener - Listener to remove.
     */
    public override off<K extends keyof FrameworkEventMap>(
        event: K,
        listener: (...args: FrameworkEventMap[K]) => void,
    ): this {
        return super.off(event, listener as (...args: unknown[]) => void);
    }

    /**
     * Emits a framework event.
     *
     * @param event - Name of the event.
     * @param args - Event payload.
     */
    public override emit<K extends keyof FrameworkEventMap>(
        event: K,
        ...args: FrameworkEventMap[K]
    ): boolean {
        return super.emit(event, ...args);
    }
}
