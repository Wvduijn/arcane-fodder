/**
 * Tile collision (M7, GDD §1, §3, §12; tiled-conventions.md §3). The `blockers` layer is the static
 * terrain: any non-empty tile is solid. Structures add dynamic solids on top (kegs until their
 * Kaboom, huts and their rubble). Pure and typed-array based; Phaser only draws.
 *
 * API:
 * - `CollisionGrid.fromTiles(widthTiles, heightTiles, tileSizePx, data)`: solid where `data[i] ≠ 0`
 *   (Tiled gids, row-major, `i = ty × width + tx`). Throws when `data` doesn't fit the size.
 *   `CollisionGrid.open(widthTiles, heightTiles, tileSizePx)`: no terrain at all (tests, old sims).
 * - `bounds`: the map rect in px. Everything outside it counts as solid terrain.
 * - `tileAt(p)`, `tileCentre(tile)`, `inBounds(tile)`, `index(tile)`: tile maths.
 * - `isTerrainSolid(tile)`: a blockers tile (or out of bounds).
 * - `isBlockedTile(tile)`: terrain or covered by a dynamic solid. Navigation and spawns read this.
 * - `addSolid(spec)` / `removeSolid(id)` / `hasSolid(id)`: a dynamic solid rect. Movement always
 *   collides with its exact rect; it covers (for navigation) every tile its rect overlaps, and at
 *   least the tile under its centre. `blocksShots` (huts, rubble): projectiles and line of sight
 *   stop on its tiles too, and report it as `owner`. Kegs don't block shots (GDD §3, §12: autos
 *   and arrows pass kegs). Removing a keg on its Kaboom frees its tiles. Throws on a duplicate id.
 * - `overlapsSolid(p, radiusPx)`: does the circle overlap terrain or a dynamic solid?
 * - `pushOut(p, radiusPx)`: the circle moved out of every solid (deepest overlap first, along the
 *   contact normal), so it touches at most. A centre inside a solid leaves through the nearest
 *   side that isn't solid; a centre buried deep in terrain goes to `nearestFreeTile`.
 * - `moveCircle(from, to, radiusPx)`: the circle walks from `from` toward `to` in sub-steps of at
 *   most half its radius, pushed out after each, so it slides along walls (the normal part of
 *   the move is removed, the tangential part kept) and never tunnels through a tile. A move that
 *   touches nothing returns `to` itself.
 * - `castSegment(from, to, options)`: the first shot-blocking tile the point segment enters (DDA,
 *   exact), or null when clear. A segment through a diagonal gap between two solid tiles is
 *   blocked. `options.ignoreOwner` passes through that structure's tiles (line of sight to a hut,
 *   which stands on its own footprint).
 * - `lineOfSight(from, to, ignoreOwner?)`: `castSegment(...) === null` (CD Q3: blockers block target
 *   selection; kegs never do).
 * - `sweepCircle(from, to, radiusPx)`: how far a circle travels straight along the segment before
 *   it first overlaps a solid (within 1/8 px), or the full length. A circle that starts overlapping
 *   gets 0.
 * - `pathClear(from, to, radiusPx)`: `sweepCircle` reaches `to`. Enemy navigation (flowField.ts)
 *   uses it to decide whether the straight line to the target is walkable.
 * - `nearestFreeTile(p, options)`: centre of the closest tile (Euclidean, centre to `p`) that isn't
 *   blocked, whose circle of `clearancePx` overlaps no solid, and that `options.isFree` accepts
 *   (occupied by a unit, etc.). Ties break by row, then column. Null if none within
 *   `maxRadiusTiles` (default: the whole map). Hut doors (GDD §12) and spawn scatter use it.
 */
import type { EntityId, Rect, Vec2 } from '@core/types';

export interface TileCoord {
  readonly tx: number;
  readonly ty: number;
}

export interface SolidSpec {
  readonly id: EntityId;
  /** Top-left corner, in world px. */
  readonly rect: Rect;
  /** Projectiles and line of sight stop on it (huts, rubble). False for kegs. */
  readonly blocksShots: boolean;
}

export interface SegmentHit {
  /** From `from` to the entry point of the first blocking tile. */
  readonly distancePx: number;
  readonly at: Vec2;
  readonly tile: TileCoord;
  /** The shot-blocking structure on that tile, or null for terrain. */
  readonly owner: EntityId | null;
}

export interface CastOptions {
  /** Pass through this structure's tiles. */
  readonly ignoreOwner?: EntityId;
}

