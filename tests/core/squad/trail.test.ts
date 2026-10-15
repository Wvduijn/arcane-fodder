import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@core/types';
import { distance } from '@core/math/vec2';
import {
  advanceTrail,
  createTrail,
  pointAtDistance,
  rebaseTo,
  seedStraight,
  trailKeepLengthPx,
  trailLength,
  type Trail,
} from '@core/squad/trail';
import { TRAIL } from '@data/trail';

const v = (x: number, y: number): Vec2 => ({ x, y });
const options = { spacingPx: 4, keepLengthPx: 1000 };

/** Walks the head in a straight line from its position at `speed` px/s for `ms`, in steps of `dtMs`. */
function walk(trail: Trail, dir: Vec2, speed: number, ms: number, dtMs: number): Trail {
  let t = trail;
  for (let elapsed = 0; elapsed < ms; elapsed += dtMs) {
    const step = (speed * dtMs) / 1000;
    t = advanceTrail(t, v(t.head.x + dir.x * step, t.head.y + dir.y * step));
  }
  return t;
}

function expectClose(a: Vec2, b: Vec2, digits = 9): void {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
}

describe('createTrail', () => {
  it('starts with one crumb at the head', () => {
    const t = createTrail(options, v(5, 6));
    expect(t.head).toEqual(v(5, 6));
    expect(t.crumbs).toEqual([v(5, 6)]);
    expect(t.headArcPx).toBe(0);
    expect(trailLength(t)).toBe(0);
  });

  it('rejects a non-positive spacing', () => {
    expect(() => createTrail({ spacingPx: 0, keepLengthPx: 10 }, v(0, 0))).toThrow(RangeError);
  });
});

describe('advanceTrail', () => {
  it.each([1000 / 144, 1000 / 60, 1000 / 30, 100, 250])(
    'drops crumbs exactly spacing apart on a straight walk at dt %f ms',
    (dt) => {
      const t = walk(createTrail(options, v(0, 0)), v(1, 0), 110, 1000, dt);
      const xs = [...t.crumbs].reverse().map((c) => c.x);
      xs.forEach((x, i) => {
        expect(x).toBeCloseTo(i * 4, 6);
      });
      expect(t.crumbs.every((c) => c.y === 0)).toBe(true);
      expect(t.headArcPx).toBeGreaterThanOrEqual(0);
      expect(t.headArcPx).toBeLessThan(4);
      expect(trailLength(t)).toBeCloseTo(t.head.x, 6);
    },
  );

  it('gives the same crumbs on a straight line regardless of frame rate', () => {
    const fast = walk(createTrail(options, v(0, 0)), v(0.6, 0.8), 110, 1000, 1000 / 144);
    const slow = walk(createTrail(options, v(0, 0)), v(0.6, 0.8), 110, 1000, 1000 / 30);
    const n = Math.min(fast.crumbs.length, slow.crumbs.length);
    const oldestFirst = (t: Trail) => [...t.crumbs].reverse().slice(0, n);
    oldestFirst(fast).forEach((c, i) => {
      expectClose(c, oldestFirst(slow)[i] ?? v(NaN, NaN), 6);
    });
  });

  it('interpolates several crumbs inside one long frame', () => {
    const t = advanceTrail(createTrail(options, v(0, 0)), v(10, 0));
    expect(t.crumbs).toEqual([v(8, 0), v(4, 0), v(0, 0)]);
    expect(t.headArcPx).toBeCloseTo(2);
  });

  it('places a crumb exactly at the spacing across frames', () => {
    let t = advanceTrail(createTrail(options, v(0, 0)), v(3, 0));
    expect(t.crumbs).toHaveLength(1);
    t = advanceTrail(t, v(3, 3));
    // 1 px more along x→y path: the crumb lands 1 px up the second leg.
    expectClose(t.crumbs[0] ?? v(NaN, NaN), v(3, 1));
    expect(t.headArcPx).toBeCloseTo(2);
  });

  it('measures spacing along the walked path, not as a straight line', () => {
    let t = createTrail(options, v(0, 0));
    for (const p of [v(2, 0), v(2, 2), v(0, 2)]) t = advanceTrail(t, p);
    expect(t.crumbs).toEqual([v(2, 2), v(0, 0)]);
    expect(t.headArcPx).toBeCloseTo(2);
  });

  it('adds nothing when the head does not move', () => {
    const t = walk(createTrail(options, v(0, 0)), v(1, 0), 110, 500, 16);
    let still = t;
    for (let i = 0; i < 100; i++) still = advanceTrail(still, still.head);
    expect(still).toBe(t);
  });

  it('accumulates sub-spacing moves without dropping early crumbs', () => {
    let t = createTrail(options, v(0, 0));
    for (let i = 1; i <= 39; i++) t = advanceTrail(t, v(i * 0.1, 0));
    expect(t.crumbs).toHaveLength(1);
    t = advanceTrail(t, v(4.1, 0));
    expect(t.crumbs).toHaveLength(2);
    expect(t.crumbs[0]?.x).toBeCloseTo(4, 9);
  });

  it('trims old crumbs to the keep length, keeping one crumb at or past it', () => {
    const keep = { spacingPx: 4, keepLengthPx: 78 };
    const t = walk(createTrail(keep, v(0, 0)), v(1, 0), 110, 5000, 16);
    expect(trailLength(t)).toBeGreaterThanOrEqual(78);
    expect(trailLength(t)).toBeLessThan(78 + 4);
    expectClose(pointAtDistance(t, 78), v(t.head.x - 78, 0), 6);
  });

  it('does not mutate the input trail', () => {
    const t = createTrail(options, v(0, 0));
    advanceTrail(t, v(50, 0));
    expect(t.crumbs).toEqual([v(0, 0)]);
    expect(t.head).toEqual(v(0, 0));
  });
});

