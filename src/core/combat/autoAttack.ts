/**
 * Wizard auto-attack decision (GDD §3): what to shoot at, and when. Every wizard, leader included.
 *
 * API:
 * - `createAutoAttack()`: no target, cooldown ready.
 * - `stepAutoAttack(state, input)`: one frame. The cooldown ticks (also while moving or without a
 *   target). The target is re-picked (nearest living enemy unit within `attack.rangePx`, hut
 *   fallback, never kegs; selectTarget.ts) every `retargetMs`, or at once when the current target
 *   is dead, gone or out of range. If there is a target and the cooldown is ready, it fires:
 *   `fire.aimAt` is the target's position now (no homing, no lead). Spawn the projectile with
 *   createProjectile at the wizard's position.
 *
 * Sight (M7, CD Q3): with `input.collision`, blockers block target selection. A candidate behind a
 * blocker or a hut is never picked, and a target that goes out of sight is dropped at once like
 * one out of range (`lineOfSightTo`, selectTarget.ts: kegs never block; a hut is seen through its
 * own footprint). Without it, every candidate is visible (open ground, M4–M6).
 *
 * The caller only steps living wizards; a dead wizard has no auto-attack (D4).
 */
import type { EntityId, ProjectileAttackDef, Vec2 } from '@core/types';
import {
  isReady,
  READY,
  tickCooldown,
  triggerCooldown,
  type Cooldown,
} from '@core/combat/cooldown';
import { distance } from '@core/math/vec2';
import {
  lineOfSightTo,
  selectTarget,
  shouldRetarget,
  type TargetCandidate,
} from '@core/targeting/selectTarget';
import type { CollisionGrid } from '@core/world/collisionGrid';

export interface AutoAttackState {
  readonly target: EntityId | null;
  readonly sinceRetargetMs: number;
  readonly cooldown: Cooldown;
}

export interface AutoAttackInput {
  readonly position: Vec2;
  readonly attack: ProjectileAttackDef;
  /** CombatTuning.retargetMs. */
  readonly retargetMs: number;
  /** Enemy-side candidates (units, huts, kegs); dead ones are skipped. */
  readonly candidates: readonly TargetCandidate[];
  readonly dtMs: number;
  /** Blockers block target selection (M7, CD Q3). Absent: everything is visible. */
  readonly collision?: CollisionGrid;
}

export interface AutoAttackStep {
  readonly state: AutoAttackState;
  readonly fire: { readonly target: EntityId; readonly aimAt: Vec2 } | null;
}

export function createAutoAttack(): AutoAttackState {
  return { target: null, sinceRetargetMs: 0, cooldown: READY };
}

export function stepAutoAttack(state: AutoAttackState, input: AutoAttackInput): AutoAttackStep {
  const dt = Math.max(0, input.dtMs);
  let cooldown = tickCooldown(state.cooldown, dt);
  let sinceRetargetMs = state.sinceRetargetMs + dt;
  let target = state.target;
  const current = findValid(target, input);
  let aimAt = current?.position ?? null;
  if (shouldRetarget(sinceRetargetMs, input.retargetMs, current !== null)) {
    target = selectTarget(input.position, input.attack.rangePx, input.candidates, (c) =>
      visible(c, input),
    );
    sinceRetargetMs = 0;
    aimAt = target === null ? null : (findValid(target, input)?.position ?? null);
  }
  if (target === null || aimAt === null || !isReady(cooldown)) {
    return { state: { target, sinceRetargetMs, cooldown }, fire: null };
  }
  cooldown = triggerCooldown(cooldown, input.attack.cooldownMs);
  return { state: { target, sinceRetargetMs, cooldown }, fire: { target, aimAt } };
}

/** The target's candidate if it is still alive, targetable and in range. */
function findValid(target: EntityId | null, input: AutoAttackInput): TargetCandidate | null {
  if (target === null) return null;
  const c = input.candidates.find((candidate) => candidate.id === target);
  if (!c?.alive || c.kind === 'keg') return null;
  return distance(input.position, c.position) <= input.attack.rangePx && visible(c, input)
    ? c
    : null;
}

function visible(c: TargetCandidate, input: AutoAttackInput): boolean {
  return input.collision ? lineOfSightTo(input.collision, input.position, c) : true;
}
