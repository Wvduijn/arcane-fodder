import { describe, expect, it } from 'vitest';
import type { EnemyId, EntityId, Vec2 } from '@core/types';
import type { SurgeSpawnObject } from '@core/mission/mapData';
import {
  createSurge,
  recordSurgeSpawn,
  startSurge,
  stepSurge,
  surgeFinished,
  type SurgeOrder,
  type SurgeState,
} from '@core/mission/surge';
import { SURGE } from '@data/mission';

const v = (x: number, y: number): Vec2 => ({ x, y });
const DT = 1000 / 60;

const point = (
  name: string,
  position: Vec2,
  enemy: EnemyId,
  count: number,
  delayMs: number,
  wave = 'surge-01',
): SurgeSpawnObject => ({ name, position, wave, enemy, count, radiusPx: 24, delayMs });

/** The level doc's surge-01: 12 grunts + 4 archers over 8 s. */
const WAVE: SurgeSpawnObject[] = [
  point('surge-rear-01', v(200, 360), 'goblin-grunt', 4, 0),
  point('surge-mid-n-01', v(1000, 200), 'goblin-grunt', 3, 2000),
  point('surge-mid-n-02', v(1032, 208), 'goblin-archer', 1, 2000),
  point('surge-mid-s-01', v(1100, 500), 'goblin-grunt', 3, 4000),
  point('surge-mid-s-02', v(1132, 492), 'goblin-archer', 1, 4000),
  point('surge-bridge-w-01', v(1480, 300), 'goblin-grunt', 2, 6000),
  point('surge-bridge-e-01', v(1680, 320), 'goblin-archer', 2, 8000),
  point('other-wave', v(0, 0), 'goblin-grunt', 9, 0, 'surge-02'),
];

interface Spawned {
  readonly t: number;
  readonly order: SurgeOrder;
  readonly id: EntityId;
}

/** Runs the surge; `wizardsAt(t)` positions the squad; `dies(id, t)` kills spawned enemies. */
function run(
  ms: number,
  wizardsAt: (t: number) => Vec2[] = () => [v(5000, 5000)],
  dies: (s: Spawned, t: number) => boolean = () => false,
  maxAlive: number = SURGE.maxAlive,
  start: SurgeState = startSurge(createSurge(WAVE, 'surge-01', 'always')),
): { spawned: Spawned[]; state: SurgeState; peak: number } {
  let state = start;
  const spawned: Spawned[] = [];
  let next = 1;
  let peak = 0;
  for (let t = DT; t <= ms + 1e-9; t += DT) {
    const step = stepSurge(state, {
      dtMs: DT,
      wizards: wizardsAt(t),
      isAlive: (x) => {
        const s = spawned.find((e) => e.id === x);
        return s !== undefined && !dies(s, t);
      },
      tuning: { ...SURGE, maxAlive },
    });
    state = step.state;
    for (const order of step.orders) {
      const s = { t, order, id: next++ as EntityId };
      spawned.push(s);
      state = recordSurgeSpawn(state, s.id);
    }
    peak = Math.max(peak, spawned.filter((s) => !dies(s, t)).length);
  }
  return { spawned, state, peak };
}

const countBy = (list: Spawned[], key: (s: Spawned) => string) => {
  const out: Record<string, number> = {};
  for (const s of list) out[key(s)] = (out[key(s)] ?? 0) + 1;
  return out;
};

