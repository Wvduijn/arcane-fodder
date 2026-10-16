/**
 * Authoritative enemy state (position, velocity, knockback, brain) and its per-frame step (M4).
 * HP and alive/dead live in the CombatWorld; this module takes `isAlive` from it.
 *
 * API:
 * - `createEnemy(id, def, position)`: an idle goblin standing still.
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
 *   4. Clamp the body circle inside `input.bounds`.
 *   Velocity is the frame's actual displacement / dt. A dead enemy never moves and takes no part in
 *   separation (D4); it reports zero velocity and drops its pushes, so a view never animates a
 *   walking corpse. Coincident centres separate along +x / −x by id (lower id goes −x) and yield
 *   along −y, so ties stay deterministic.
 *
 * Known limit: a wizard pinning a goblin against the bounds can leave them overlapping (the clamp
 * wins); M7's tilemap collision revisits this.
 */
import type { EnemyDef, EnemyId, EntityId, Rect, Vec2 } from '@core/types';
import {
  createGoblinBrain,
  stepGoblin,
  type GoblinAction,
  type GoblinBrain,
  type WizardView,
} from '@core/ai/goblin';
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
}

export interface EnemyStepInput {
  readonly defs: Readonly<Record<EnemyId, EnemyDef>>;
  /** Wizards after this frame's squad step. Dead ones are ignored. */
  readonly wizards: readonly WizardView[];
  /** World bounds; each enemy's body circle is kept inside. */
  readonly bounds: Rect;
  readonly isAlive: (id: EntityId) => boolean;
  readonly dtMs: number;
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

export function createEnemy(id: EntityId, def: EnemyDef, position: Vec2): EnemyState {
  return {
    id,
    enemy: def.id,
    position,
    velocity: ZERO,
    knockbacks: [],
    brain: createGoblinBrain(def),
  };
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
  const thought = enemies.map((enemy) => {
    const step = stepGoblin(enemy.brain, {
      def: input.defs[enemy.enemy],
      self: { id: enemy.id, position: enemy.position, alive: input.isAlive(enemy.id) },
      wizards: input.wizards,
      dtMs: input.dtMs,
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
  const walked = enemies.map((e, i) => {
    const step = knock[i];
    if (!step) return e.position;
    const def = input.defs[e.enemy];
    const dir = intents[i]?.moveDirection ?? ZERO;
    return add(add(e.position, scale(dir, (def.moveSpeed * dt) / 1000)), step.displacement);
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
    const position = clampToRect(p, input.bounds, r);
    return {
      ...e,
      position,
      velocity: scale(sub(position, e.position), 1000 / dt),
      knockbacks: step.active,
    };
  });
}
