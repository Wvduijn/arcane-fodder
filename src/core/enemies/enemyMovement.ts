/**
 * Authoritative enemy state (position, velocity, knockback, brain) and its per-frame step (M4).
 * HP and alive/dead live in the CombatWorld; this module takes `isAlive` from it.
 *
 * API:
 * - `createEnemy(id, def, position, options)`: an idle goblin standing still. `options.aggro`
 *   (`'always'` for the surge) goes to its brain; `options.post` makes it hold an archer post
 *   (goblin.ts).
 * - `alertEnemies(enemies, ids)`: those enemies aggro at any range from now on (trigger
 *   `alert-group`). Others are returned as they are.
 * - `knockEnemy(enemy, def, direction, distancePx, durationMs)`: adds a knockback push (a no-op if
 *   `def.takesKnockback` is false or the distance is 0). Call it on a landed, non-lethal hit.
 * - `stepEnemies(enemies, input)`: one frame for every enemy, in ascending EntityId order:
 *   brains decide (goblin.ts), then `moveEnemies` moves the bodies. Returns the new states (same
 *   order as given) and the attacks released this frame, ordered by enemy id.
 * - `moveEnemies(enemies, intents, input)`: the body step. Per living enemy:
 *   1. Walk: `moveDirection × def.moveSpeed × dt`, plus this frame's knockback displacement.
 *   2. Separate from other living enemies: every pair closer than the sum of their body radii is
 *      pushed apart, half the overlap each, along the line between them (positions after step 1,
 *      so the result does not depend on processing order). An enemy's total separation per frame
 *      is capped at its own `moveSpeed × dt`, so crowds settle without jumps.
 *   3. Yield to wizards (M4 Q2): an enemy overlapping a living wizard is moved out to touching,
 *      along the wizard → enemy line. Wizards are never pushed by goblins.
 *   4. Clamp the body circle inside `input.bounds`. With `input.collision` (M7), the body then
 *      walks from where it stood to that point on the tile grid (`moveCircle`): it slides along
 *      blockers and kegs and is pushed out of them, and never tunnels.
 *   Navigation (M7, CD Q2): with `input.collision` and `input.navigation`, step 1's direction goes
 *   through `steerToward` (flowField.ts): while the brain walks toward its target and a body of its
 *   radius can't walk the straight line there, it follows the flow field instead. The straight-line answer
 *   (`grid.pathClear`, a swept circle, the costly part) is cached per enemy in `EnemyState.nav`
 *   and only recomputed when `input.refreshNavigation` is not false (pass the flow-field clock's
 *   tick, 250 ms), or when the enemy has no answer yet for its current goal. So it is at most one
 *   rebuild interval stale: a goblin that just lost sight walks straight into the wall and slides
 *   for up to that long; one that just regained it follows the field (which leads the same way).
 *   Velocity is the frame's actual displacement / dt. A dead enemy never moves and takes no part in
 *   separation (D4); it reports zero velocity and drops its pushes, so a view never animates a
 *   walking corpse. Coincident centres separate along +x / −x by id (lower id goes −x) and yield
 *   along −y, so ties stay deterministic.
 *
 * Sight (M7, CD Q3): with `input.collision`, brains get `lineOfSight` (blockers and huts block,
 * kegs don't), so archers only draw at a wizard they can see.
 *
 * Known limit: a wizard pinning a goblin against the bounds or a wall can leave them overlapping
 * (the wall wins over the yield).
 */
import type { EnemyDef, EnemyId, EntityId, Rect, Vec2, WaveAggro } from '@core/types';
import {
  alertGoblin,
  createGoblinBrain,
  stepGoblin,
  type GoblinAction,
  type GoblinBrain,
  type GoblinPost,
  type WizardView,
} from '@core/ai/goblin';
import type { CollisionGrid } from '@core/world/collisionGrid';
import { steerToward, type FlowField } from '@core/world/flowField';
import { startKnockback, stepKnockbacks, type Knockback } from '@core/combat/knockback';
import { clampToRect } from '@core/math/movement';
import { add, distance, length, normalize, scale, sub } from '@core/math/vec2';

