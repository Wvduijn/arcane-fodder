/**
 * Area events (GDD §0 area hit rule, §4, §7, §8): Fireball, Lightning, Combust and Kaboom blasts.
 * The one way an area effect damages units; it builds on `applyEventHits`, so every event keeps
 * its per-event gib cap (M4 T3 n3).
 *
 * API:
 * - `bodiesInRadius(centre, radiusPx, bodies)`: ids of the living bodies the ring touches,
 *   `distance(centre, body) ≤ radiusPx + bodyRadiusPx` (the body rule), in ascending EntityId order.
 *   Generic: units and kegs alike.
 * - `resolveAreaEvent(event, units, ctx)`: one blast on the CombatWorld's units.
 *   1. Targets: living units of `event.teams` whose position (from `units`) is in range by the body
 *      rule, radius from the world. A unit without a position in `units` is not hit.
 *   2. Damage: one `applyEventHits` call, ascending id. A unit of team T takes
 *      `round(blast.damage × damageMultiplier[T])` (default 1; Kaboom halves it on wizards). HP is
 *      an integer (GDD §0), so a multiplied hit is rounded to the nearest whole HP (halves up). The
 *      gib check uses that rounded damage, so a halved hit can fall below the gib threshold.
 *   3. Status: `blast.applies` lands on survivors of `statusTeams` (default `teams`), except
 *      `statusExcept` (the Combust origin), ascending id.
 *   4. Knockback: every survivor gets a push request of `blast.knockbackPx` straight away from the
 *      centre. A unit exactly on the centre gets none (no direction). The caller applies them
 *      (`knockEnemy`, `knockSquadMember`), which also honours `takesKnockback`.
 *   The result lists hits (for `unit:damaged`: amount `dealt`, element `blast.element`, source
 *   `event.sourceId`), this event's deaths (for the frame's flush), status results (emit
 *   `status:applied` for `'applied'`) and knockbacks. Kegs are not units: the reaction code finds
 *   them with `bodiesInRadius` (reactions.ts).
 */
import type {
  AreaBlastDef,
  EntityId,
  GibTuning,
  StatusDef,
  StatusId,
  Team,
  Vec2,
} from '@core/types';
import { applyEventHits, type Hit, type HitResult } from '@core/combat/damage';
import type { DeathRecord } from '@core/combat/death';
import { applyStatus, type StatusApplyResult } from '@core/combat/status';
import type { CombatWorld } from '@core/combat/world';
import { distance, length, normalize, sub } from '@core/math/vec2';

/** Anything an area ring can touch. */
export interface AreaBody {
  readonly id: EntityId;
  readonly position: Vec2;
  readonly bodyRadiusPx: number;
  readonly alive: boolean;
}

/** Where a CombatWorld unit stands this frame. */
export interface UnitPosition {
  readonly id: EntityId;
  readonly position: Vec2;
}

export interface AreaEvent {
  readonly centre: Vec2;
  readonly blast: AreaBlastDef;
  /** `unit:damaged.source` and status credit. The keg's id for Kaboom (squad-side, GDD §0). */
  readonly sourceId: EntityId | null;
  /** Teams the blast damages. */
  readonly teams: readonly Team[];
  /** Per-team damage factor, default 1. */
  readonly damageMultiplier?: Readonly<Partial<Record<Team, number>>>;
  /** Teams `blast.applies` lands on; default `teams`. */
  readonly statusTeams?: readonly Team[];
  /** Never receives the status (the Combust origin). */
  readonly statusExcept?: EntityId;
}

export interface AreaContext {
  readonly world: CombatWorld;
  readonly statuses: Readonly<Record<StatusId, StatusDef>>;
  readonly gibs: GibTuning;
}

export interface AreaStatus {
  readonly target: EntityId;
  readonly status: StatusId;
  readonly result: Exclude<StatusApplyResult, null>;
}

export interface AreaKnockback {
  readonly target: EntityId;
  /** Unit vector, away from the centre. */
  readonly direction: Vec2;
  readonly distancePx: number;
}

export interface AreaEventResult {
  /** Every unit the ring touched, ascending id. */
  readonly hits: readonly HitResult[];
  /** This event's kills, ascending id. */
  readonly deaths: readonly DeathRecord[];
  readonly statuses: readonly AreaStatus[];
  readonly knockbacks: readonly AreaKnockback[];
}

export function bodiesInRadius(
  centre: Vec2,
  radiusPx: number,
  bodies: readonly AreaBody[],
): EntityId[] {
  return bodies
    .filter((b) => b.alive && distance(centre, b.position) <= radiusPx + b.bodyRadiusPx)
    .map((b) => b.id)
    .sort((a, b) => a - b);
}

/** One blast on the world's units. See the module comment for the order of resolution. */
export function resolveAreaEvent(
  event: AreaEvent,
  units: readonly UnitPosition[],
  ctx: AreaContext,
): AreaEventResult {
  const { world } = ctx;
  const { blast, centre } = event;
  const positions = new Map<EntityId, Vec2>();
  const bodies: AreaBody[] = [];
  for (const { id, position } of units) {
    const unit = world.get(id);
    if (!unit?.alive || !event.teams.includes(unit.team)) continue;
    positions.set(id, position);
    bodies.push({ id, position, bodyRadiusPx: unit.bodyRadiusPx, alive: true });
  }
  const targets = bodiesInRadius(centre, blast.radiusPx, bodies);

  const base: Hit = { ...blast, sourceId: event.sourceId };
  const hits = applyEventHits(
    world,
    targets,
    (unit) => {
      const factor = event.damageMultiplier?.[unit.team] ?? 1;
      return factor === 1 ? base : { ...base, damage: Math.round(blast.damage * factor) };
    },
    ctx.gibs,
  );

  const deaths: DeathRecord[] = [];
  const survivors: EntityId[] = [];
  for (const h of hits) {
    if (h.killed) deaths.push(h.death);
    else if (h.landed) survivors.push(h.target);
  }

  const statuses: AreaStatus[] = [];
  if (blast.applies) {
    const def = ctx.statuses[blast.applies];
    const statusTeams = event.statusTeams ?? event.teams;
    for (const target of survivors) {
      const team = world.get(target)?.team;
      if (target === event.statusExcept || team === undefined || !statusTeams.includes(team)) {
        continue;
      }
      const result = applyStatus(world, target, def, event.sourceId);
      if (result) statuses.push({ target, status: def.id, result });
    }
  }

  const knockbacks: AreaKnockback[] = [];
  if (blast.knockbackPx > 0) {
    for (const target of survivors) {
      const position = positions.get(target);
      if (!position) continue;
      const away = sub(position, centre);
      if (length(away) === 0) continue;
      knockbacks.push({ target, direction: normalize(away), distancePx: blast.knockbackPx });
    }
  }

  return { hits, deaths, statuses, knockbacks };
}