describe('pointAtDistance', () => {
  const straight = walk(createTrail(options, v(0, 0)), v(1, 0), 110, 1000, 16);

  it('returns the head at distance 0 or less', () => {
    expect(pointAtDistance(straight, 0)).toEqual(straight.head);
    expect(pointAtDistance(straight, -5)).toEqual(straight.head);
  });

  it('measures from the current head, inside the head segment too', () => {
    for (const d of [0.5, 1, 2, 26, 52, 78]) {
      expectClose(pointAtDistance(straight, d), v(straight.head.x - d, 0), 6);
    }
  });

  it('interpolates between crumbs', () => {
    const t = advanceTrail(createTrail(options, v(0, 0)), v(12, 0));
    expectClose(pointAtDistance(t, 2), v(10, 0));
    expectClose(pointAtDistance(t, 5), v(7, 0));
  });

  it('follows corners along the path', () => {
    let t = createTrail(options, v(0, 0));
    t = advanceTrail(t, v(40, 0));
    t = advanceTrail(t, v(40, 40));
    expectClose(pointAtDistance(t, 20), v(40, 20));
    expectClose(pointAtDistance(t, 50), v(30, 0));
  });

  it('clamps past the tail to the oldest crumb', () => {
    const t = advanceTrail(createTrail(options, v(0, 0)), v(10, 0));
    expect(pointAtDistance(t, 1000)).toEqual(v(0, 0));
  });

  it('works on a trail that never moved', () => {
    expect(pointAtDistance(createTrail(options, v(3, 4)), 26)).toEqual(v(3, 4));
  });

  it('moves the slot continuously as the head walks: no step longer than the head step', () => {
    let t = createTrail(options, v(0, 0));
    let prev = pointAtDistance(t, 26);
    for (let i = 0; i < 600; i++) {
      const a = i * 0.02;
      const next = v(100 * Math.cos(a) - 100, 100 * Math.sin(a));
      const headStep = distance(t.head, next);
      t = advanceTrail(t, next);
      const slot = pointAtDistance(t, 26);
      expect(distance(prev, slot)).toBeLessThanOrEqual(headStep + 1e-9);
      prev = slot;
    }
  });
});

describe('seedStraight', () => {
  it('lays a straight trail behind the start', () => {
    const t = seedStraight({ spacingPx: 4, keepLengthPx: 104 }, v(100, 100), v(0, 1), 78);
    expect(t.head).toEqual(v(100, 100));
    expect(trailLength(t)).toBeGreaterThanOrEqual(78);
    for (const k of [1, 2, 3]) expectClose(pointAtDistance(t, k * 26), v(100, 100 + k * 26));
  });

  it('normalises the direction', () => {
    const t = seedStraight(options, v(0, 0), v(-10, 0), 20);
    expectClose(pointAtDistance(t, 20), v(-20, 0));
  });

  it('trims to the keep length', () => {
    const t = seedStraight({ spacingPx: 4, keepLengthPx: 20 }, v(0, 0), v(1, 0), 200);
    expect(trailLength(t)).toBe(20);
  });

  it('rejects a zero direction', () => {
    expect(() => seedStraight(options, v(0, 0), v(0, 0), 20)).toThrow(RangeError);
  });

  it('continues seamlessly when the leader walks away from the seed', () => {
    let t = seedStraight(options, v(0, 0), v(0, 1), 78);
    t = walk(t, v(0, -1), 110, 200, 16);
    for (const d of [10, 26, 52, 78]) expectClose(pointAtDistance(t, d), v(0, t.head.y + d), 6);
  });
});

