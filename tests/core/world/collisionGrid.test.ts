import { describe, expect, it } from 'vitest';
import type { EntityId, Vec2 } from '@core/types';
import { CollisionGrid } from '@core/world/collisionGrid';
import { gridOf } from './fixtures';

const v = (x: number, y: number): Vec2 => ({ x, y });
const id = (n: number) => n as EntityId;
const TS = 16;

/** 20×20 tiles, a vertical wall at column 10 for rows 2..17. */
const WALL = gridOf(
  Array.from({ length: 20 }, (_, ty) =>
    Array.from({ length: 20 }, (_, tx) => (tx === 10 && ty >= 2 && ty <= 17 ? '#' : '.')).join(''),
  ),
);
const WALL_LEFT = 10 * TS; // 160

describe('CollisionGrid setup', () => {
  it('reads any non-empty gid as solid, and the size into bounds', () => {
    const grid = gridOf(['..#', '...']);
    expect(grid.bounds).toEqual({ x: 0, y: 0, width: 48, height: 32 });
    expect(grid.isTerrainSolid({ tx: 2, ty: 0 })).toBe(true);
    expect(grid.isTerrainSolid({ tx: 1, ty: 0 })).toBe(false);
    expect(grid.isBlockedTile({ tx: 0, ty: 1 })).toBe(false);
  });

  it('treats everything outside the map as solid terrain', () => {
    const grid = CollisionGrid.open(4, 4, TS);
    for (const t of [
      { tx: -1, ty: 0 },
      { tx: 4, ty: 0 },
      { tx: 0, ty: -1 },
      { tx: 0, ty: 4 },
    ]) {
      expect(grid.isTerrainSolid(t)).toBe(true);
    }
    expect(grid.pushOut(v(3, 30), 10)).toEqual(v(10, 30));
  });

  it('rejects data that does not fit the size, and bad sizes', () => {
    expect(() => CollisionGrid.fromTiles(3, 2, TS, [0, 0, 0])).toThrow(RangeError);
    expect(() => CollisionGrid.open(0, 2, TS)).toThrow(RangeError);
    expect(() => CollisionGrid.open(2, 2, 0)).toThrow(RangeError);
  });

  it('tile maths', () => {
    const grid = CollisionGrid.open(8, 8, TS);
    expect(grid.tileAt(v(17, 31.9))).toEqual({ tx: 1, ty: 1 });
    expect(grid.tileCentre({ tx: 1, ty: 2 })).toEqual(v(24, 40));
    expect(grid.index({ tx: 3, ty: 2 })).toBe(19);
  });
});

