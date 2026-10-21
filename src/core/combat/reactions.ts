/**
 * Elemental reactions (GDD §7 Combust, §8 Kaboom) and the keg triggers of every hit. CombatSystem
 * calls these instead of `applyHit` / `resolveAreaEvent` wherever a reaction can follow, so every
 * frame's reactions run through one place.
 *
 * API:
 * - `resolveUnitHit(target, hit, ctx)`: one single-target hit (an auto, an arrow, a melee swing)
 *   through `applyHit`, then Combust if it qualifies. Statuses and knockback of the hit itself stay
 *   with the caller, as before (damage.ts). Autos never trigger kegs (GDD Q12), so this lists none
 *   except through a Combust.
 * - `resolveAreaWithReactions(event, ctx)`: one area event (Fireball, Lightning, a Combust or
 *   Kaboom blast) through `resolveAreaEvent`, then a Combust for every qualifying target (ascending
 *   id), and the idle kegs its ring touches if its element lights kegs. Its Combusts are credited to
 *   `event.reactionSourceId` when set (the Convergence's reaction id, M6 Q3), else `event.sourceId`.
 * - `resolveKaboom(keg, ctx)`: a keg whose fuse ended (keg.ts `stepKegs`): its blast on everything
 *   in `kaboom.blast.radiusPx`: enemies, wizards at `squadDamageMultiplier`, Burning on enemies only,
 *   knockback on every survivor (wizards included), credit to the keg (GDD §0). Other idle kegs in
 *   range are listed to trigger (the cascade). A Kaboom blast can itself Combust nothing: it is fire.
 *
 * Combust (GDD §7): a hit whose element is `combust.triggerElement` lands on a unit that had
 * `combust.status` at that moment. Decided on the status *before* the hit: Lightning (30) kills
 * every MVP goblin outright, and death clears statuses, yet Lightning on a burning goblin always
 * Combusts (M5 D4). The origin then loses the status (if `consumesStatus` and it survived), and the
 * blast goes off at the origin's position: fire damage to enemy units in range, the origin included
 * (a no-op if it is dead), Burning to every survivor except the origin, kegs in range listed (the
 * blast is fire). Credit goes to the storm hit's source. A second storm hit on the same unit in the
 * same frame finds no Burning and is plain; a neighbour that just caught Burning from a Combust can
 * Combust on a later storm hit, even in the same frame (chains need storm hits, never fire).
 *
 * Every result carries `reactions` (emit `reaction:triggered` for each, in order: `at`, `origin`,
 * `spreadTo`; credit each blast's hits to its `sourceId`), `kegs` (ids to pass to `triggerKeg`,
 * deduplicated, ascending), and `deaths` (every kill of the call, hit and reactions alike, for the
 * frame's flush). `knockbacks` and `statuses`
 * of every blast are in each blast's `area` result.
 */
import type { CombustDef, DamageElement, EntityId, KaboomDef, ReactionId, Vec2 } from '@core/types';
import {
  bodiesInRadius,
  resolveAreaEvent,
  type AreaBody,
  type AreaContext,
  type AreaEvent,
  type AreaEventResult,
  type UnitPosition,
} from '@core/combat/area';
import { applyHit, type Hit, type HitResult } from '@core/combat/damage';
import type { DeathRecord } from '@core/combat/death';
import { removeStatus } from '@core/combat/status';
import { triggersKeg } from '@core/structures/keg';

export interface ReactionContext extends AreaContext {
  readonly combust: CombustDef;
  readonly kaboom: KaboomDef;
  /** Where every unit stands this frame (dead ones may stay listed until the flush). */
  readonly units: readonly UnitPosition[];
  /** Kegs as area bodies (keg.ts `kegBodies`): only idle ones `alive`. */
  readonly kegs: readonly AreaBody[];
}

export interface ReactionOutcome {
  readonly reaction: ReactionId;
  readonly at: Vec2;
  /** The burning unit (Combust) or the keg (Kaboom). */
  readonly origin: EntityId;
  /** Units that caught (or refreshed) Burning, except the origin. Empty for Kaboom. */
  readonly spreadTo: readonly EntityId[];
  /** Combust only: the origin lost the status (`consumesStatus`, GDD Q15). */
  readonly consumed: boolean;
  /**
   * Credit for this reaction's blast (`unit:damaged.source` of its hits): the storm hit's source,
   * or the event's `reactionSourceId` (Combust); the keg itself (Kaboom, GDD §0).
   */
  readonly sourceId: EntityId | null;
  readonly area: AreaEventResult;
}

export interface ReactionResults {
  readonly reactions: readonly ReactionOutcome[];
  /** Idle kegs to trigger, ascending id. */
  readonly kegs: readonly EntityId[];
  /** Every kill of this call, ascending id. */
  readonly deaths: readonly DeathRecord[];
}

