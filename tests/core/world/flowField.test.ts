import { describe, expect, it } from 'vitest';
import type { EntityId, Vec2 } from '@core/types';
import { FlowField, FlowFieldClock, steerToward } from '@core/world/flowField';
import { CollisionGrid } from '@core/world/collisionGrid';
import { gridOf, gridWhere } from './fixtures';

const v = (x: number, y: number): Vec2 => ({ x, y });
const centre = (tx: number, ty: number): Vec2 => v(tx * 16 + 8, ty * 16 + 8);

describe('FlowField.build', () => {
  it('open ground: 10 per orthogonal tile, 14 per diagonal', () => {
    const field = new FlowField(CollisionGrid.open(10, 10, 16));
    field.build([centre(2, 2)]);
    expect(field.distanceAt(centre(2, 2))).toBe(0);
    expect(field.distanceAt(centre(5, 2))).toBe(30);
    expect(field.distanceAt(centre(4, 4))).toBe(28);
    expect(field.distanceAt(centre(5, 3))).toBe(34);
  });

  it('measures to the nearest of several goals', () => {
    const field = new FlowField(CollisionGrid.open(20, 3, 16));
    field.build([centre(0, 1), centre(19, 1)]);
    expect(field.distanceAt(centre(4, 1))).toBe(40);
    expect(field.distanceAt(centre(15, 1))).toBe(40);
  });

  it('routes round a wall', () => {
    // Wall at column 5, rows 0..7; open below it (rows 8, 9).
    const grid = gridWhere(10, 10, (tx, ty) => tx === 5 && ty <= 7);
    const field = new FlowField(grid);
    field.build([centre(8, 2)]);
    // From (2,2): down to row 8, across under the wall, back up. Straight would be 60.
    expect(field.distanceAt(centre(2, 2))).toBeGreaterThan(100);
    expect(Number.isFinite(field.distanceAt(centre(2, 2)))).toBe(true);
  });

  it('never cuts a corner: a diagonal step needs both orthogonals walkable', () => {
    const grid = gridOf(['.#', '#.']);
    const field = new FlowField(grid);
    field.build([centre(1, 1)]);
    expect(field.distanceAt(centre(0, 0))).toBe(Number.POSITIVE_INFINITY);
    expect(field.directionAt(centre(0, 0))).toEqual(v(0, 0));
    const half = gridOf(['..', '#.']);
    const f2 = new FlowField(half);
    f2.build([centre(1, 1)]);
    expect(f2.distanceAt(centre(0, 0))).toBe(20);
  });

  it('unreachable (across a river) is Infinity, and has no direction', () => {
    const grid = gridWhere(9, 5, (tx) => tx === 4);
    const field = new FlowField(grid);
    field.build([centre(7, 2)]);
    expect(field.distanceAt(centre(1, 2))).toBe(Number.POSITIVE_INFINITY);
    expect(field.directionAt(centre(1, 2))).toEqual(v(0, 0));
  });

  it('a goal on a blocked tile seeds the nearest free tile', () => {
    const grid = gridWhere(6, 6, (tx, ty) => tx === 3 && ty === 3);
    const field = new FlowField(grid);
    field.build([v(3 * 16 + 4, 3 * 16 + 8)]);
    expect(field.distanceAt(centre(2, 3))).toBe(0);
  });

  it('is unreachable everywhere before the first build and with no goals', () => {
    const field = new FlowField(CollisionGrid.open(4, 4, 16));
    expect(field.distanceAt(centre(1, 1))).toBe(Number.POSITIVE_INFINITY);
    field.build([]);
    expect(field.distanceAt(centre(1, 1))).toBe(Number.POSITIVE_INFINITY);
    expect(field.distanceAt(v(-5, 3))).toBe(Number.POSITIVE_INFINITY);
  });

  it('dynamic solids count from the next build', () => {
    const grid = CollisionGrid.open(5, 1, 16);
    const field = new FlowField(grid);
    field.build([centre(4, 0)]);
    expect(field.distanceAt(centre(0, 0))).toBe(40);
    grid.addSolid({
      id: 1 as EntityId,
      rect: { x: 32, y: 0, width: 16, height: 16 },
      blocksShots: false,
    });
    expect(field.distanceAt(centre(0, 0))).toBe(40);
    field.build([centre(4, 0)]);
    expect(field.distanceAt(centre(0, 0))).toBe(Number.POSITIVE_INFINITY);
    grid.removeSolid(1 as EntityId);
    field.build([centre(4, 0)]);
    expect(field.distanceAt(centre(0, 0))).toBe(40);
  });
});

