import type { GameEventName, GameEvents } from '../events';

export type GameEventListener<K extends GameEventName> = (payload: GameEvents[K]) => void;

/**
 * `emit` arguments as a union of [name, payload] pairs, so a name widened to `GameEventName` can't
 * be paired with another event's payload.
 */
type EmitArgs = { [K in GameEventName]: [event: K, payload: GameEvents[K]] }[GameEventName];

interface Registration {
  readonly listener: (payload: never) => void;
  readonly once: boolean;
}

/**
 * Typed game event bus over {@link GameEvents} (plan.md §7.4). Systems talk only through it.
 *
 * Plain TypeScript with no Phaser import, so it can be unit tested under Node. Every event carries
 * exactly one payload object. Semantics match eventemitter3 (Phaser's emitter), which this replaced:
 * - Listeners run in registration order. Registering the same function twice calls it twice;
 *   `off` removes every registration of that function, `on` and `once` alike.
 * - `emit` iterates over a snapshot: a listener removed or added during an emit doesn't change who
 *   is called in that emit (removal never skips the next listener).
 * - A `once` listener is removed before it is called.
 * - Listeners are not isolated: one that throws aborts the rest of that emit, and the error reaches
 *   the emitter's caller (fail fast).
 *
 * One bus per scene run: the scene creates it before its systems and destroys it last on SHUTDOWN,
 * after every system has removed its own listeners. `destroy()` drops anything left over and, in
 * dev builds, warns about it (some system forgot its `off()`). After that, `emit` is a no-op (late
 * teardown emits are harmless) and `on`/`once` throw, because a listener added to a dead bus is a
 * leak or a lifecycle bug.
 */
export class EventBus {
  private readonly registrations = new Map<GameEventName, Registration[]>();
  private destroyed = false;

  on<K extends GameEventName>(event: K, listener: GameEventListener<K>): this {
    return this.add(event, listener, false);
  }

  once<K extends GameEventName>(event: K, listener: GameEventListener<K>): this {
    return this.add(event, listener, true);
  }

  /** Removes `listener` (both `on` and `once` registrations). Safe after destroy. */
  off<K extends GameEventName>(event: K, listener: GameEventListener<K>): this {
    const list = this.registrations.get(event);
    if (!list) return this;
    const kept = list.filter((registration) => registration.listener !== listener);
    if (kept.length > 0) this.registrations.set(event, kept);
    else this.registrations.delete(event);
    return this;
  }

  /** @returns true if the event had listeners. */
  emit(...[event, payload]: EmitArgs): boolean {
    if (this.destroyed) return false;
    const list = this.registrations.get(event);
    if (!list) return false;

    const snapshot = [...list];
    if (snapshot.some((registration) => registration.once)) {
      const kept = list.filter((registration) => !registration.once);
      if (kept.length > 0) this.registrations.set(event, kept);
      else this.registrations.delete(event);
    }
    // Each registration was added for this event, so its listener takes this payload.
    for (const { listener } of snapshot) (listener as (p: typeof payload) => void)(payload);
    return true;
  }

  /** Listeners for one event, or for all events when omitted (the restart leak check). */
  listenerCount(event?: GameEventName): number {
    if (event !== undefined) return this.registrations.get(event)?.length ?? 0;
    let total = 0;
    for (const list of this.registrations.values()) total += list.length;
    return total;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (import.meta.env.DEV && this.registrations.size > 0) {
      const leftover = [...this.registrations].map(
        ([name, list]) => `${name} ×${String(list.length)}`,
      );
      console.warn(`EventBus destroyed with listeners still attached: ${leftover.join(', ')}`);
    }
    this.registrations.clear();
  }

  private add<K extends GameEventName>(
    event: K,
    listener: GameEventListener<K>,
    once: boolean,
  ): this {
    if (this.destroyed) throw new Error(`EventBus: listener added to "${event}" after destroy()`);
    const list = this.registrations.get(event);
    const registration: Registration = { listener, once };
    if (list) list.push(registration);
    else this.registrations.set(event, [registration]);
    return this;
  }
}