export interface FreeTileOptions {
  /** A body of this radius at the tile centre must not overlap a solid. Default 0. */
  readonly clearancePx?: number;
  /** Rings of tiles to search. Default: the whole map. */
  readonly maxRadiusTiles?: number;
  /** Extra test (occupied by a unit). Called with the tile centre. */
  readonly isFree?: (centre: Vec2) => boolean;
}

interface Solid {
  readonly spec: SolidSpec;
  readonly tiles: readonly number[];
}

/** Float slack for contact tests (not a tuning value). */
const EPSILON_PX = 1e-6;
/** `sweepCircle` resolves the contact to this many px. */
const SWEEP_PRECISION_PX = 1 / 8;
/** `pushOut` stops after this many single pushes (corners need two or three). */
const MAX_PUSHES = 8;
const ZERO: Vec2 = { x: 0, y: 0 };

export class CollisionGrid {
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly tileSizePx: number;
  readonly bounds: Rect;
  private readonly terrain: Uint8Array;
  /** Dynamic solids covering each tile (navigation). */
  private readonly covered: Uint16Array;
  /** Shot-blocking solids covering each tile. */
  private readonly shotCovered: Uint16Array;
  private readonly solids = new Map<EntityId, Solid>();

  private constructor(widthTiles: number, heightTiles: number, tileSizePx: number) {
    if (!isPositiveInteger(widthTiles) || !isPositiveInteger(heightTiles)) {
      throw new RangeError(
        `Grid size must be positive integers, got ${String(widthTiles)}×${String(heightTiles)}`,
      );
    }
    if (!(tileSizePx > 0))
      throw new RangeError(`tileSizePx must be > 0, got ${String(tileSizePx)}`);
    this.widthTiles = widthTiles;
    this.heightTiles = heightTiles;
    this.tileSizePx = tileSizePx;
    this.bounds = { x: 0, y: 0, width: widthTiles * tileSizePx, height: heightTiles * tileSizePx };
    const cells = widthTiles * heightTiles;
    this.terrain = new Uint8Array(cells);
    this.covered = new Uint16Array(cells);
    this.shotCovered = new Uint16Array(cells);
  }

  static open(widthTiles: number, heightTiles: number, tileSizePx: number): CollisionGrid {
    return new CollisionGrid(widthTiles, heightTiles, tileSizePx);
  }

  static fromTiles(
    widthTiles: number,
    heightTiles: number,
    tileSizePx: number,
    data: ArrayLike<number>,
  ): CollisionGrid {
    const grid = new CollisionGrid(widthTiles, heightTiles, tileSizePx);
    if (data.length !== widthTiles * heightTiles) {
      throw new RangeError(
        `Tile data has ${String(data.length)} cells, expected ${String(widthTiles)}×${String(heightTiles)}`,
      );
    }
    for (let i = 0; i < data.length; i++) grid.terrain[i] = (data[i] ?? 0) !== 0 ? 1 : 0;
    return grid;
  }

  // ── Tile maths ────────────────────────────────────────────────────────────

  tileAt(p: Vec2): TileCoord {
    return { tx: Math.floor(p.x / this.tileSizePx), ty: Math.floor(p.y / this.tileSizePx) };
  }

  tileCentre(tile: TileCoord): Vec2 {
    return { x: (tile.tx + 0.5) * this.tileSizePx, y: (tile.ty + 0.5) * this.tileSizePx };
  }

  inBounds(tile: TileCoord): boolean {
    return tile.tx >= 0 && tile.ty >= 0 && tile.tx < this.widthTiles && tile.ty < this.heightTiles;
  }

  /** Row-major cell index. Only meaningful in bounds. */
  index(tile: TileCoord): number {
    return tile.ty * this.widthTiles + tile.tx;
  }

  isTerrainSolid(tile: TileCoord): boolean {
    return this.terrainAt(tile.tx, tile.ty);
  }

  isBlockedTile(tile: TileCoord): boolean {
    return this.blockedAt(tile.tx, tile.ty);
  }

  // ── Dynamic solids ────────────────────────────────────────────────────────

  addSolid(spec: SolidSpec): void {
    if (this.solids.has(spec.id)) throw new RangeError(`Solid ${String(spec.id)} already exists`);
    const tiles = this.tilesOf(spec.rect);
    for (const i of tiles) {
      this.covered[i] = (this.covered[i] ?? 0) + 1;
      if (spec.blocksShots) this.shotCovered[i] = (this.shotCovered[i] ?? 0) + 1;
    }
    this.solids.set(spec.id, { spec, tiles });
  }

