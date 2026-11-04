import { EventEmitter } from 'node:events';

import type { FrameworkEventMap } from './types';

/**
 * An {@link EventEmitter} with a typed event surface.
 *
 * The framework exposes friendly, named events (see {@link FrameworkEventMap})
 * instead of raw gateway dispatch names. This base class keeps the familiar
 * `on`/`once`/`off`/`emit` surface while making the payload types known.
 *
 * Events the framework does not type are still reachable: they are re-emitted
 * under their raw dispatch name, and the untyped overloads of `on`, `once`
 * and `off` accept them.
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
    ): this;

    /**
     * Registers a listener for a raw dispatch event.
     *
     * @param event - Raw dispatch name, for example `GUILD_BAN_ADD`.
     * @param listener - Listener invoked with the raw payload.
     */
    public override on(
        event: string,
        listener: (...args: never[]) => void,
    ): this;

    public override on(
        event: string,
        listener: (...args: never[]) => void,
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
    ): this;

    /**
     * Registers a one-shot listener for a raw dispatch event.
     *
     * @param event - Raw dispatch name.
     * @param listener - Listener invoked with the raw payload.
     */
    public override once(
        event: string,
        listener: (...args: never[]) => void,
    ): this;

    public override once(
        event: string,
        listener: (...args: never[]) => void,
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
    ): this;

    /**
     * Removes a listener for a raw dispatch event.
     *
     * @param event - Raw dispatch name.
     * @param listener - Listener to remove.
     */
    public override off(
        event: string,
        listener: (...args: never[]) => void,
    ): this;

    public override off(
        event: string,
        listener: (...args: never[]) => void,
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
    ): boolean;

    /**
     * Emits a raw dispatch event.
     *
     * @param event - Raw dispatch name.
     * @param payload - Raw payload.
     */
    public override emit(event: string, payload: unknown): boolean;

    public override emit(event: string, ...args: unknown[]): boolean {
        return super.emit(event, ...args);
    }

    /**
     * Emits a raw dispatch event.
     *
     * This is how the router passes through the dispatches the framework
     * does not type.
     *
     * @param event - Raw dispatch name.
     * @param payload - Raw payload.
     */
    public emitRaw(event: string, payload: unknown): boolean {
        return super.emit(event, payload);
    }
}