describe('surge schedule (GDD §13)', () => {
  it('does nothing before it starts', () => {
    const r = run(10_000, undefined, undefined, undefined, createSurge(WAVE, 'surge-01', 'always'));
    expect(r.spawned).toEqual([]);
    expect(surgeFinished(r.state)).toBe(false);
  });

  it('only the mission wave, each point at its delayMs, all with aggro always', () => {
    const r = run(9_000, undefined, undefined, 100);
    expect(r.spawned).toHaveLength(16);
    expect(countBy(r.spawned, (s) => s.order.enemy)).toEqual({
      'goblin-grunt': 12,
      'goblin-archer': 4,
    });
    expect(r.spawned.every((s) => s.order.aggro === 'always')).toBe(true);
    const firstAt = (name: string) => r.spawned.find((s) => s.order.point === name)?.t ?? -1;
    for (const p of WAVE.slice(0, 7)) {
      expect(firstAt(p.name)).toBeGreaterThanOrEqual(p.delayMs - 1e-6);
      expect(firstAt(p.name)).toBeLessThan(p.delayMs + DT + 1e-6);
    }
    expect(r.spawned.some((s) => s.order.point === 'other-wave')).toBe(false);
    expect(surgeFinished(r.state)).toBe(true);
  });

  it('skips a point with a wizard closer than 160 px; its share moves to the next point', () => {
    // The squad stands 159 px from the mid-n grunt point when it comes due at 2 s.
    const wizards = () => [v(1000, 200 + 159)];
    const r = run(9_000, wizards, undefined, 100);
    const at = countBy(r.spawned, (s) => s.order.point);
    expect(at['surge-mid-n-01']).toBeUndefined();
    // mid-n-02 (the archer) is 32 px further east: 159.x px away too, so it is skipped as well,
    // and both shares land on mid-s-01 (the next point) at 4 s.
    expect(at['surge-mid-n-02']).toBeUndefined();
    expect(at['surge-mid-s-01']).toBe(3 + 3 + 1);
    expect(r.spawned).toHaveLength(16);
    const moved = r.spawned.filter((s) => s.order.point === 'surge-mid-s-01');
    expect(moved.every((s) => s.t >= 4000 - 1e-6)).toBe(true);
  });

  it('exactly 160 px is far enough', () => {
    const r = run(3_000, () => [v(200, 360 + SURGE.minSpawnDistancePx)], undefined, 100);
    expect(r.spawned.filter((s) => s.order.point === 'surge-rear-01')).toHaveLength(4);
  });

  it('a skipped last point hands its share to the nearest far-enough point', () => {
    // On the east bank, right at the bridge-e point when it comes due.
    const wizards = (t: number) => (t >= 7_900 ? [v(1680, 330)] : [v(5000, 5000)]);
    const r = run(9_000, wizards, undefined, 100);
    const east = r.spawned.filter((s) => s.t >= 8_000);
    expect(east).toHaveLength(2);
    expect(east.every((s) => s.order.enemy === 'goblin-archer')).toBe(true);
    // Nearest point at least 160 px from (1680, 330): bridge-w at (1480, 300), 202 px.
    expect(east.every((s) => s.order.point === 'surge-bridge-w-01')).toBe(true);
    expect(surgeFinished(r.state)).toBe(true);
  });

  it('caps surge enemies alive at maxAlive (12) and releases held spawns as they die', () => {
    const held = run(12_000);
    expect(held.spawned).toHaveLength(SURGE.maxAlive);
    expect(held.peak).toBe(SURGE.maxAlive);
    expect(surgeFinished(held.state)).toBe(false);
    // Kill every surge enemy 3 s after it spawned: the held 4 come out, never above the cap.
    const r = run(20_000, undefined, (s, t) => t >= s.t + 3_000);
    expect(r.spawned).toHaveLength(16);
    expect(r.peak).toBeLessThanOrEqual(SURGE.maxAlive);
    expect(surgeFinished(r.state)).toBe(true);
  });

  it('a held spawn re-checks the distance when it releases', () => {
    // Cap 4: rear-01's 4 spawn at 0; the rest wait. The squad then stands on mid-n when they release.
    const wizards = (t: number) => (t > 1_000 ? [v(1010, 205)] : [v(5000, 5000)]);
    const r = run(12_000, wizards, (s, t) => s.order.point === 'surge-rear-01' && t >= 9_000, 4);
    const late = r.spawned.filter((s) => s.t >= 9_000);
    expect(late.length).toBeGreaterThan(0);
    for (const s of late) {
      expect(
        Math.hypot(s.order.position.x - 1010, s.order.position.y - 205),
      ).toBeGreaterThanOrEqual(SURGE.minSpawnDistancePx);
    }
  });
});