describe('FlowField.directionAt', () => {
  it('points at the centre of the most downhill neighbour', () => {
    const field = new FlowField(CollisionGrid.open(10, 10, 16));
    field.build([centre(8, 2)]);
    expect(field.directionAt(centre(2, 2))).toEqual(v(1, 0));
    const d = field.directionAt(centre(2, 8));
    expect(d.x).toBeCloseTo(Math.SQRT1_2, 9);
    expect(d.y).toBeCloseTo(-Math.SQRT1_2, 9);
  });

  it('is zero on a goal tile', () => {
    const field = new FlowField(CollisionGrid.open(4, 4, 16));
    field.build([centre(1, 1)]);
    expect(field.directionAt(v(20, 22))).toEqual(v(0, 0));
  });

  it('following it from anywhere reachable ends on the goal, round the wall', () => {
    const grid = gridWhere(
      12,
      12,
      (tx, ty) => (tx === 6 && ty <= 8) || (ty === 4 && tx >= 2 && tx <= 6),
    );
    const field = new FlowField(grid);
    const goal = centre(9, 2);
    field.build([goal]);
    let p = centre(3, 2);
    for (let i = 0; i < 400 && field.distanceAt(p) > 0; i++) {
      const d = field.directionAt(p);
      p = v(p.x + d.x * 2, p.y + d.y * 2);
      expect(grid.isBlockedTile(grid.tileAt(p))).toBe(false);
    }
    expect(field.distanceAt(p)).toBe(0);
  });

  it('from a blocked tile (a body brushing a keg tile) still points to a walkable neighbour', () => {
    const grid = CollisionGrid.open(6, 3, 16);
    grid.addSolid({
      id: 1 as EntityId,
      rect: { x: 32, y: 16, width: 16, height: 16 },
      blocksShots: false,
    });
    const field = new FlowField(grid);
    field.build([centre(5, 1)]);
    const d = field.directionAt(centre(2, 1));
    expect(d.x).toBeGreaterThan(0);
  });
});

describe('FlowFieldClock', () => {
  it('fires on the first step, then every rebuildMs, carrying the remainder', () => {
    const clock = new FlowFieldClock(250);
    const fired: number[] = [];
    for (let i = 0; i <= 60; i++) if (clock.step(i === 0 ? 0 : 1000 / 60)) fired.push(i);
    // 250 ms at 60 fps = 15 frames.
    expect(fired).toEqual([0, 15, 30, 45, 60]);
  });

  it('invalidate forces the next step', () => {
    const clock = new FlowFieldClock(250);
    clock.step(0);
    expect(clock.step(10)).toBe(false);
    clock.invalidate();
    expect(clock.step(10)).toBe(true);
    expect(clock.step(100)).toBe(false);
  });

  it('a long hitch fires once, not a burst', () => {
    const clock = new FlowFieldClock(250);
    clock.step(0);
    expect(clock.step(2000)).toBe(true);
    expect(clock.step(1)).toBe(false);
  });

  it('rejects a non-positive interval', () => {
    expect(() => new FlowFieldClock(0)).toThrow(RangeError);
  });
});

describe('steerToward (CD Q2: the field only when the straight line is blocked)', () => {
  const grid = gridWhere(20, 12, (tx, ty) => tx === 10 && ty <= 8);
  const field = new FlowField(grid);
  const target = centre(14, 2);
  field.build([target]);
  const base = { grid, field, radiusPx: 12, target };

  it('keeps the brain direction while the straight line is walkable', () => {
    const position = centre(12, 2);
    const desired = v(1, 0);
    expect(steerToward({ ...base, position, desired })).toBe(desired);
  });

  it('follows the field when a body cannot walk the straight line', () => {
    const position = centre(6, 2);
    const d = steerToward({ ...base, position, desired: v(1, 0) });
    expect(d.y).toBeGreaterThan(0);
  });

  it('keeps the brain direction when not heading for the target (archer backing off) or standing', () => {
    const position = centre(6, 2);
    const away = v(-1, 0);
    expect(steerToward({ ...base, position, desired: away })).toBe(away);
    const still = v(0, 0);
    expect(steerToward({ ...base, position, desired: still })).toBe(still);
    expect(steerToward({ ...base, position, desired: v(1, 0), target: null })).toEqual(v(1, 0));
  });
});
