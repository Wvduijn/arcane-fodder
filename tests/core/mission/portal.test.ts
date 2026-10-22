import { describe, expect, it } from 'vitest';
import type { EntityId, Vec2 } from '@core/types';
import {
  createObjectives,
  objectivesComplete,
  recordTarget,
  targetsDestroyed,
  targetsRequired,
} from '@core/mission/objectives';
import {
  checkExtraction,
  createPortal,
  extractionSplit,
  isEnterable,
  lightRune,
  openPortal,
  stepPortal,
  type PortalState,
} from '@core/mission/portal';
import { PORTAL } from '@data/mission';
import { M01_GOBLIN_WOODS } from '@data/missions/m01-goblin-woods';

const v = (x: number, y: number): Vec2 => ({ x, y });
const id = (n: number) => n as EntityId;
const CENTRE = v(1000, 1000);
const RADIUS = M01_GOBLIN_WOODS.extraction.radiusPx;

describe('objectives (progress by TargetId)', () => {
  it('counts huts up to the objective, then stops counting', () => {
    let s = createObjectives(M01_GOBLIN_WOODS.objectives);
    expect([targetsDestroyed(s), targetsRequired(s), objectivesComplete(s)]).toEqual([0, 2, false]);
    const first = recordTarget(s, 'goblin-hut');
    expect(first).toMatchObject({ counted: true, progress: 1, required: 2, complete: false });
    s = first.state;
    const second = recordTarget(s, 'goblin-hut');
    expect(second).toMatchObject({ counted: true, progress: 2, required: 2, complete: true });
    s = second.state;
    const extra = recordTarget(s, 'goblin-hut');
    expect(extra).toMatchObject({ counted: false, progress: 2, complete: false });
    expect(extra.state).toBe(s);
  });

  it('a mission with no objectives is complete', () => {
    expect(objectivesComplete(createObjectives([]))).toBe(true);
    expect(recordTarget(createObjectives([]), 'goblin-hut').counted).toBe(false);
  });
});

describe('portal phases (GDD §13)', () => {
  it('sealed → each rune lights → the last starts the opening → open after openingMs', () => {
    let p = createPortal(CENTRE, 2);
    expect(p).toMatchObject({ phase: 'sealed', runesLit: 0 });
    const one = lightRune(p, PORTAL);
    expect(one.opened).toBe(false);
    expect(one.state).toMatchObject({ phase: 'sealed', runesLit: 1 });
    const two = lightRune(one.state, PORTAL);
    expect(two.opened).toBe(true);
    expect(two.state).toMatchObject({
      phase: 'opening',
      runesLit: 2,
      openingLeftMs: PORTAL.openingMs,
    });
    p = two.state;
    expect(isEnterable(p)).toBe(false);
    const dt = 1000 / 60;
    let opened = 0;
    let t = 0;
    while (!isEnterable(p)) {
      const s = stepPortal(p, dt);
      t += dt;
      if (s.enterable) opened++;
      p = s.state;
      if (t > 5000) throw new Error('never opened');
    }
    expect(opened).toBe(1);
    expect(t).toBeGreaterThanOrEqual(PORTAL.openingMs - 1e-6);
    expect(t).toBeLessThan(PORTAL.openingMs + dt);
    expect(lightRune(p, PORTAL).state).toBe(p);
    expect(openPortal(p, PORTAL).opened).toBe(false);
  });

  it('openPortal (debug) skips the runes but not the opening', () => {
    const p = openPortal(createPortal(CENTRE, 2), PORTAL);
    expect(p.opened).toBe(true);
    expect(p.state).toMatchObject({ phase: 'opening', runesLit: 2 });
  });

  const openAt = (): PortalState => ({ ...createPortal(CENTRE, 2), phase: 'open', runesLit: 2 });
  const member = (n: number, dy: number) => ({ id: id(n), position: v(CENTRE.x, CENTRE.y + dy) });
  const input = (members: ReturnType<typeof member>[], runners: EntityId[] = []) => ({
    members,
    runners,
    tuning: PORTAL,
    radiusPx: RADIUS,
  });

  it('walking onto a sealed or opening portal does nothing', () => {
    const sealed = createPortal(CENTRE, 2);
    expect(checkExtraction(sealed, input([member(1, 0)])).extraction).toBeNull();
    const opening = openPortal(sealed, PORTAL).state;
    expect(checkExtraction(opening, input([member(1, 0)])).extraction).toBeNull();
  });

  it(`triggers when the leader's centre is within ${String(PORTAL.triggerRadiusPx)} px (≤)`, () => {
    const p = openAt();
    expect(
      checkExtraction(p, input([member(1, PORTAL.triggerRadiusPx + 0.01)])).extraction,
    ).toBeNull();
    const hit = checkExtraction(p, input([member(1, PORTAL.triggerRadiusPx)]));
    expect(hit.extraction).not.toBeNull();
    expect(hit.state.phase).toBe('extracted');
    expect(checkExtraction(hit.state, input([member(1, 0)])).extraction).toBeNull();
  });

  it('only the leader triggers it: a follower on the pad does not', () => {
    const p = openAt();
    expect(checkExtraction(p, input([member(1, 200), member(2, 0)])).extraction).toBeNull();
    expect(checkExtraction(p, input([])).extraction).toBeNull();
  });

  it('split at 0, 79, 111, 113 px with radius 112 → saved, saved, saved, left behind (GDD §13 Q8)', () => {
    expect(RADIUS).toBe(112);
    const r = checkExtraction(
      openAt(),
      input([member(1, 0), member(2, 79), member(3, 111), member(4, 113)]),
    );
    expect(r.extraction).toEqual({ saved: [1, 2, 3], leftBehind: [4] });
  });

  it('exactly on the radius is saved (centre, ≤)', () => {
    expect(extractionSplit(CENTRE, RADIUS, [member(1, 0), member(2, 112)], [])).toEqual({
      saved: [1, 2],
      leftBehind: [],
    });
  });

  it('an active volunteer runner is never saved, even standing in the ring (GDD §11)', () => {
    const r = checkExtraction(openAt(), input([member(1, 0), member(2, 30)], [id(9)]));
    expect(r.extraction).toEqual({ saved: [1, 2], leftBehind: [9] });
    // Even if a caller lists it among the members too.
    expect(extractionSplit(CENTRE, RADIUS, [member(1, 0), member(9, 10)], [id(9)])).toEqual({
      saved: [1],
      leftBehind: [9],
    });
  });

  it('a runner that detonated or died on the trigger frame is not also left behind (review m1)', () => {
    const r = checkExtraction(openAt(), {
      ...input([member(1, 0)], [id(8), id(9)]),
      isAlive: (x) => x !== id(9),
    });
    expect(r.extraction).toEqual({ saved: [1], leftBehind: [8] });
  });

  it('a full squad walking straight in single file is all saved (78 px trail + 24 trigger)', () => {
    const r = checkExtraction(
      openAt(),
      input([member(1, 24), member(2, 50), member(3, 76), member(4, 102)]),
    );
    expect(r.extraction?.leftBehind).toEqual([]);
  });
});
