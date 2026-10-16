/**
 * Death resolution (GDD §0, §12a): which death variant a kill shows, whether it gibs, and the
 * order a frame's deaths are handled in.
 *
 * API:
 * - `DeathRecord`: everything `unit:died` carries. Build the event from it field for field.
 * - `deathVariantOf(source, team)`: the killing blow's look. Wizards always `blood`; otherwise the
 *   source's `deathVariant` override, else the element map (fire → charred, storm → electrified,
 *   physical/arcane → blood). No source (debug kill) → blood.
 * - `isGibKill(source, team, maxHp, gibs)`: `canGib` and raw damage ≥ overkillRatio × maxHp. Never
 *   for wizards (their deaths stay non-gory). The per-event cap is applied by `applyEventHits`.
 * - `killUnit(world, id, cause)`: a kill without a damage source (debug kill, Volunteer!, left
 *   behind): blood, not gibbed. Null if the unit is dead or unknown.
 * - `resolveFrameDeaths(records)`: one frame's deaths, one per id, in ascending EntityId order.
 */
import type {
  DamageElement,
  DamageSourceDef,
  DeathCause,
  DeathVariantId,
  EntityId,
  GibTuning,
  Team,
} from '@core/types';
import type { CombatWorld } from '@core/combat/world';

/** The `unit:died` payload, resolved by core at the moment HP reaches 0. */
export interface DeathRecord {
  readonly id: EntityId;
  readonly team: Team;
  readonly cause: DeathCause;
  readonly deathVariant: DeathVariantId;
  readonly gibbed: boolean;
}

/** The parts of a damage source that decide how a kill looks. */
export type DeathSource = Pick<DamageSourceDef, 'element' | 'damage' | 'canGib' | 'deathVariant'>;

/** GDD §12a rule 2: the killing element's look. */
const VARIANT_BY_ELEMENT = {
  fire: 'charred',
  storm: 'electrified',
  physical: 'blood',
  arcane: 'blood',
} as const satisfies Record<DamageElement, DeathVariantId>;

/** Fallback for kills without a known source (GDD §12a rule 4), and every wizard death. */
const PLAIN: DeathVariantId = 'blood';

export function deathVariantOf(source: DeathSource | null, team: Team): DeathVariantId {
  if (team === 'squad' || source === null) return PLAIN;
  return source.deathVariant ?? VARIANT_BY_ELEMENT[source.element];
}

/** Would this killing hit gib the target, before the per-event cap? */
export function isGibKill(
  source: DeathSource,
  team: Team,
  maxHp: number,
  gibs: GibTuning,
): boolean {
  return team !== 'squad' && source.canGib && source.damage >= gibs.overkillRatio * maxHp;
}

/** Kills a living unit without a damage source. Null if it is dead or unknown. */
export function killUnit(world: CombatWorld, id: EntityId, cause: DeathCause): DeathRecord | null {
  const unit = world.get(id);
  if (!unit || !world.markDead(id)) return null;
  return { id, team: unit.team, cause, deathVariant: PLAIN, gibbed: false };
}

/** One frame's deaths, deduplicated by id (first record wins), in ascending EntityId order. */
export function resolveFrameDeaths(records: readonly DeathRecord[]): DeathRecord[] {
  const byId = new Map<EntityId, DeathRecord>();
  for (const record of records) if (!byId.has(record.id)) byId.set(record.id, record);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}
