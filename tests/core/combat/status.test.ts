import { describe, expect, it } from 'vitest';
import type { EntityId } from '@core/types';
import { applyHit } from '@core/combat/damage';
import { applyStatus, stepStatuses } from '@core/combat/status';
import { CombatWorld } from '@core/combat/world';
import { COMBAT, GIBS } from '@data/combat';
import { STATUSES } from '@data/statuses';

const id = (n: number) => n as EntityId;
const BURNING = STATUSES.burning;
const PYRO = id(100);

function world(...hp: number[]): CombatWorld {
  const w = new CombatWorld();
  hp.forEach((maxHp, i) => w.add({ id: id(i + 1), team: 'enemy', maxHp, bodyRadiusPx: 12 }));
  return w;
}

interface Run {
  tickTimes: number[];
  damage: number;
  expiredAt: number | null;
}

/**
 * The scene's frame order: frame i ends at t = i × dt; its combat phase lands the hits due by t
 * (Burning at 0, then each `reapplyAt`), then its status phase steps dt and applies the ticks.
 */
function run(dtMs: number, endMs: number, reapplyAt: number[] = [], w = world(1000)): Run {
  const out: Run = { tickTimes: [], damage: 0, expiredAt: null };
  const pending = [0, ...reapplyAt];
  for (let i = 0; i * dtMs <= endMs + 1e-9; i++) {
    const t = i * dtMs;
    while (pending[0] !== undefined && pending[0] <= t + 1e-9) {
      pending.shift();
      applyStatus(w, id(1), BURNING, PYRO);
    }
    const step = stepStatuses(w, STATUSES, dtMs);
    for (const tick of step.ticks) {
      const r = applyHit(w, tick.target, tick.hit, GIBS);
      if (r.landed) {
        out.tickTimes.push(t);
        out.damage += r.dealt;
      }
    }
    if (step.expired.length > 0) out.expiredAt = t;
  }
  return out;
}

/** Applies Burning as a hit in a frame of `dtMs`, then runs that frame's status step. */
function applyInFrame(w: CombatWorld, n = 1, dtMs = 1000 / 60) {
  const result = applyStatus(w, id(n), BURNING, PYRO);
  stepStatuses(w, STATUSES, dtMs);
  return result;
}

