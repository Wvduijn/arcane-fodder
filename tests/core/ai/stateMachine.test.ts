import { describe, expect, it } from 'vitest';
import { StateMachine, type StateDefs } from '@core/ai/stateMachine';

type S = 'a' | 'b' | 'c';

/** Context that logs every hook call, and scripts what each update returns. */
interface Ctx {
  log: string[];
  next: Partial<Record<S, S>>;
  /** Leave state `a` once its time in state reaches this. */
  aAfterMs?: number;
}

const ctx = (next: Partial<Record<S, S>> = {}): Ctx => ({ log: [], next });

function defs(): StateDefs<S, Ctx> {
  const make = (name: S) => ({
    enter: (c: Ctx) => c.log.push(`enter ${name}`),
    exit: (c: Ctx) => c.log.push(`exit ${name}`),
    update: (c: Ctx, dt: number, time: number) => {
      c.log.push(`update ${name} ${String(dt)} ${String(time)}`);
      if (name === 'a' && c.aAfterMs !== undefined) return time >= c.aAfterMs ? 'b' : undefined;
      return c.next[name];
    },
  });
  return { a: make('a'), b: make('b'), c: make('c') };
}

describe('StateMachine', () => {
  it('enters the initial state on start with time in state 0', () => {
    const m = new StateMachine(defs());
    const c = ctx();
    expect(m.start('a', c)).toEqual({ current: 'a', timeInStateMs: 0 });
    expect(c.log).toEqual(['enter a']);
  });

  it('accumulates time in state while it stays, and passes dt and time to update', () => {
    const m = new StateMachine(defs());
    const c = ctx();
    let s = m.start('a', c);
    s = m.step(s, c, 16);
    s = m.step(s, c, 20);
    expect(s).toEqual({ current: 'a', timeInStateMs: 36 });
    expect(c.log).toEqual(['enter a', 'update a 16 16', 'update a 20 36']);
  });

  it('runs exit of the old state before enter of the new one, and resets time in state', () => {
    const m = new StateMachine(defs());
    const c = ctx();
    c.aAfterMs = 30;
    let s = m.start('a', c);
    s = m.step(s, c, 16);
    expect(s.current).toBe('a');
    s = m.step(s, c, 16);
    expect(s).toEqual({ current: 'b', timeInStateMs: 0 });
    expect(c.log).toEqual([
      'enter a',
      'update a 16 16',
      'update a 16 32',
      'exit a',
      'enter b',
      'update b 0 0',
    ]);
    s = m.step(s, c, 10);
    expect(s).toEqual({ current: 'b', timeInStateMs: 10 });
  });

  it('follows a transition chain on the same frame, the later states updating with dt 0', () => {
    const m = new StateMachine(defs());
    const c = ctx({ a: 'b', b: 'c' });
    const s = m.step(m.start('a', c), c, 16);
    expect(s).toEqual({ current: 'c', timeInStateMs: 0 });
    expect(c.log).toEqual([
      'enter a',
      'update a 16 16',
      'exit a',
      'enter b',
      'update b 0 0',
      'exit b',
      'enter c',
      'update c 0 0',
    ]);
  });

  it('never loops on one frame: a transition back to a state visited this step is dropped', () => {
    const m = new StateMachine(defs());
    const c = ctx({ a: 'b', b: 'a' });
    let s = m.step(m.start('a', c), c, 16);
    expect(s).toEqual({ current: 'b', timeInStateMs: 0 });
    expect(c.log.filter((l) => l.startsWith('enter'))).toEqual(['enter a', 'enter b']);
    // Next frame, b's request goes through.
    s = m.step(s, c, 16);
    expect(s.current).toBe('a');
  });

  it('treats returning the current state as staying (no exit/enter)', () => {
    const m = new StateMachine(defs());
    const c = ctx({ a: 'a' });
    const s = m.step(m.start('a', c), c, 5);
    expect(s).toEqual({ current: 'a', timeInStateMs: 5 });
    expect(c.log).toEqual(['enter a', 'update a 5 5']);
  });

  it('is deterministic: the same inputs give the same states and hook order', () => {
    const run = () => {
      const m = new StateMachine(defs());
      const c = ctx({ b: 'c', c: 'a' });
      c.aAfterMs = 40;
      let s = m.start('a', c);
      const states: string[] = [];
      for (let i = 0; i < 20; i++) {
        s = m.step(s, c, 7);
        states.push(`${s.current}${String(s.timeInStateMs)}`);
      }
      return { states, log: c.log };
    };
    expect(run()).toEqual(run());
  });

  it('transition() swaps with exit and enter, and is a no-op to the current state', () => {
    const m = new StateMachine(defs());
    const c = ctx();
    let s = m.step(m.start('a', c), c, 50);
    const same = m.transition(s, 'a', c);
    expect(same).toBe(s);
    s = m.transition(s, 'c', c);
    expect(s).toEqual({ current: 'c', timeInStateMs: 0 });
    expect(c.log.slice(-2)).toEqual(['exit a', 'enter c']);
  });

  it('treats a negative or non-finite dt as 0', () => {
    const m = new StateMachine(defs());
    const c = ctx();
    for (const dt of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(m.step(m.start('a', c), c, dt)).toEqual({ current: 'a', timeInStateMs: 0 });
    }
  });

  it('throws on an unknown state everywhere', () => {
    const m = new StateMachine(defs());
    const c = ctx();
    const bad = 'zzz' as S;
    expect(() => m.start(bad, c)).toThrow(RangeError);
    expect(() => m.step({ current: bad, timeInStateMs: 0 }, c, 16)).toThrow(RangeError);
    expect(() => m.transition(m.start('a', c), bad, c)).toThrow(RangeError);
    const returnsBad = ctx({ a: bad });
    expect(() => m.step(m.start('a', returnsBad), returnsBad, 16)).toThrow('Unknown state "zzz"');
  });

  it('works without any hooks', () => {
    const m = new StateMachine<'x' | 'y', null>({ x: {}, y: {} });
    let s = m.start('x', null);
    s = m.step(s, null, 10);
    s = m.transition(s, 'y', null);
    expect(m.step(s, null, 3)).toEqual({ current: 'y', timeInStateMs: 3 });
  });
});