export interface EnemyState {
  readonly id: EntityId;
  readonly enemy: EnemyId;
  readonly position: Vec2;
  /** px/s over the last step. */
  readonly velocity: Vec2;
  readonly knockbacks: readonly Knockback[];
  readonly brain: GoblinBrain;
  /** The archer post it holds until aggro, or null. */
  readonly post: GoblinPost | null;
  /** Cached "can it walk straight to its goal" (navigation), or null before the first ask. */
  readonly nav: NavCache | null;
}

export interface NavCache {
  /** The wizard it was asked for. */
  readonly goal: EntityId | null;
  readonly straightClear: boolean;
}

export interface EnemyOptions {
  readonly aggro?: WaveAggro;
  readonly post?: GoblinPost;
}

export interface EnemyStepInput {
  readonly defs: Readonly<Record<EnemyId, EnemyDef>>;
  /** Wizards after this frame's squad step. Dead ones are ignored. */
  readonly wizards: readonly WizardView[];
  /** World bounds; each enemy's body circle is kept inside. */
  readonly bounds: Rect;
  readonly isAlive: (id: EntityId) => boolean;
  readonly dtMs: number;
  /** Blockers and solids (M7). Absent: open ground. */
  readonly collision?: CollisionGrid;
  /** Flow field toward the wizards (M7, CD Q2); used only with `collision`. */
  readonly navigation?: FlowField;
  /**
   * Recompute the cached straight-line answers this step (the flow-field clock ticked).
   * Default true: every step, exact but costly.
   */
  readonly refreshNavigation?: boolean;
}

export interface EnemyIntent {
  /** Unit vector or {0,0}. */
  readonly moveDirection: Vec2;
}

export type EnemyAction = GoblinAction & { readonly enemyId: EntityId };

export interface EnemyStepResult {
  readonly enemies: readonly EnemyState[];
  readonly actions: readonly EnemyAction[];
}

const ZERO: Vec2 = { x: 0, y: 0 };
const SEPARATE_FALLBACK: Vec2 = { x: 1, y: 0 };
const YIELD_FALLBACK: Vec2 = { x: 0, y: -1 };

export function createEnemy(
  id: EntityId,
  def: EnemyDef,
  position: Vec2,
  options: EnemyOptions = {},
): EnemyState {
  return {
    id,
    enemy: def.id,
    position,
    velocity: ZERO,
    knockbacks: [],
    brain: createGoblinBrain(def, options.aggro === undefined ? {} : { aggro: options.aggro }),
    post: options.post ?? null,
    nav: null,
  };
}

export function alertEnemies(
  enemies: readonly EnemyState[],
  ids: ReadonlySet<EntityId>,
): EnemyState[] {
  return enemies.map((e) => (ids.has(e.id) ? { ...e, brain: alertGoblin(e.brain) } : e));
}

export function knockEnemy(
  enemy: EnemyState,
  def: EnemyDef,
  direction: Vec2,
  distancePx: number,
  durationMs: number,
): EnemyState {
  if (!def.takesKnockback) return enemy;
  const push = startKnockback(direction, distancePx, durationMs);
  return push ? { ...enemy, knockbacks: [...enemy.knockbacks, push] } : enemy;
}

export function stepEnemies(
  enemies: readonly EnemyState[],
  input: EnemyStepInput,
): EnemyStepResult {
  const actions: EnemyAction[] = [];
  const grid = input.collision;
  const lineOfSight = grid ? (from: Vec2, to: Vec2) => grid.lineOfSight(from, to) : undefined;
  const thought = enemies.map((enemy) => {
    const step = stepGoblin(enemy.brain, {
      def: input.defs[enemy.enemy],
      self: { id: enemy.id, position: enemy.position, alive: input.isAlive(enemy.id) },
      wizards: input.wizards,
      dtMs: input.dtMs,
      ...(enemy.post ? { post: enemy.post } : {}),
      ...(lineOfSight ? { lineOfSight } : {}),
    });
    for (const action of step.actions) actions.push({ ...action, enemyId: enemy.id });
    return {
      enemy: { ...enemy, brain: step.brain },
      intent: { moveDirection: step.moveDirection },
    };
  });
  const moved = moveEnemies(
    thought.map((t) => t.enemy),
    thought.map((t) => t.intent),
    input,
  );
  actions.sort((a, b) => a.enemyId - b.enemyId);
  return { enemies: moved, actions };
}