export interface UnitHitResult extends ReactionResults {
  readonly hit: HitResult;
}

export interface AreaWithReactionsResult extends ReactionResults {
  readonly area: AreaEventResult;
}

export interface KaboomResult extends ReactionResults {
  /** The keg's own blast; also `reactions[0].area`. */
  readonly area: AreaEventResult;
}

export function resolveUnitHit(target: EntityId, hit: Hit, ctx: ReactionContext): UnitHitResult {
  const primed = isPrimed(target, hit.element, ctx);
  const result = applyHit(ctx.world, target, hit, ctx.gibs);
  const acc = collector();
  if (result.killed) acc.deaths.push(result.death);
  if (primed && result.landed) combust(target, hit.sourceId, ctx, acc);
  return { hit: result, ...acc.done() };
}

export function resolveAreaWithReactions(
  event: AreaEvent,
  ctx: ReactionContext,
): AreaWithReactionsResult {
  const element = event.blast.element;
  const primed = ctx.units.map((u) => u.id).filter((id) => isPrimed(id, element, ctx));
  const area = resolveAreaEvent(event, ctx.units, ctx);
  const acc = collector();
  acc.deaths.push(...area.deaths);
  if (triggersKeg(element, ctx.kaboom)) {
    acc.kegs.push(...bodiesInRadius(event.centre, event.blast.radiusPx, ctx.kegs));
  }
  const landed = new Set(area.hits.filter((h) => h.landed).map((h) => h.target));
  for (const origin of [...new Set(primed)].sort((a, b) => a - b)) {
    if (landed.has(origin)) combust(origin, event.reactionSourceId ?? event.sourceId, ctx, acc);
  }
  return { area, ...acc.done() };
}

export function resolveKaboom(
  keg: { readonly id: EntityId; readonly position: Vec2 },
  ctx: ReactionContext,
): KaboomResult {
  const { kaboom } = ctx;
  const area = resolveAreaEvent(
    {
      centre: keg.position,
      blast: kaboom.blast,
      sourceId: keg.id,
      teams: ['squad', 'enemy'],
      damageMultiplier: { squad: kaboom.squadDamageMultiplier },
      statusTeams: ['enemy'],
    },
    ctx.units,
    ctx,
  );
  const acc = collector();
  acc.deaths.push(...area.deaths);
  acc.reactions.push({
    reaction: kaboom.id,
    at: keg.position,
    origin: keg.id,
    spreadTo: [],
    consumed: false,
    sourceId: keg.id,
    area,
  });
  if (triggersKeg(kaboom.blast.element, kaboom)) {
    const others = ctx.kegs.filter((k) => k.id !== keg.id);
    acc.kegs.push(...bodiesInRadius(keg.position, kaboom.blast.radiusPx, others));
  }
  return { area, ...acc.done() };
}

/** Would a hit of this element on this unit, right now, Combust? */
function isPrimed(target: EntityId, element: DamageElement, ctx: ReactionContext): boolean {
  if (element !== ctx.combust.triggerElement) return false;
  const unit = ctx.world.get(target);
  return unit?.alive === true && unit.statuses.has(ctx.combust.status);
}

interface Collector {
  readonly reactions: ReactionOutcome[];
  readonly kegs: EntityId[];
  readonly deaths: DeathRecord[];
  done(): ReactionResults;
}

function collector(): Collector {
  const reactions: ReactionOutcome[] = [];
  const kegs: EntityId[] = [];
  const deaths: DeathRecord[] = [];
  return {
    reactions,
    kegs,
    deaths,
    done: () => ({
      reactions,
      kegs: [...new Set(kegs)].sort((a, b) => a - b),
      deaths: [...deaths].sort((a, b) => a.id - b.id),
    }),
  };
}

/** One Combust at `origin` (see the module comment). */
function combust(
  origin: EntityId,
  sourceId: EntityId | null,
  ctx: ReactionContext,
  acc: Collector,
): void {
  const { combust: def } = ctx;
  const at = ctx.units.find((u) => u.id === origin)?.position;
  if (!at) return;
  // A dead origin already lost every status (death.ts); either way it is gone.
  if (def.consumesStatus) removeStatus(ctx.world, origin, def.status);
  const area = resolveAreaEvent(
    { centre: at, blast: def.blast, sourceId, teams: ['enemy'], statusExcept: origin },
    ctx.units,
    ctx,
  );
  acc.deaths.push(...area.deaths);
  acc.reactions.push({
    reaction: def.id,
    at,
    origin,
    spreadTo: area.statuses.map((s) => s.target),
    consumed: def.consumesStatus,
    sourceId,
    area,
  });
  if (triggersKeg(def.blast.element, ctx.kaboom)) {
    acc.kegs.push(...bodiesInRadius(at, def.blast.radiusPx, ctx.kegs));
  }
}