describe('circle vs tiles', () => {
  it('pushes an overlapping circle out to touching, along the wall normal', () => {
    const p = WALL.pushOut(v(WALL_LEFT - 4, 100), 10);
    expect(p.x).toBeCloseTo(WALL_LEFT - 10, 9);
    expect(p.y).toBe(100);
    expect(WALL.overlapsSolid(p, 10)).toBe(false);
    expect(WALL.overlapsSolid(v(WALL_LEFT - 9, 100), 10)).toBe(true);
  });

  it('touching is not overlapping', () => {
    expect(WALL.overlapsSolid(v(WALL_LEFT - 10, 100), 10)).toBe(false);
    expect(WALL.pushOut(v(WALL_LEFT - 10, 100), 10)).toEqual(v(WALL_LEFT - 10, 100));
  });

  it('slides along a wall: the normal part of the move is removed, the tangent kept', () => {
    const from = v(WALL_LEFT - 10, 100);
    const to = v(WALL_LEFT + 20, 130);
    const p = WALL.moveCircle(from, to, 10);
    expect(p.x).toBeCloseTo(WALL_LEFT - 10, 6);
    expect(p.y).toBeCloseTo(130, 6);
  });

  it('never tunnels through a one-tile wall, however long the move', () => {
    const p = WALL.moveCircle(v(100, 150), v(260, 150), 4);
    expect(p.x).toBeLessThanOrEqual(WALL_LEFT - 4 + 1e-6);
    expect(WALL.overlapsSolid(p, 4)).toBe(false);
  });

  it('slides around the wall end and keeps going', () => {
    // Bottom of the wall is at y = 18 × 16 = 288; a circle hugging its left face past the end.
    const p = WALL.moveCircle(v(WALL_LEFT - 10, 270), v(WALL_LEFT + 30, 305), 10);
    expect(p.x).toBeGreaterThan(WALL_LEFT - 10);
    expect(p.y).toBeGreaterThan(288);
    expect(p.y).toBeLessThanOrEqual(310);
    expect(WALL.overlapsSolid(p, 10)).toBe(false);
  });

  it('a concave corner pushes out on both axes', () => {
    const grid = gridOf(['#####', '#....', '#....', '#....']);
    const p = grid.pushOut(v(18, 18), 10);
    expect(p.x).toBeCloseTo(26, 6);
    expect(p.y).toBeCloseTo(26, 6);
  });

  it('a convex corner pushes out diagonally (closest point)', () => {
    const grid = gridOf(['....', '.#..', '....', '....']);
    // Corner of tile (1,1) at (32, 32); a circle centred at (36, 36) is 5.66 px from it.
    const p = grid.pushOut(v(36, 36), 10);
    expect(Math.hypot(p.x - 32, p.y - 32)).toBeCloseTo(10, 6);
    expect(p.x).toBeCloseTo(p.y, 9);
  });

  it('a centre inside a tile leaves through the nearest open side', () => {
    const grid = gridOf(['....', '.##.', '....']);
    // Inside tile (1,1), 3 px from its top: up is open.
    const p = grid.pushOut(v(24, 19), 6);
    expect(p).toEqual(v(24, 10));
    // Inside tile (2,1) close to its left side, which is solid tile (1,1): leaves right or up.
    const q = grid.pushOut(v(34, 24), 6);
    expect(grid.overlapsSolid(q, 6)).toBe(false);
    expect(q.x).toBeGreaterThan(34 - 1e-9);
  });

  it('a centre buried deep in terrain goes to the nearest free tile', () => {
    const grid = gridOf(['#####', '#####', '#####', '.....']);
    const p = grid.pushOut(v(40, 24), 4);
    expect(grid.overlapsSolid(p, 4)).toBe(false);
    expect(p.y).toBeGreaterThan(48);
  });
});

describe('dynamic solids (kegs, huts)', () => {
  it('collide exactly by rect, cover their tiles for navigation, and free them on removal', () => {
    const grid = CollisionGrid.open(10, 10, TS);
    grid.addSolid({ id: id(5), rect: { x: 72, y: 72, width: 16, height: 16 }, blocksShots: false });
    expect(grid.hasSolid(id(5))).toBe(true);
    // Rect 72..88 overlaps tiles 4..5 on each axis.
    for (const t of [
      { tx: 4, ty: 4 },
      { tx: 5, ty: 4 },
      { tx: 4, ty: 5 },
      { tx: 5, ty: 5 },
    ]) {
      expect(grid.isBlockedTile(t)).toBe(true);
    }
    expect(grid.isTerrainSolid({ tx: 4, ty: 4 })).toBe(false);
    expect(grid.overlapsSolid(v(80, 60), 10)).toBe(false);
    expect(grid.overlapsSolid(v(80, 63), 10)).toBe(true);
    expect(grid.pushOut(v(80, 66), 10).y).toBeCloseTo(62, 9);
    expect(grid.removeSolid(id(5))).toBe(true);
    expect(grid.removeSolid(id(5))).toBe(false);
    expect(grid.isBlockedTile({ tx: 4, ty: 4 })).toBe(false);
    expect(grid.overlapsSolid(v(80, 80), 10)).toBe(false);
  });

  it('a tile-aligned rect covers exactly its own tiles', () => {
    const grid = CollisionGrid.open(10, 10, TS);
    grid.addSolid({ id: id(1), rect: { x: 32, y: 32, width: 64, height: 64 }, blocksShots: true });
    expect(grid.isBlockedTile({ tx: 1, ty: 2 })).toBe(false);
    expect(grid.isBlockedTile({ tx: 2, ty: 2 })).toBe(true);
    expect(grid.isBlockedTile({ tx: 5, ty: 5 })).toBe(true);
    expect(grid.isBlockedTile({ tx: 6, ty: 5 })).toBe(false);
  });

  it('a tiny rect still covers the tile under its centre', () => {
    const grid = CollisionGrid.open(4, 4, TS);
    grid.addSolid({ id: id(1), rect: { x: 20, y: 20, width: 1, height: 1 }, blocksShots: false });
    expect(grid.isBlockedTile({ tx: 1, ty: 1 })).toBe(true);
  });

  it('overlapping solids keep a tile covered until both are gone', () => {
    const grid = CollisionGrid.open(4, 4, TS);
    const rect = { x: 16, y: 16, width: 16, height: 16 };
    grid.addSolid({ id: id(1), rect, blocksShots: true });
    grid.addSolid({ id: id(2), rect, blocksShots: true });
    grid.removeSolid(id(1));
    expect(grid.isBlockedTile({ tx: 1, ty: 1 })).toBe(true);
    expect(grid.castSegment(v(0, 24), v(60, 24))?.owner).toBe(2);
    grid.removeSolid(id(2));
    expect(grid.isBlockedTile({ tx: 1, ty: 1 })).toBe(false);
    expect(grid.castSegment(v(0, 24), v(60, 24))).toBeNull();
  });

  it('rejects a duplicate id', () => {
    const grid = CollisionGrid.open(4, 4, TS);
    const spec = { id: id(1), rect: { x: 0, y: 0, width: 16, height: 16 }, blocksShots: false };
    grid.addSolid(spec);
    expect(() => {
      grid.addSolid(spec);
    }).toThrow(RangeError);
  });
});

