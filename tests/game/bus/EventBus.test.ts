import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { EntityId } from '@core/types';
import { EventBus } from '@game/bus/EventBus';
import type { GameEventName, GameEvents } from '@game/events';

type Died = GameEvents['unit:died'];
const died = (id: number): Died => ({ id: id as EntityId, team: 'squad', cause: 'combat' });
const leader = (id: number): GameEvents['squad:leader-changed'] => ({ id: id as EntityId });

/** Records calls as "<label><id>" strings, e.g. "a1". */
function recorder() {
  const calls: string[] = [];
  const make =
    (label: string) =>
    (payload: { readonly id: EntityId }): void => {
      calls.push(`${label}${String(payload.id)}`);
    };
  return { calls, make };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EventBus: on, once, off, emit', () => {
  it('counts listeners per event and in total', () => {
    const bus = new EventBus();
    const a = vi.fn();
    bus.on('unit:died', a).once('unit:died', vi.fn()).on('squad:leader-changed', a);
    expect(bus.listenerCount()).toBe(3);
    expect(bus.listenerCount('unit:died')).toBe(2);
    expect(bus.listenerCount('squad:leader-changed')).toBe(1);
  });

  it('calls listeners in order, and a once listener only on the first emit', () => {
    const bus = new EventBus();
    const { calls, make } = recorder();
    bus.on('unit:died', make('a'));
    bus.once('unit:died', make('b'));
    expect(bus.emit('unit:died', died(1))).toBe(true);
    expect(bus.emit('unit:died', died(2))).toBe(true);
    expect(calls).toEqual(['a1', 'b1', 'a2']);
    expect(bus.listenerCount('unit:died')).toBe(1);
  });

  it('passes the payload through unchanged', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    const payload = died(7);
    bus.on('unit:died', listener);
    bus.emit('unit:died', payload);
    expect(listener).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it('returns false from emit when nobody listens', () => {
    const bus = new EventBus();
    const a = vi.fn();
    expect(bus.emit('unit:died', died(1))).toBe(false);
    bus.on('unit:died', a);
    bus.off('unit:died', a);
    expect(bus.emit('unit:died', died(1))).toBe(false);
    expect(a).not.toHaveBeenCalled();
  });

  it('removes once registrations with off', () => {
    const bus = new EventBus();
    const c = vi.fn();
    bus.once('unit:died', c);
    bus.off('unit:died', c);
    expect(bus.listenerCount('unit:died')).toBe(0);
    bus.emit('unit:died', died(1));
    expect(c).not.toHaveBeenCalled();
  });

  it('only removes the given listener from the given event', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('unit:died', a).on('unit:died', b).on('squad:leader-changed', a);
    bus.off('unit:died', a);
    bus.emit('unit:died', died(1));
    bus.emit('squad:leader-changed', leader(2));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('ignores off for a listener or event that was never registered', () => {
    const bus = new EventBus();
    expect(() => bus.off('unit:died', vi.fn())).not.toThrow();
    bus.on('unit:died', vi.fn());
    bus.off('unit:died', vi.fn());
    expect(bus.listenerCount('unit:died')).toBe(1);
  });
});

describe('EventBus: edge cases (eventemitter3 semantics)', () => {
  it('registers the same function twice when on is called twice; one off removes both', () => {
    const bus = new EventBus();
    const a = vi.fn();
    bus.on('unit:died', a).on('unit:died', a);
    expect(bus.listenerCount('unit:died')).toBe(2);
    bus.emit('unit:died', died(1));
    expect(a).toHaveBeenCalledTimes(2);
    bus.off('unit:died', a);
    expect(bus.listenerCount('unit:died')).toBe(0);
  });

  it('iterates a snapshot: off and on during an emit only take effect from the next emit', () => {
    const bus = new EventBus();
    const calls: string[] = [];
    const late = () => calls.push('late');
    const b = () => calls.push('b');
    const a = () => {
      calls.push('a');
      bus.off('unit:died', a);
      bus.on('unit:died', late);
    };
    bus.on('unit:died', a).on('unit:died', b);
    bus.emit('unit:died', died(1));
    expect(calls).toEqual(['a', 'b']);
    calls.length = 0;
    bus.emit('unit:died', died(2));
    expect(calls).toEqual(['b', 'late']);
  });

  it('still calls a later listener removed by an earlier one in the same emit, not after', () => {
    const bus = new EventBus();
    const calls: string[] = [];
    const c = () => calls.push('c');
    bus.on('unit:died', () => {
      calls.push('a');
      bus.off('unit:died', c);
    });
    bus.on('unit:died', () => calls.push('b'));
    bus.on('unit:died', c);
    bus.emit('unit:died', died(1));
    bus.emit('unit:died', died(2));
    expect(calls.join('')).toBe('abcab');
  });

  it('does not call a re-entrant once listener again (removed before it runs)', () => {
    const bus = new EventBus();
    let calls = 0;
    bus.once('unit:died', () => {
      calls++;
      bus.emit('unit:died', died(2));
    });
    expect(bus.emit('unit:died', died(1))).toBe(true);
    expect(calls).toBe(1);
    expect(bus.listenerCount('unit:died')).toBe(0);
  });

  it('does not call a listener added mid-emit in that emit', () => {
    const bus = new EventBus();
    const added = vi.fn();
    bus.on('unit:died', () => bus.on('unit:died', added));
    bus.emit('unit:died', died(1));
    expect(added).not.toHaveBeenCalled();
    expect(bus.listenerCount('unit:died')).toBe(2);
  });

  it('propagates a throwing listener out of emit and skips the listeners after it', () => {
    const bus = new EventBus();
    const after = vi.fn();
    bus.on('unit:died', () => {
      throw new Error('boom');
    });
    bus.on('unit:died', after);
    expect(() => bus.emit('unit:died', died(1))).toThrow('boom');
    expect(after).not.toHaveBeenCalled();
  });
});

describe('EventBus: destroy', () => {
  it('warns once in dev about leftover listeners, naming each event and count', () => {
    expect(import.meta.env.DEV).toBe(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bus = new EventBus();
    bus.on('squad:leader-changed', vi.fn());
    bus.destroy();
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'EventBus destroyed with listeners still attached: squad:leader-changed ×1',
    );
  });

  it('lists every leftover event in the warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bus = new EventBus();
    bus.on('squad:leader-changed', vi.fn()).on('unit:died', vi.fn()).on('unit:died', vi.fn());
    bus.destroy();
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'EventBus destroyed with listeners still attached: squad:leader-changed ×1, unit:died ×2',
    );
  });

  it('does not warn when every listener was removed first', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bus = new EventBus();
    const a = vi.fn();
    bus.on('unit:died', a);
    bus.off('unit:died', a);
    bus.destroy();
    expect(warn).not.toHaveBeenCalled();
  });

  it('is dead after destroy: no listeners, emit is a no-op, on/once throw, off and destroy are safe', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bus = new EventBus();
    const a = vi.fn();
    bus.on('unit:died', a);
    bus.destroy();
    expect(bus.isDestroyed).toBe(true);
    expect(bus.listenerCount()).toBe(0);
    expect(bus.emit('unit:died', died(1))).toBe(false);
    expect(a).not.toHaveBeenCalled();
    expect(() => bus.on('unit:died', vi.fn())).toThrow('after destroy()');
    expect(() => bus.once('unit:died', vi.fn())).toThrow('after destroy()');
    expect(() => bus.off('unit:died', a)).not.toThrow();
    expect(() => {
      bus.destroy();
    }).not.toThrow();
  });
});

describe('EventBus: types', () => {
  it('types listener payloads per event', () => {
    const bus = new EventBus();
    bus.on('unit:died', (payload) => {
      expectTypeOf(payload).toEqualTypeOf<Died>();
    });
    bus.on('squad:leader-changed', (payload) => {
      expectTypeOf(payload).toEqualTypeOf<GameEvents['squad:leader-changed']>();
    });
  });

  it('rejects mismatched payloads and widened event names at compile time', () => {
    const bus = new EventBus();
    const name = 'squad:leader-changed' as GameEventName;
    // Type-only checks: the emits run on an empty bus and do nothing.
    // @ts-expect-error the payload of unit:died needs team and cause
    bus.emit('unit:died', leader(1));
    // @ts-expect-error a widened name can't be paired with a payload
    bus.emit(name, leader(1));
    // @ts-expect-error listener parameter must match the event payload
    bus.on('squad:leader-changed', (payload: Died) => payload);
    expect(bus.listenerCount()).toBe(1);
  });
});
