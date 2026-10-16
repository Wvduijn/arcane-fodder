/**
 * Damage-over-time statuses (GDD §6: Burning). State lives on the unit in the CombatWorld.
 *
 * API:
 * - `applyStatus(world, target, def, sourceId)`: `'applied'` for a new status (emit
 *   `status:applied`), `'refreshed'` when it was already running: the duration restarts and the tick
 *   phase is kept, so refreshing never buys extra ticks (no stacking). `sourceId` is the applier;
 *   a refresh replaces it. Ticks carry it as their `sourceId` (kill credit, GDD §0), even if that
 *   unit has died since. Null on a dead or unknown
 *   target (D4).
 * - `stepStatuses(world, defs, dtMs)`: advances every status on every living unit, in ascending
 *   EntityId order. Returns the ticks as hits (element from the def, so a Burning kill is charred)
 *   and the statuses that ran out (emit `status:expired` for each). It applies no damage: the caller
 *   passes each tick to `applyHit` in order, which makes a later tick on a unit that just died a
 *   no-op. A unit whose ticks this step add up to its HP dies from them, so none of its statuses
 *   is reported as expired (a death is not an expiry). That holds because the caller applies
 *   exactly these ticks, and nothing else, before the next step (the scene's frame order).
 *
 * Timing: the first tick comes `tickMs` after the first apply (no tick on apply). A tick that falls
 * exactly on the expiry still happens. Any dt works: one long step gives the same ticks as many
 * short ones. A def with tickMs ≤ 0 throws.
 *
 * Frame order (scene: CombatSystem → StatusSystem): call `applyStatus` for this frame's hits
 * *before* this frame's `stepStatuses`. That step's dt elapsed before the hit, so a new status does
 * not advance in it, and a refreshed one keeps its tick phase moving but its full duration. The
 * first tick is then exactly `tickMs` after the hit and a refresh lasts exactly `durationMs`.
 */
import type { EntityId, StatusDef, StatusId } from '@core/types';
import type { CombatWorld } from '@core/combat/world';
import type { Hit } from '@core/combat/damage';

export type StatusApplyResult = 'applied' | 'refreshed' | null;

export interface StatusTick {
  readonly target: EntityId;
  readonly status: StatusId;
  readonly hit: Hit;
}

export interface StatusExpiry {
  readonly id: EntityId;
  readonly status: StatusId;
}

export interface StatusStepResult {
  /** In ascending target id order, each unit's ticks in time order. */
  readonly ticks: readonly StatusTick[];
  /** Ran out this step, in ascending id order. Never lists a unit its own ticks will kill. */
  readonly expired: readonly StatusExpiry[];
}

/** Float slack for timers built from summed frame deltas (not a tuning value). */
const EPSILON_MS = 1e-6;

export function applyStatus(
  world: CombatWorld,
  target: EntityId,
  def: StatusDef,
  sourceId: EntityId | null,
): StatusApplyResult {
  const unit = world.get(target);
  if (!unit?.alive) return null;
  const running = unit.statuses.get(def.id);
  world.setStatus(target, {
    status: def.id,
    remainingMs: def.durationMs,
    nextTickInMs: running ? running.nextTickInMs : def.tickMs,
    sourceId,
    appliedThisFrame: running && running.appliedThisFrame !== 'applied' ? 'refreshed' : 'applied',
  });
  return running ? 'refreshed' : 'applied';
}

export function stepStatuses(
  world: CombatWorld,
  defs: Readonly<Record<StatusId, StatusDef>>,
  dtMs: number,
): StatusStepResult {
  const ticks: StatusTick[] = [];
  const expired: StatusExpiry[] = [];
  if (dtMs <= 0) return { ticks, expired };
  for (const unit of world.units()) {
    if (!unit.alive) continue;
    let tickDamage = 0;
    const unitExpired: StatusExpiry[] = [];
    for (const instance of [...unit.statuses.values()]) {
      const def = defs[instance.status];
      if (!(def.tickMs > 0)) throw new RangeError(`${def.id}.tickMs must be > 0`);
      if (instance.appliedThisFrame === 'applied') {
        world.setStatus(unit.id, { ...instance, appliedThisFrame: null });
        continue;
      }
      let { remainingMs, nextTickInMs } = instance;
      // A refresh landed after this dt elapsed: its duration starts now.
      if (instance.appliedThisFrame === 'refreshed') remainingMs += dtMs;
      let budget = dtMs;
      while (nextTickInMs <= budget + EPSILON_MS && nextTickInMs <= remainingMs + EPSILON_MS) {
        budget -= nextTickInMs;
        remainingMs -= nextTickInMs;
        nextTickInMs = def.tickMs;
        tickDamage += Math.max(0, def.tickDamage);
        ticks.push({
          target: unit.id,
          status: def.id,
          hit: {
            element: def.element,
            damage: def.tickDamage,
            canGib: false,
            sourceId: instance.sourceId,
          },
        });
      }
      remainingMs -= budget;
      nextTickInMs -= budget;
      if (remainingMs <= EPSILON_MS) {
        world.deleteStatus(unit.id, def.id);
        unitExpired.push({ id: unit.id, status: def.id });
      } else {
        world.setStatus(unit.id, {
          ...instance,
          remainingMs,
          nextTickInMs,
          appliedThisFrame: null,
        });
      }
    }
    // applyHit takes min(hp, damage) per tick, so the ticks kill exactly when their sum reaches hp.
    if (tickDamage < unit.hp) expired.push(...unitExpired);
  }
  return { ticks, expired };
}