describe('segment cast and line of sight', () => {
  it('stops at the entry point of the first solid tile', () => {
    const hit = WALL.castSegment(v(100, 100), v(300, 100));
    expect(hit).not.toBeNull();
    expect(hit?.distancePx).toBeCloseTo(60, 9);
    expect(hit?.at.x).toBeCloseTo(WALL_LEFT, 9);
    expect(hit?.tile).toEqual({ tx: 10, ty: 6 });
    expect(hit?.owner).toBeNull();
  });

  it('works in every direction, including from the far side and diagonally', () => {
    expect(WALL.castSegment(v(300, 100), v(100, 100))?.at.x).toBeCloseTo(WALL_LEFT + TS, 9);
    const diag = WALL.castSegment(v(100, 100), v(200, 140));
    expect(diag?.at.x).toBeCloseTo(WALL_LEFT, 9);
    expect(diag?.at.y).toBeCloseTo(124, 9);
    expect(WALL.castSegment(v(170, 0), v(170, 300))?.at.y).toBeCloseTo(32, 9);
  });

  it('is null when the segment ends before the wall or passes around it', () => {
    expect(WALL.castSegment(v(100, 100), v(159, 100))).toBeNull();
    expect(WALL.castSegment(v(100, 300), v(300, 300))).toBeNull();
    expect(WALL.lineOfSight(v(100, 300), v(300, 300))).toBe(true);
    expect(WALL.lineOfSight(v(100, 100), v(300, 100))).toBe(false);
  });

  it('a zero-length segment only checks its own tile', () => {
    expect(WALL.castSegment(v(100, 100), v(100, 100))).toBeNull();
    expect(WALL.castSegment(v(165, 100), v(165, 100))?.distancePx).toBe(0);
  });

  it('cannot squeeze through a diagonal gap: either orthogonal tile at a corner blocks', () => {
    // From tile (0,0) exactly through the corner (16,16) into tile (1,1).
    const from = v(8, 8);
    const to = v(56, 56);
    expect(gridOf(['....', '....', '....', '....']).castSegment(from, to)).toBeNull();
    expect(gridOf(['.#..', '#...', '....', '....']).castSegment(from, to)?.at).toEqual(v(16, 16));
    expect(gridOf(['.#..', '....', '....', '....']).castSegment(from, to)).not.toBeNull();
    expect(gridOf(['....', '#...', '....', '....']).castSegment(from, to)).not.toBeNull();
  });

  it('reports the structure that owns a tile, and passes it when ignored', () => {
    const grid = CollisionGrid.open(20, 10, TS);
    grid.addSolid({ id: id(9), rect: { x: 128, y: 32, width: 64, height: 64 }, blocksShots: true });
    const hit = grid.castSegment(v(10, 64), v(300, 64));
    expect(hit?.owner).toBe(9);
    expect(hit?.at.x).toBeCloseTo(128, 9);
    expect(grid.lineOfSight(v(10, 64), v(160, 64))).toBe(false);
    expect(grid.lineOfSight(v(10, 64), v(160, 64), id(9))).toBe(true);
  });

  it('a structure on terrain tiles still reports itself (huts sit on their blockers footprint)', () => {
    const rows = Array.from({ length: 10 }, (_, ty) =>
      Array.from({ length: 20 }, (_, tx) =>
        tx >= 8 && tx < 12 && ty >= 2 && ty < 6 ? '#' : '.',
      ).join(''),
    );
    const grid = gridOf(rows);
    grid.addSolid({ id: id(4), rect: { x: 128, y: 32, width: 64, height: 64 }, blocksShots: true });
    expect(grid.castSegment(v(10, 64), v(300, 64))?.owner).toBe(4);
    expect(grid.lineOfSight(v(10, 64), v(160, 64), id(4))).toBe(true);
  });

  it('kegs block movement but never shots or sight (GDD §3, §12)', () => {
    const grid = CollisionGrid.open(20, 10, TS);
    grid.addSolid({ id: id(3), rect: { x: 96, y: 56, width: 16, height: 16 }, blocksShots: false });
    expect(grid.castSegment(v(10, 64), v(300, 64))).toBeNull();
    expect(grid.pathClear(v(10, 64), v(300, 64), 4)).toBe(false);
  });
});

