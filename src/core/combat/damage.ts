/**
 * Damage resolution (GDD §0, §9, §12a). The only way HP goes down in combat.
 *
 * API:
 * - `applyHit(world, target, hit, gibs)`: one hit on one unit. Single-target only (autos, melee,
 *   ticks); area events must use `applyEventHits`, or the per-event gib cap is skipped. HP drops by
 *   the damage, clamped to the HP left; `dealt` is what was actually lost (overkill excluded,
 *   GDD §9: `unit:damaged.amount`).
 *   If HP reaches 0 the unit dies here, statuses removed, and the result carries its `DeathRecord`
 *   (variant from the killing blow, gib per `isGibKill`). A dead or unknown target is a no-op:
 *   `landed: false`, nothing dealt (D4).
 * - `applyEventHits(world, targets, hit, gibs)`: one area event on many units, resolved in ascending
 *   EntityId order (GDD §0). At most `gibs.maxGibbedPerEvent` of its kills gib, lowest ids first;
 *   the rest die with their normal variant (GDD §12a).
 *
 * Statuses and knockback are not applied here: the caller applies `hit.applies` (status.ts) and
 * `knockbackPx` (knockback.ts) only when `landed` and not `killed`.
 */
import type { DeathCause, EntityId, GibTuning } from '@core/types';
import type { CombatWorld, UnitCombatState } from '@core/combat/world';
import { deathVariantOf, isGibKill, type DeathRecord, type DeathSource } from '@core/combat/death';

export interface Hit extends DeathSource {
  /** Who dealt it (`unit:damaged.source`), or null. A dead shooter's projectile keeps its id. */
  readonly sourceId: EntityId | null;
}

interface HitBase {
  readonly target: EntityId;
  /** HP actually lost: min(damage, HP before). 0 on a no-op. */
  readonly dealt: number;
  /** False when the target was dead or unknown: nothing happened. */
  readonly landed: boolean;
}

export type HitResult =
  | (HitBase & { readonly killed: false })
  | (HitBase & { readonly killed: true; readonly death: DeathRecord });

const CAUSE: DeathCause = 'combat';

/** One hit on one unit. See the module comment. */
export function applyHit(
  world: CombatWorld,
  target: EntityId,
  hit: Hit,
  gibs: GibTuning,
): HitResult {
  return resolve(world, target, hit, (unit) => isGibKill(hit, unit.team, unit.maxHp, gibs));
}

/** One area event: every target in ascending id order, gibs capped per event. */
export function applyEventHits(
  world: CombatWorld,
  targets: readonly EntityId[],
  hit: Hit,
  gibs: GibTuning,
): HitResult[] {
  let gibbed = 0;
  const ordered = [...new Set(targets)].sort((a, b) => a - b);
  return ordered.map((target) =>
    resolve(world, target, hit, (unit) => {
      if (gibbed >= gibs.maxGibbedPerEvent || !isGibKill(hit, unit.team, unit.maxHp, gibs)) {
        return false;
      }
      gibbed++;
      return true;
    }),
  );
}

function resolve(
  world: CombatWorld,
  target: EntityId,
  hit: Hit,
  gibsOnKill: (unit: UnitCombatState) => boolean,
): HitResult {
  const unit = world.get(target);
  if (!unit?.alive) return { target, dealt: 0, landed: false, killed: false };
  const dealt = Math.min(unit.hp, Math.max(0, hit.damage));
  const hp = unit.hp - dealt;
  if (hp > 0) {
    world.setHp(target, hp);
    return { target, dealt, landed: true, killed: false };
  }
  const { team } = unit;
  const gibbed = gibsOnKill(unit);
  world.markDead(target);
  const death: DeathRecord = {
    id: target,
    team,
    cause: CAUSE,
    deathVariant: deathVariantOf(hit, team),
    gibbed,
  };
  return { target, dealt, landed: true, killed: true, death };
}