describe('rebaseTo', () => {
  const walked = walk(createTrail(options, v(0, 0)), v(1, 0), 100, 1000, 10); // head at x=100
  /** Leader walks right to x = 100, then 20 px back: slot 26 lies 6 px past the fold, at x = 94. */
  const folded = (() => {
    let t = createTrail(options, v(0, 0));
    for (let x = 2; x <= 100; x += 2) t = advanceTrail(t, v(x, 0));
    for (let x = 98; x >= 80; x -= 2) t = advanceTrail(t, v(x, 0));
    return t;
  })();
  const slotJumps = (before: Trail, after: Trail, ks: readonly number[]) =>
    ks.map((k) => distance(pointAtDistance(before, (k + 1) * 26), pointAtDistance(after, k * 26)));

  it('makes the new leader the head and keeps the trail behind it', () => {
    const t = rebaseTo(walked, v(74, 0), 26);
    expect(t.head).toEqual(v(74, 0));
    for (const d of [0, 26, 52]) expectClose(pointAtDistance(t, d), v(74 - d, 0), 6);
    expect(trailLength(t)).toBeCloseTo(trailLength(walked) - 26, 6);
  });

  it('runs straight from the cut to a new leader off the trail', () => {
    const t = rebaseTo(walked, v(73, 3), 26);
    expect(t.head).toEqual(v(73, 3));
    // Behind the new leader the old trail continues unchanged from the crumb at x = 72.
    expectClose(pointAtDistance(t, distance(v(72, 0), v(73, 3)) + 26), v(46, 0), 6);
  });

  it('never moves a slot further than the new leader was from its old slot', () => {
    const newLeader = v(74.5, 1);
    for (const jump of slotJumps(walked, rebaseTo(walked, newLeader, 26), [1, 2])) {
      expect(jump).toBeLessThanOrEqual(distance(newLeader, v(74, 0)) + 1e-9);
    }
  });

  it('cuts exactly on a trail folded by a reversal: no slot jumps, length drops by 26', () => {
    const heir = pointAtDistance(folded, 26);
    expectClose(heir, v(94, 0));
    const r = rebaseTo(folded, heir, 26);
    for (const jump of slotJumps(folded, r, [1, 2])) expect(jump).toBeLessThan(1e-9);
    expect(trailLength(r)).toBeCloseTo(trailLength(folded) - 26, 9);
  });

  it('on a folded trail, a nudged new leader moves slots by at most the nudge', () => {
    const heir = pointAtDistance(folded, 26);
    const nudged = v(heir.x, heir.y + 3);
    for (const jump of slotJumps(folded, rebaseTo(folded, nudged, 26), [1, 2])) {
      expect(jump).toBeLessThanOrEqual(3 + 1e-9);
    }
  });

  it('cuts at 52 px when index 2 takes over (two leaders dead) on a folded trail', () => {
    const heir = pointAtDistance(folded, 52);
    expectClose(heir, v(68, 0));
    const r = rebaseTo(folded, heir, 52);
    expect(r.head).toEqual(heir);
    const before = pointAtDistance(folded, 78);
    expectClose(pointAtDistance(r, 26), before, 9);
  });

  it('clamps the cut to the trail', () => {
    const atTail = rebaseTo(walked, v(-30, 0), 10_000);
    expect(atTail.head).toEqual(v(-30, 0));
    expect(atTail.headArcPx).toBeLessThan(4);
    const atHead = rebaseTo(walked, walked.head, 0);
    expect(atHead.head).toEqual(walked.head);
    expectClose(pointAtDistance(atHead, 26), pointAtDistance(walked, 26), 6);
    const negative = rebaseTo(walked, walked.head, -5);
    expectClose(pointAtDistance(negative, 26), pointAtDistance(walked, 26), 6);
  });
});

describe('trailKeepLengthPx', () => {
  it('covers the last slot plus one spacing of margin', () => {
    expect(trailKeepLengthPx(TRAIL, 4)).toBe(4 * TRAIL.followerSpacingPx);
    expect(trailKeepLengthPx(TRAIL, 0)).toBe(TRAIL.followerSpacingPx);
  });
});
