/**
 * Enemy navigation (M7, CD Q2): a distance field toward the wizards on the tile grid. Goblins walk
 * straight at their target; only when that straight line is blocked (a tree wall, the river) do
 * they follow the field downhill, so a chasing pack and the aggro-`always` surge (GDD §13) find the
 * way round instead of piling up on a wall.
 *
 * API:
 * - `new FlowField(grid)`: an empty field (every tile unreachable) over a CollisionGrid.
 * - `field.build(goals)`: rebuilds the field from scratch toward the nearest goal (the wizards'
 *   positions). A goal on a blocked tile seeds the nearest free tile instead. Dijkstra over
 *   walkable tiles (`!grid.isBlockedTile`), 8-way: orthogonal steps cost 10, diagonal 14, and a
 *   diagonal step is allowed only when both orthogonal neighbours are walkable (no corner
 *   cutting). Dynamic solids (kegs, huts) count as blocked from the next build on.
 * - `field.distanceAt(p)`: cost-units from the tile under `p` to the nearest goal (10 per tile),
 *   `Infinity` when unreachable or before the first build.
 * - `field.directionAt(p)`: unit vector from `p` to the centre of the neighbouring tile that is
 *   most downhill (same no-corner-cutting rule; ties keep the first in N, E, S, W, NE, SE, SW, NW
 *   order), or {0,0} when the tile under `p` is a goal, nothing downhill exists, or the field is
 *   unreachable from here. A `p` on a blocked tile (a body brushing a keg's tile) still gets the
 *   best walkable neighbour.
 * - `new FlowFieldClock(rebuildMs)` / `clock.step(dtMs)`: the fixed rebuild interval. `step`
 *   returns true on the first call and then whenever `rebuildMs` has passed since the last true
 *   (the remainder carries, so the cadence doesn't drift with frame rate; a hitch longer than
 *   the interval fires once, not a burst). `clock.invalidate()`
 *   forces the next `step` to return true (a keg went off, a hut fell). The interval is tuning:
 *   game-designer owns it (`NavigationTuning.flowFieldRebuildMs`), core takes it as a number.
 * - `steerToward(input)`: the enemy-step rule. Returns `input.desired` (the brain's direction)
 *   when it doesn't head toward the target, when there is no field, or when a body of
 *   `radiusPx` can walk the straight line to the target (`input.straightClear`, default
 *   `grid.pathClear`); otherwise the field's
 *   `directionAt`, falling back to `desired` where the field has no answer.
 */
import type { Vec2 } from '@core/types';
import type { CollisionGrid, TileCoord } from '@core/world/collisionGrid';

/** Dijkstra step costs (integers, so ties are exact). Not tuning: they encode 1 and √2. */
const ORTHOGONAL = 10;
const DIAGONAL = 14;
const UNREACHABLE = 0x7fffffff;
const ZERO: Vec2 = { x: 0, y: 0 };
/** Float slack for summed frame deltas (not a tuning value). */
const EPSILON_MS = 1e-6;

/** N, E, S, W, then NE, SE, SW, NW. Diagonals list the two orthogonals they pass. */
const NEIGHBOURS: readonly {
  readonly dx: number;
  readonly dy: number;
  readonly cost: number;
}[] = [
  { dx: 0, dy: -1, cost: ORTHOGONAL },
  { dx: 1, dy: 0, cost: ORTHOGONAL },
  { dx: 0, dy: 1, cost: ORTHOGONAL },
  { dx: -1, dy: 0, cost: ORTHOGONAL },
  { dx: 1, dy: -1, cost: DIAGONAL },
  { dx: 1, dy: 1, cost: DIAGONAL },
  { dx: -1, dy: 1, cost: DIAGONAL },
  { dx: -1, dy: -1, cost: DIAGONAL },
];

export class FlowField {
  private readonly grid: CollisionGrid;
  private readonly dist: Int32Array;
  private readonly heap: MinHeap;

  constructor(grid: CollisionGrid) {
    this.grid = grid;
    this.dist = new Int32Array(grid.widthTiles * grid.heightTiles).fill(UNREACHABLE);
    // Every relaxation pushes once (≤ 8 per tile), plus one seed per tile.
    this.heap = new MinHeap(grid.widthTiles * grid.heightTiles * (NEIGHBOURS.length + 1));
  }

  build(goals: readonly Vec2[]): void {
    const { grid, dist, heap } = this;
    const w = grid.widthTiles;
    dist.fill(UNREACHABLE);
    heap.clear();
    for (const goal of goals) {
      let tile = grid.tileAt(goal);
      if (grid.isBlockedTile(tile)) {
        const free = grid.nearestFreeTile(goal);
        if (!free) continue;
        tile = grid.tileAt(free);
      }
      const i = grid.index(tile);
      if (dist[i] !== 0) {
        dist[i] = 0;
        heap.push(i, 0);
      }
    }
    while (heap.size > 0) {
      const { index: i, key: d } = heap.pop();
      if (d !== dist[i]) continue;
      const tx = i % w;
      const ty = (i - tx) / w;
      for (const n of NEIGHBOURS) {
        const nx = tx + n.dx;
        const ny = ty + n.dy;
        if (!this.canStep(tx, ty, n.dx, n.dy)) continue;
        const j = ny * w + nx;
        const nd = d + n.cost;
        if (nd < (dist[j] ?? UNREACHABLE)) {
          dist[j] = nd;
          heap.push(j, nd);
        }
      }
    }
  }