describe('sweepCircle and pathClear', () => {
  it('reports the distance to first contact, to 1/8 px', () => {
    const d = WALL.sweepCircle(v(100, 100), v(300, 100), 10);
    expect(d).toBeGreaterThan(50 - 0.125 - 1e-9);
    expect(d).toBeLessThanOrEqual(50);
  });

  it('is the full length when clear, 0 when starting in contact', () => {
    expect(WALL.sweepCircle(v(100, 305), v(300, 305), 10)).toBe(200);
    expect(WALL.pathClear(v(100, 305), v(300, 305), 10)).toBe(true);
    expect(WALL.sweepCircle(v(155, 100), v(100, 100), 10)).toBe(0);
  });

  it('a body is wider than a sight line: a gap the centre fits through can still block', () => {
    // Wall column 10 rows 2..17; a line along y = 290 clears the wall end (288) by 2 px.
    expect(WALL.lineOfSight(v(100, 290), v(300, 290))).toBe(true);
    expect(WALL.pathClear(v(100, 290), v(300, 290), 10)).toBe(false);
  });
});

describe('nearestFreeTile', () => {
  it('a free tile under the point is its own answer', () => {
    expect(WALL.nearestFreeTile(v(100, 100))).toEqual(v(104, 104));
  });

  it('a blocked tile gives the closest free tile centre', () => {
    // (165, 100) is in wall tile (10, 6); tile (9, 6) centre (152, 104) is 13.6 px away.
    expect(WALL.nearestFreeTile(v(165, 100))).toEqual(v(152, 104));
    expect(WALL.nearestFreeTile(v(170, 100))).toEqual(v(184, 104));
  });

  it('honours clearance and the isFree test', () => {
    const p = WALL.nearestFreeTile(v(165, 100), { clearancePx: 10 });
    expect(p).not.toBeNull();
    if (!p) return;
    expect(WALL.overlapsSolid(p, 10)).toBe(false);
    const q = WALL.nearestFreeTile(v(100, 100), { isFree: (c) => c.x !== 104 });
    expect(q?.x).not.toBe(104);
  });

  it('null when nothing is free within the search radius', () => {
    const grid = gridOf(['###', '###', '###']);
    expect(grid.nearestFreeTile(v(24, 24))).toBeNull();
    expect(WALL.nearestFreeTile(v(165, 100), { maxRadiusTiles: 0 })).toBeNull();
  });
});
