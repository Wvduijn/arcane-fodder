/**
 * Area events (GDD §0 area hit rule, §4, §7, §8): Fireball, Lightning, Combust and Kaboom blasts.
 * The one way an area effect damages units; it builds on `applyEventHits`, so every event keeps
 * its per-event gib cap (M4 T3 n3).
 *
 * API:
 * - `bodiesInRadius(centre, radiusPx, bodies)`: ids of the living bodies the ring touches,
 *   `distance(centre, body) ≤ radiusPx + bodyRadiusPx` (the body rule), in ascending EntityId order.
 *   Generic: units and kegs alike. A body with `footprintPx` (a Goblin Hut, GDD §0 table) is
 *   touched instead when the distance from the centre to the closest point of its square footprint
 *   (side `footprintPx`, centred on its position) is ≤ radiusPx (M7 T11b); its body radius is
 *   then not used. `ringTouches(centre, radiusPx, body)` is the single-body test.
 *   `resolveAreaEvent` and `applyAreaStatus` take the footprint from the world unit
 *   (`CombatUnitSpec.footprintPx`), so every blast (Fireball, Lightning, Combust, Kaboom,
 *   Convergence strikes, the Volunteer detonation, burning ground) hits huts by their footprint.
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
 * - `applyAreaStatus(event, units, ctx)`: a status, no damage, on the living units of `event.teams`
 *   the ring touches (body rule), ascending id: Meteor's burning ground (M6). Not a hit: no
 *   `unit:damaged`, no reactions, no kegs, no knockback. Returns the status results, like step 3.
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
import type { CombatUnitSpec, CombatWorld } from '@core/combat/world';
import { distance, length, normalize, sub } from '@core/math/vec2';

/** Anything an area ring can touch. */
export interface AreaBody {
  readonly id: EntityId;
  readonly position: Vec2;
  readonly bodyRadiusPx: number;
  readonly alive: boolean;
  /** Square footprint side (huts): area rings test its closest point instead of the body circle. */
  readonly footprintPx?: number;
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
  /**
   * Credit for the reactions this event causes (Combust, reactions.ts); default `sourceId`. The
   * Convergence sets its own reaction id here, so the Combusts it causes charge the meter while its
   * strikes don't (M6 Q3, meter.ts).
   */
  readonly reactionSourceId?: EntityId;
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
    .filter((b) => b.alive && ringTouches(centre, radiusPx, b))
    .map((b) => b.id)
    .sort((a, b) => a - b);
}

/** Does a ring touch this body? The body rule, or the footprint's closest point for a hut. */
export function ringTouches(
  centre: Vec2,
  radiusPx: number,
  body: Pick<AreaBody, 'position' | 'bodyRadiusPx' | 'footprintPx'>,
): boolean {
  if (body.footprintPx === undefined) {
    return distance(centre, body.position) <= radiusPx + body.bodyRadiusPx;
  }
  const half = body.footprintPx / 2;
  const dx = Math.max(0, Math.abs(centre.x - body.position.x) - half);
  const dy = Math.max(0, Math.abs(centre.y - body.position.y) - half);
  return Math.hypot(dx, dy) <= radiusPx;
}

/** A living world unit as an area body (with its footprint, if it has one). */
function unitBody(id: EntityId, position: Vec2, unit: CombatUnitSpec): AreaBody {
  return unit.footprintPx === undefined
    ? { id, position, bodyRadiusPx: unit.bodyRadiusPx, alive: true }
    : { id, position, bodyRadiusPx: unit.bodyRadiusPx, alive: true, footprintPx: unit.footprintPx };
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
    bodies.push(unitBody(id, position, unit));
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

export interface AreaStatusEvent {
  readonly centre: Vec2;
  readonly radiusPx: number;
  readonly status: StatusId;
  /** The status's applier (credit for its ticks). */
  readonly sourceId: EntityId | null;
  readonly teams: readonly Team[];
}

/** A status on every living unit of `event.teams` in range. See the module comment. */
export function applyAreaStatus(
  event: AreaStatusEvent,
  units: readonly UnitPosition[],
  ctx: AreaContext,
): AreaStatus[] {
  const def = ctx.statuses[event.status];
  const statuses: AreaStatus[] = [];
  for (const target of inRange(event.centre, event.radiusPx, event.teams, units, ctx.world)) {
    const result = applyStatus(ctx.world, target, def, event.sourceId);
    if (result) statuses.push({ target, status: def.id, result });
  }
  return statuses;
}

/** Living units of `teams` the ring touches, ascending id. */
function inRange(
  centre: Vec2,
  radiusPx: number,
  teams: readonly Team[],
  units: readonly UnitPosition[],
  world: CombatWorld,
): EntityId[] {
  const bodies: AreaBody[] = [];
  for (const { id, position } of units) {
    const unit = world.get(id);
    if (!unit?.alive || !teams.includes(unit.team)) continue;
    bodies.push(unitBody(id, position, unit));
  }
  return bodiesInRadius(centre, radiusPx, bodies);
}