describe('Burning (GDD §6)', () => {
  it('a single apply ticks 6 times for 18, then expires at durationMs', () => {
    const r = run(100, 5000);
    expect(r.tickTimes).toEqual([500, 1000, 1500, 2000, 2500, 3000]);
    expect(r.damage).toBe(18);
    expect(r.expiredAt).toBe(3000);
  });

  it('GDD §6 verify: apply 0, reapply 1200 → ticks 500 … 4000, 8 ticks, 24 damage', () => {
    const r = run(100, 6000, [1200]);
    expect(r.tickTimes).toEqual([500, 1000, 1500, 2000, 2500, 3000, 3500, 4000]);
    expect(r.damage).toBe(24);
    expect(r.expiredAt).toBe(4200);
  });

  it.each([30, 60, 144])('GDD §6 verify holds at %i fps (each tick within one frame)', (fps) => {
    const dt = 1000 / fps;
    const r = run(dt, 6000, [1200]);
    expect(r.tickTimes).toHaveLength(8);
    expect(r.damage).toBe(24);
    r.tickTimes.forEach((t, k) => {
      const ideal = BURNING.tickMs * (k + 1);
      expect(t).toBeGreaterThanOrEqual(ideal - 1e-6);
      expect(t).toBeLessThan(ideal + dt + 1e-6);
    });
  });

  it('does not tick on apply', () => {
    const w = world(100);
    expect(applyInFrame(w)).toBe('applied');
    expect(stepStatuses(w, STATUSES, BURNING.tickMs - 1).ticks).toEqual([]);
    expect(w.get(id(1))?.hp).toBe(100);
    expect(stepStatuses(w, STATUSES, 1).ticks).toHaveLength(1);
  });

  it.each([30, 60, 144, 1000 / COMBAT.maxFrameDtMs])(
    'scene order at %f fps: first tick exactly tickMs after the hit, a refresh lasts exactly durationMs',
    (fps) => {
      const dt = 1000 / fps;
      const w = world(1000);
      // The hit lands in a frame whose dt elapsed before it: that dt must not count.
      applyInFrame(w, 1, dt);
      expect(w.get(id(1))?.statuses.get('burning')).toMatchObject({
        remainingMs: BURNING.durationMs,
        nextTickInMs: BURNING.tickMs,
        appliedThisFrame: null,
      });
      stepStatuses(w, STATUSES, 200);
      // Refresh: the phase keeps moving through the frame, the duration restarts at the hit.
      applyInFrame(w, 1, dt);
      expect(w.get(id(1))?.statuses.get('burning')?.remainingMs).toBeCloseTo(BURNING.durationMs, 9);
      expect(w.get(id(1))?.statuses.get('burning')?.nextTickInMs).toBeCloseTo(
        BURNING.tickMs - 200 - dt,
        9,
      );
    },
  );

  it('applied and refreshed in the same frame still counts as a fresh apply', () => {
    const w = world(1000);
    expect(applyStatus(w, id(1), BURNING, PYRO)).toBe('applied');
    expect(applyStatus(w, id(1), BURNING, PYRO)).toBe('refreshed');
    stepStatuses(w, STATUSES, 50);
    expect(w.get(id(1))?.statuses.get('burning')).toMatchObject({
      remainingMs: BURNING.durationMs,
      nextTickInMs: BURNING.tickMs,
    });
  });

  it('reapply refreshes without stacking: fast refreshing never buys extra ticks', () => {
    const w = world(1000);
    expect(applyInFrame(w, 1, 50)).toBe('applied');
    let ticks = 0;
    for (let t = 0; t < 2000; t += 50) {
      expect(applyStatus(w, id(1), BURNING, PYRO)).toBe('refreshed');
      ticks += stepStatuses(w, STATUSES, 50).ticks.length;
    }
    // Still one instance, ticking once per tickMs: 2000 / 500 = 4.
    expect(w.get(id(1))?.statuses.size).toBe(1);
    expect(ticks).toBe(4);
  });

  it('returns ticks as fire hits credited to the applier, so a tick kill is charred', () => {
    const w = world(2);
    applyInFrame(w);
    const [tick] = stepStatuses(w, STATUSES, BURNING.tickMs).ticks;
    expect(tick?.hit).toEqual({ element: 'fire', damage: 3, canGib: false, sourceId: PYRO });
    if (!tick) throw new Error('expected a tick');
    const r = applyHit(w, tick.target, tick.hit, GIBS);
    expect(r).toMatchObject({ dealt: 2, killed: true, death: { deathVariant: 'charred' } });
  });

  it('reports expiry once, then the status is gone', () => {
    const w = world(1000);
    applyInFrame(w);
    const step = stepStatuses(w, STATUSES, BURNING.durationMs);
    expect(step.expired).toEqual([{ id: 1, status: 'burning' }]);
    expect(w.get(id(1))?.statuses.size).toBe(0);
    expect(stepStatuses(w, STATUSES, 1000)).toEqual({ ticks: [], expired: [] });
  });

  it('a large dt gives the same ticks as small steps', () => {
    const w = world(1000);
    applyInFrame(w);
    const step = stepStatuses(w, STATUSES, 10_000);
    expect(step.ticks).toHaveLength(6);
    expect(step.expired).toHaveLength(1);
  });

  it('is removed on death, never ticks a dead unit, and death does not report expiry', () => {
    const w = world(1000);
    applyInFrame(w);
    stepStatuses(w, STATUSES, 600);
    applyHit(w, id(1), { element: 'physical', damage: 5000, canGib: false, sourceId: null }, GIBS);
    expect(w.get(id(1))?.statuses.size).toBe(0);
    expect(stepStatuses(w, STATUSES, 5000)).toEqual({ ticks: [], expired: [] });
  });

  it('a later tick in the same step is a no-op once an earlier one killed', () => {
    const w = world(4);
    applyInFrame(w);
    const { ticks } = stepStatuses(w, STATUSES, 1000);
    expect(ticks).toHaveLength(2);
    const results = ticks.map((t) => applyHit(w, t.target, t.hit, GIBS));
    expect(results.map((r) => [r.dealt, r.killed, r.landed])).toEqual([
      [3, false, true],
      [1, true, true],
    ]);
    const after = stepStatuses(w, STATUSES, 1000);
    expect(after.ticks).toEqual([]);
  });

  it('a tick exactly at expiry that kills is a death, not an expiry (status:expired contract)', () => {
    const w = world(BURNING.tickDamage * 6, BURNING.tickDamage * 6 + 1);
    applyInFrame(w, 1);
    applyStatus(w, id(2), BURNING, PYRO);
    stepStatuses(w, STATUSES, 0.0001);
    // Unit 2 went one frame later; step both so each reaches its last tick at expiry.
    const step = stepStatuses(w, STATUSES, BURNING.durationMs);
    expect(step.ticks.filter((t) => t.target === id(1))).toHaveLength(6);
    const results = step.ticks.map((t) => applyHit(w, t.target, t.hit, GIBS));
    expect(results.filter((r) => r.killed).map((r) => r.target)).toEqual([1]);
    // Unit 1 died from its last tick: not expired. Unit 2 survived on 1 HP: expired.
    expect(step.expired).toEqual([{ id: 2, status: 'burning' }]);
    expect(w.isAlive(id(2))).toBe(true);
  });

  it('a tick kill earlier in a long step is not an expiry either', () => {
    const w = world(BURNING.tickDamage * 2);
    applyInFrame(w);
    const step = stepStatuses(w, STATUSES, 10_000);
    expect(step.expired).toEqual([]);
    const results = step.ticks.map((t) => applyHit(w, t.target, t.hit, GIBS));
    expect(results.filter((r) => r.killed)).toHaveLength(1);
  });

  it('stores the applier as the ticks’ source; a refresh replaces it', () => {
    const w = world(1000);
    applyInFrame(w);
    applyStatus(w, id(1), BURNING, id(200));
    const { ticks } = stepStatuses(w, STATUSES, BURNING.tickMs);
    expect(ticks.map((t) => t.hit.sourceId)).toEqual([200]);
  });

  it('cannot be applied to a dead or unknown unit', () => {
    const w = world(5);
    applyHit(w, id(1), { element: 'physical', damage: 5, canGib: false, sourceId: null }, GIBS);
    expect(applyStatus(w, id(1), BURNING, PYRO)).toBeNull();
    expect(applyStatus(w, id(9), BURNING, PYRO)).toBeNull();
    expect(w.get(id(1))?.statuses.size).toBe(0);
  });

  it('steps units in ascending EntityId order', () => {
    const w = world(100, 100, 100);
    for (const n of [3, 1, 2]) applyInFrame(w, n);
    const { ticks } = stepStatuses(w, STATUSES, BURNING.tickMs);
    expect(ticks.map((t) => t.target)).toEqual([1, 2, 3]);
  });

  it('ignores dt <= 0', () => {
    const w = world(100);
    applyStatus(w, id(1), BURNING, PYRO);
    expect(stepStatuses(w, STATUSES, 0)).toEqual({ ticks: [], expired: [] });
    expect(w.get(id(1))?.statuses.get('burning')?.remainingMs).toBe(BURNING.durationMs);
  });

  it('throws on a def with tickMs <= 0 instead of looping forever', () => {
    const w = world(100);
    applyInFrame(w);
    expect(() => stepStatuses(w, { burning: { ...BURNING, tickMs: 0 } }, 100)).toThrow(RangeError);
  });
});