  removeSolid(id: EntityId): boolean {
    const solid = this.solids.get(id);
    if (!solid) return false;
    for (const i of solid.tiles) {
      this.covered[i] = Math.max(0, (this.covered[i] ?? 0) - 1);
      if (solid.spec.blocksShots) this.shotCovered[i] = Math.max(0, (this.shotCovered[i] ?? 0) - 1);
    }
    this.solids.delete(id);
    return true;
  }

  hasSolid(id: EntityId): boolean {
    return this.solids.has(id);
  }

  // ── Circles ───────────────────────────────────────────────────────────────

  overlapsSolid(p: Vec2, radiusPx: number): boolean {
    return this.deepestContact(p, radiusPx) !== null;
  }

  pushOut(p: Vec2, radiusPx: number): Vec2 {
    let pos = p;
    for (let i = 0; i < MAX_PUSHES; i++) {
      const contact = this.deepestContact(pos, radiusPx);
      if (!contact) return pos;
      if (contact.buried) {
        const free = this.nearestFreeTile(pos, { clearancePx: radiusPx });
        if (!free) return pos;
        pos = free;
        continue;
      }
      pos = { x: pos.x + contact.push.x, y: pos.y + contact.push.y };
    }
    return pos;
  }

  moveCircle(from: Vec2, to: Vec2, radiusPx: number): Vec2 {
    let pos = this.pushOut(from, radiusPx);
    let touched = pos !== from;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return pos;
    const maxStep = Math.max(radiusPx, this.tileSizePx / 4) / 2;
    const steps = Math.ceil(len / maxStep);
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      const next = { x: pos.x + sx, y: pos.y + sy };
      pos = this.pushOut(next, radiusPx);
      touched ||= pos !== next;
    }
    // Nothing touched: exactly `to`, no float drift from the sub-steps (open ground = no grid).
    return touched ? pos : to;
  }

  sweepCircle(from: Vec2, to: Vec2, radiusPx: number): number {
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    const at = (d: number): Vec2 =>
      len === 0
        ? from
        : { x: from.x + ((to.x - from.x) * d) / len, y: from.y + ((to.y - from.y) * d) / len };
    if (this.overlapsSolid(from, radiusPx)) return 0;
    if (len === 0) return 0;
    const step = Math.max(SWEEP_PRECISION_PX, Math.min(radiusPx, this.tileSizePx) / 2);
    let clear = 0;
    for (let d = step; ; d += step) {
      const probe = Math.min(d, len);
      if (this.overlapsSolid(at(probe), radiusPx)) {
        let lo = clear;
        let hi = probe;
        while (hi - lo > SWEEP_PRECISION_PX) {
          const mid = (lo + hi) / 2;
          if (this.overlapsSolid(at(mid), radiusPx)) hi = mid;
          else lo = mid;
        }
        return lo;
      }
      clear = probe;
      if (probe >= len) return len;
    }
  }

  pathClear(from: Vec2, to: Vec2, radiusPx: number): boolean {
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    return this.sweepCircle(from, to, radiusPx) >= len - EPSILON_PX;
  }

  // ── Segments ──────────────────────────────────────────────────────────────

  castSegment(from: Vec2, to: Vec2, options: CastOptions = {}): SegmentHit | null {
    const ts = this.tileSizePx;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    let tx = Math.floor(from.x / ts);
    let ty = Math.floor(from.y / ts);
    const blocks = (x: number, y: number): EntityId | null | false => this.shotBlock(x, y, options);

    const first = blocks(tx, ty);
    if (first !== false) return this.hit(from, from, 0, len, tx, ty, first);
    if (len === 0) return null;

    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    // Parametric t (0..1 along the segment) of the next vertical / horizontal tile boundary.
    const nextX = stepX > 0 ? (tx + 1) * ts : tx * ts;
    const nextY = stepY > 0 ? (ty + 1) * ts : ty * ts;
    let tMaxX = stepX === 0 ? Number.POSITIVE_INFINITY : (nextX - from.x) / dx;
    let tMaxY = stepY === 0 ? Number.POSITIVE_INFINITY : (nextY - from.y) / dy;
    const tDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : ts / Math.abs(dx);
    const tDeltaY = stepY === 0 ? Number.POSITIVE_INFINITY : ts / Math.abs(dy);

    for (;;) {
      const t = Math.min(tMaxX, tMaxY);
      if (t > 1) return null;
      if (Math.abs(tMaxX - tMaxY) <= EPSILON_PX * Math.min(tDeltaX, tDeltaY)) {
        // Exactly through a corner: either orthogonal neighbour closes the gap.
        let side = blocks(tx + stepX, ty);
        if (side === false) side = blocks(tx, ty + stepY);
        tx += stepX;
        ty += stepY;
        tMaxX += tDeltaX;
        tMaxY += tDeltaY;
        if (side === false) side = blocks(tx, ty);
        if (side !== false) return this.hit(from, to, t, len, tx, ty, side);
        continue;
      }
      if (tMaxX < tMaxY) {
        tx += stepX;
        tMaxX += tDeltaX;
      } else {
        ty += stepY;
        tMaxY += tDeltaY;
      }
      const owner = blocks(tx, ty);
      if (owner !== false) return this.hit(from, to, t, len, tx, ty, owner);
    }
  }

  lineOfSight(from: Vec2, to: Vec2, ignoreOwner?: EntityId): boolean {
    return this.castSegment(from, to, ignoreOwner === undefined ? {} : { ignoreOwner }) === null;
  }

  // ── Free tiles ────────────────────────────────────────────────────────────

  nearestFreeTile(p: Vec2, options: FreeTileOptions = {}): Vec2 | null {
    const clearance = options.clearancePx ?? 0;
    const maxRing = options.maxRadiusTiles ?? Math.max(this.widthTiles, this.heightTiles);
    const origin = this.tileAt(p);
    const ts = this.tileSizePx;
    let best: Vec2 | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (let ring = 0; ring <= maxRing; ring++) {
      // Every tile centre in this ring is at least (ring − 1) tiles from p.
      if (best && (ring - 1) * ts > bestD) break;
      for (let ty = origin.ty - ring; ty <= origin.ty + ring; ty++) {
        for (let tx = origin.tx - ring; tx <= origin.tx + ring; tx++) {
          if (Math.max(Math.abs(tx - origin.tx), Math.abs(ty - origin.ty)) !== ring) continue;
          if (this.blockedAt(tx, ty)) continue;
          const centre = this.tileCentre({ tx, ty });
          const d = Math.hypot(centre.x - p.x, centre.y - p.y);
          if (d > bestD - EPSILON_PX) continue;
          if (clearance > 0 && this.overlapsSolid(centre, clearance)) continue;
          if (options.isFree && !options.isFree(centre)) continue;
          best = centre;
          bestD = d;
        }
      }
    }
    return best;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private terrainAt(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.widthTiles || ty >= this.heightTiles) return true;
    return this.terrain[ty * this.widthTiles + tx] === 1;
  }

  private blockedAt(tx: number, ty: number): boolean {
    if (this.terrainAt(tx, ty)) return true;
    return (this.covered[ty * this.widthTiles + tx] ?? 0) > 0;
  }

  /** False when a shot passes; otherwise the owner (null for terrain). */
  private shotBlock(tx: number, ty: number, options: CastOptions): EntityId | null | false {
    const inside = tx >= 0 && ty >= 0 && tx < this.widthTiles && ty < this.heightTiles;
    if (!inside) return null;
    const i = ty * this.widthTiles + tx;
    const owned = (this.shotCovered[i] ?? 0) > 0;
    if (owned) {
      const owner = this.shotOwnerAt(i, options.ignoreOwner);
      if (owner !== undefined) return owner;
      return false;
    }
    return this.terrain[i] === 1 ? null : false;
  }

  /**
   * The lowest-id shot-blocking solid on cell `i` other than `ignore`; undefined when `ignore` is
   * the only one (the shot passes, terrain under it included).
   */
  private shotOwnerAt(i: number, ignore: EntityId | undefined): EntityId | undefined {
    let owner: EntityId | undefined;
    for (const solid of this.solids.values()) {
      if (!solid.spec.blocksShots || solid.spec.id === ignore || !solid.tiles.includes(i)) continue;
      if (owner === undefined || solid.spec.id < owner) owner = solid.spec.id;
    }
    return owner;
  }

  private hit(
    from: Vec2,
    to: Vec2,
    t: number,
    len: number,
    tx: number,
    ty: number,
    owner: EntityId | null,
  ): SegmentHit {
    const at = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    return { distancePx: t * len, at, tile: { tx, ty }, owner };
  }

  /** Cells a rect overlaps (open interior), plus the cell under its centre. In bounds only. */
  private tilesOf(rect: Rect): number[] {
    const ts = this.tileSizePx;
    const x0 = Math.floor((rect.x + EPSILON_PX) / ts);
    const y0 = Math.floor((rect.y + EPSILON_PX) / ts);
    const x1 = Math.floor((rect.x + rect.width - EPSILON_PX) / ts);
    const y1 = Math.floor((rect.y + rect.height - EPSILON_PX) / ts);
    const cells = new Set<number>();
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this.inBounds({ tx, ty })) cells.add(ty * this.widthTiles + tx);
      }
    }
    const centre = this.tileAt({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    if (this.inBounds(centre)) cells.add(this.index(centre));
    return [...cells].sort((a, b) => a - b);
  }

  /**
   * The deepest overlap of the circle with terrain tiles (out of bounds included) and dynamic
   * solids, as the push that resolves it. `buried`: the centre is inside terrain with no free side.
   */
  private deepestContact(
    p: Vec2,
    r: number,
  ): { readonly push: Vec2; readonly buried: boolean } | null {
    const ts = this.tileSizePx;
    let best: { push: Vec2; buried: boolean; depth: number } | null = null;
    const consider = (rect: Rect, terrainTile: TileCoord | null): void => {
      const contact = circleRectPush(p, r, rect, (side) =>
        terrainTile ? !this.terrainAt(terrainTile.tx + side.x, terrainTile.ty + side.y) : true,
      );
      if (contact && (!best || contact.depth > best.depth + EPSILON_PX)) best = contact;
    };
    const x0 = Math.floor((p.x - r) / ts);
    const x1 = Math.floor((p.x + r) / ts);
    const y0 = Math.floor((p.y - r) / ts);
    const y1 = Math.floor((p.y + r) / ts);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!this.terrainAt(tx, ty)) continue;
        consider({ x: tx * ts, y: ty * ts, width: ts, height: ts }, { tx, ty });
      }
    }
    for (const solid of this.solids.values()) consider(solid.spec.rect, null);
    return best;
  }
}