  distanceAt(p: Vec2): number {
    const tile = this.grid.tileAt(p);
    if (!this.grid.inBounds(tile)) return Number.POSITIVE_INFINITY;
    const d = this.dist[this.grid.index(tile)] ?? UNREACHABLE;
    return d === UNREACHABLE ? Number.POSITIVE_INFINITY : d;
  }

  directionAt(p: Vec2): Vec2 {
    const { grid } = this;
    const tile = grid.tileAt(p);
    if (!grid.inBounds(tile)) return ZERO;
    const here = grid.isBlockedTile(tile)
      ? UNREACHABLE
      : (this.dist[grid.index(tile)] ?? UNREACHABLE);
    if (here === 0) return ZERO;
    let best: TileCoord | null = null;
    let bestD = here;
    for (const n of NEIGHBOURS) {
      if (!this.canStep(tile.tx, tile.ty, n.dx, n.dy)) continue;
      const next = { tx: tile.tx + n.dx, ty: tile.ty + n.dy };
      const d = this.dist[grid.index(next)] ?? UNREACHABLE;
      if (d < bestD) {
        best = next;
        bestD = d;
      }
    }
    if (!best) return ZERO;
    const c = grid.tileCentre(best);
    const dx = c.x - p.x;
    const dy = c.y - p.y;
    const len = Math.hypot(dx, dy);
    return len === 0 ? ZERO : { x: dx / len, y: dy / len };
  }

  /** A step to a walkable neighbour; diagonals need both orthogonals walkable. */
  private canStep(tx: number, ty: number, dx: number, dy: number): boolean {
    const g = this.grid;
    if (g.isBlockedTile({ tx: tx + dx, ty: ty + dy })) return false;
    if (dx === 0 || dy === 0) return true;
    return !g.isBlockedTile({ tx: tx + dx, ty }) && !g.isBlockedTile({ tx, ty: ty + dy });
  }
}

export class FlowFieldClock {
  private readonly rebuildMs: number;
  private sinceMs = 0;
  private due = true;

  constructor(rebuildMs: number) {
    if (!(rebuildMs > 0) || !Number.isFinite(rebuildMs)) {
      throw new RangeError(`rebuildMs must be a positive number, got ${String(rebuildMs)}`);
    }
    this.rebuildMs = rebuildMs;
  }

  step(dtMs: number): boolean {
    this.sinceMs += Math.max(0, dtMs);
    if (this.due) {
      this.due = false;
      this.sinceMs = 0;
      return true;
    }
    if (this.sinceMs < this.rebuildMs - EPSILON_MS) return false;
    // A hitch fires once; whole missed intervals are dropped, the remainder carries.
    this.sinceMs = Math.max(0, this.sinceMs - this.rebuildMs) % this.rebuildMs;
    return true;
  }

  invalidate(): void {
    this.due = true;
  }
}

export interface SteerInput {
  readonly grid: CollisionGrid;
  readonly field: FlowField;
  readonly position: Vec2;
  readonly radiusPx: number;
  /** The brain's unit direction (or {0,0}). */
  readonly desired: Vec2;
  /** The position it is chasing, or null. */
  readonly target: Vec2 | null;
  /**
   * Can the body walk the straight line? Asked only when it matters (heading for the target);
   * default `grid.pathClear`. The enemy step passes a cached answer (enemyMovement.ts).
   */
  readonly straightClear?: () => boolean;
}

export function steerToward(input: SteerInput): Vec2 {
  const { desired, target, position } = input;
  if (target === null || (desired.x === 0 && desired.y === 0)) return desired;
  const heading = desired.x * (target.x - position.x) + desired.y * (target.y - position.y);
  if (heading <= 0) return desired;
  const clear = input.straightClear
    ? input.straightClear()
    : input.grid.pathClear(position, target, input.radiusPx);
  if (clear) return desired;
  const dir = input.field.directionAt(position);
  return dir.x === 0 && dir.y === 0 ? desired : dir;
}

/** Binary min-heap of (index, key) pairs on typed arrays; duplicates allowed (lazy deletion). */
class MinHeap {
  private readonly indices: Int32Array;
  private readonly keys: Int32Array;
  size = 0;

  constructor(capacity: number) {
    this.indices = new Int32Array(capacity);
    this.keys = new Int32Array(capacity);
  }

  clear(): void {
    this.size = 0;
  }

  push(index: number, key: number): void {
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const pk = this.keys[parent] ?? 0;
      if (pk <= key) break;
      this.indices[i] = this.indices[parent] ?? 0;
      this.keys[i] = pk;
      i = parent;
    }
    this.indices[i] = index;
    this.keys[i] = key;
  }

  pop(): { index: number; key: number } {
    const top = { index: this.indices[0] ?? 0, key: this.keys[0] ?? 0 };
    const last = --this.size;
    const li = this.indices[last] ?? 0;
    const lk = this.keys[last] ?? 0;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= last) break;
      const r = l + 1;
      const c = r < last && (this.keys[r] ?? 0) < (this.keys[l] ?? 0) ? r : l;
      if ((this.keys[c] ?? 0) >= lk) break;
      this.indices[i] = this.indices[c] ?? 0;
      this.keys[i] = this.keys[c] ?? 0;
      i = c;
    }
    this.indices[i] = li;
    this.keys[i] = lk;
    return top;
  }
}