/** The body step; `intents[i]` belongs to `enemies[i]`. See the module comment. */
export function moveEnemies(
  enemies: readonly EnemyState[],
  intents: readonly EnemyIntent[],
  input: EnemyStepInput,
): EnemyState[] {
  const dt = input.dtMs;
  if (dt <= 0) return [...enemies];
  const living = enemies.map((e) => input.isAlive(e.id));

  // 1. Walk and knockback.
  const knock = enemies.map((e, i) => (living[i] ? stepKnockbacks(e.knockbacks, dt) : null));
  const navs = enemies.map((e) => e.nav);
  const walked = enemies.map((e, i) => {
    const step = knock[i];
    if (!step) return e.position;
    const def = input.defs[e.enemy];
    const nav = navigate(e, intents[i]?.moveDirection ?? ZERO, def, input);
    navs[i] = nav.cache;
    return add(add(e.position, scale(nav.dir, (def.moveSpeed * dt) / 1000)), step.displacement);
  });

  // 2. Separation, from the walked positions (order independent).
  const separated = walked.map((p, i) => {
    const self = enemies[i];
    if (!self || !living[i]) return p;
    const r = input.defs[self.enemy].bodyRadiusPx;
    let push = ZERO;
    walked.forEach((q, j) => {
      const other = enemies[j];
      if (j === i || !other || !living[j]) return;
      const overlap = r + input.defs[other.enemy].bodyRadiusPx - distance(p, q);
      if (overlap <= 0) return;
      const away = sub(p, q);
      const dir =
        length(away) > 0 ? normalize(away) : scale(SEPARATE_FALLBACK, self.id < other.id ? -1 : 1);
      push = add(push, scale(dir, overlap / 2));
    });
    const cap = (input.defs[self.enemy].moveSpeed * dt) / 1000;
    const len = length(push);
    return add(p, len > cap ? scale(push, cap / len) : push);
  });

  // 3. Yield to wizards (ascending id), 4. clamp.
  const wizards = input.wizards.filter((w) => w.alive).sort((a, b) => a.id - b.id);
  return enemies.map((e, i) => {
    const step = knock[i];
    if (!step)
      return e.velocity === ZERO && e.knockbacks.length === 0
        ? e
        : { ...e, velocity: ZERO, knockbacks: [] };
    const r = input.defs[e.enemy].bodyRadiusPx;
    let p = separated[i] ?? e.position;
    for (const w of wizards) {
      const contact = r + w.bodyRadiusPx;
      const away = sub(p, w.position);
      if (length(away) >= contact) continue;
      const dir = length(away) > 0 ? normalize(away) : YIELD_FALLBACK;
      p = add(w.position, scale(dir, contact));
    }
    const clamped = clampToRect(p, input.bounds, r);
    const position = input.collision ? input.collision.moveCircle(e.position, clamped, r) : clamped;
    return {
      ...e,
      position,
      velocity: scale(sub(position, e.position), 1000 / dt),
      knockbacks: step.active,
      nav: navs[i] ?? null,
    };
  });
}

/**
 * Step 1's direction: the brain's, or the flow field's when the straight line to its target wizard
 * is blocked; plus the updated straight-line cache.
 */
function navigate(
  e: EnemyState,
  desired: Vec2,
  def: EnemyDef,
  input: EnemyStepInput,
): { readonly dir: Vec2; readonly cache: NavCache | null } {
  const { collision: grid, navigation: field } = input;
  if (!grid || !field) return { dir: desired, cache: e.nav };
  const wizard = input.wizards.find((w) => w.id === e.brain.target && w.alive);
  const goal = wizard ? wizard.id : null;
  const target = wizard?.position ?? null;
  let cache = e.nav;
  const straightClear = (): boolean => {
    if (input.refreshNavigation !== false || cache?.goal !== goal || target === null) {
      const clear = target !== null && grid.pathClear(e.position, target, def.bodyRadiusPx);
      cache = { goal, straightClear: clear };
    }
    return cache.straightClear;
  };
  const dir = steerToward({
    grid,
    field,
    position: e.position,
    radiusPx: def.bodyRadiusPx,
    desired,
    target,
    straightClear,
  });
  return { dir, cache };
}