/** Unit offsets of the four sides, in the order they are tried on a tie. */
const SIDES: readonly Vec2[] = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
];

/**
 * The push that separates a circle from a rect, or null when they don't overlap (touching is
 * not overlapping). A centre inside the rect leaves through the nearest side `canExit` allows;
 * with none allowed it is `buried` (depth +∞, no push).
 */
function circleRectPush(
  p: Vec2,
  r: number,
  rect: Rect,
  canExit: (side: Vec2) => boolean,
): { push: Vec2; buried: boolean; depth: number } | null {
  const qx = Math.min(Math.max(p.x, rect.x), rect.x + rect.width);
  const qy = Math.min(Math.max(p.y, rect.y), rect.y + rect.height);
  const dx = p.x - qx;
  const dy = p.y - qy;
  const d = Math.hypot(dx, dy);
  const inside =
    p.x > rect.x && p.x < rect.x + rect.width && p.y > rect.y && p.y < rect.y + rect.height;
  if (!inside) {
    if (d >= r - EPSILON_PX) return null;
    if (d === 0) {
      // Centre exactly on the edge: push straight out of the nearest side.
      return exitPush(p, r, rect, canExit);
    }
    const depth = r - d;
    return { push: { x: (dx / d) * depth, y: (dy / d) * depth }, buried: false, depth };
  }
  return exitPush(p, r, rect, canExit);
}

function exitPush(
  p: Vec2,
  r: number,
  rect: Rect,
  canExit: (side: Vec2) => boolean,
): { push: Vec2; buried: boolean; depth: number } {
  const gaps = [p.x - rect.x, rect.x + rect.width - p.x, p.y - rect.y, rect.y + rect.height - p.y];
  let side: Vec2 | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const [i, candidate] of SIDES.entries()) {
    const gap = gaps[i] ?? Number.POSITIVE_INFINITY;
    if (gap < bestGap && canExit(candidate)) {
      side = candidate;
      bestGap = gap;
    }
  }
  if (!side) return { push: ZERO, buried: true, depth: Number.POSITIVE_INFINITY };
  const depth = bestGap + r;
  return { push: { x: side.x * depth, y: side.y * depth }, buried: false, depth };
}

function isPositiveInteger(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}
