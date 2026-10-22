/**
 * The authoritative combat state of every unit (M4): team, HP, alive or dead, body radius and
 * statuses, keyed by EntityId. Wizards and enemies both live here; positions do not (the squad
 * state and the enemy states own those). HP bars, flashes and overlays only read it.
 *
 * API:
 * - `new CombatWorld()`, `world.add(spec)`: registers a unit at full HP. Throws on a duplicate id or
 *   a maxHp that is not a positive number.
 * - `world.get(id)`: a read-only view, or undefined for an unknown id.
 * - `world.isAlive(id)`: false for dead and unknown ids.
 * - `world.units()`: every unit (dead ones until removed), in ascending EntityId order.
 * - `world.remove(id)`: forgets a unit (after its death is handled, or on despawn).
 * - `world.setDeathCause(id, cause)`: how this living unit's death is recorded from now on, whatever
 *   kills it (default `'combat'`). Volunteer! (M6) marks the runner `'volunteer'` at activation,
 *   so an enemy that kills it mid-sprint still records a volunteer's death (GDD §11, §14).
 * - Low-level mutators (`setHp`, `markDead`, `setStatus`, `deleteStatus`) are for damage.ts,
 *   death.ts and status.ts. Game code goes through `applyHit`, `killUnit` and the status functions.
 *
 * Structures (M7): a unit added with `structure` (a Goblin Hut) fights like any enemy unit (HP,
 * Burning, area hits), but its death record carries `structure`, so the death flush emits
 * `hut:destroyed` for it instead of `unit:died` (huts are targets, not kills; GDD §14).
 *
 * Rule (D4): a dead unit never changes again. Every mutator is a no-op on a dead or unknown id.
 */
import type { DeathCause, EntityId, StatusId, StructureId, Team } from '@core/types';

/** One running status on one unit (GDD §6). */
export interface StatusInstance {
  readonly status: StatusId;
  /** ms until it runs out. */
  readonly remainingMs: number;
  /** ms until the next tick. The phase survives a reapply. */
  readonly nextTickInMs: number;
  /** Who applied it last (damage credit for its ticks), or null. */
  readonly sourceId: EntityId | null;
  /**
   * Set by `applyStatus` until the next `stepStatuses`, whose dt elapsed before the hit: a new
   * status skips that step, a refresh keeps its full duration through it (status.ts).
   */
  readonly appliedThisFrame: 'applied' | 'refreshed' | null;
}

export interface CombatUnitSpec {
  readonly id: EntityId;
  readonly team: Team;
  readonly maxHp: number;
  readonly bodyRadiusPx: number;
  /** Set for structures in the world (huts, M7). Absent for units. */
  readonly structure?: StructureId;
  /** Square footprint side: area rings hit it by the footprint's closest point (GDD §0, huts). */
  readonly footprintPx?: number;
}

export interface UnitCombatState extends CombatUnitSpec {
  readonly hp: number;
  readonly alive: boolean;
  /** The cause its death is recorded with (`setDeathCause`). */
  readonly deathCause: DeathCause;
  readonly statuses: ReadonlyMap<StatusId, StatusInstance>;
}

interface MutableUnit extends CombatUnitSpec {
  hp: number;
  alive: boolean;
  deathCause: DeathCause;
  statuses: Map<StatusId, StatusInstance>;
}

export class CombatWorld {
  private readonly byId = new Map<EntityId, MutableUnit>();

  /** Registers a unit at full HP, alive, without statuses. */
  add(spec: CombatUnitSpec): UnitCombatState {
    if (this.byId.has(spec.id)) throw new RangeError(`Unit ${String(spec.id)} already exists`);
    if (!(spec.maxHp > 0) || !Number.isFinite(spec.maxHp)) {
      throw new RangeError(`maxHp must be a positive number, got ${String(spec.maxHp)}`);
    }
    const unit: MutableUnit = {
      ...spec,
      hp: spec.maxHp,
      alive: true,
      deathCause: 'combat',
      statuses: new Map(),
    };
    this.byId.set(spec.id, unit);
    return unit;
  }

  get(id: EntityId): UnitCombatState | undefined {
    return this.byId.get(id);
  }

  isAlive(id: EntityId): boolean {
    return this.byId.get(id)?.alive ?? false;
  }

  /** Every unit, dead ones included until removed, in ascending EntityId order. */
  units(): UnitCombatState[] {
    return [...this.byId.values()].sort((a, b) => a.id - b.id);
  }

  remove(id: EntityId): boolean {
    return this.byId.delete(id);
  }

  /** Sets HP on a living unit, clamped to [0, maxHp]. Does not kill: see `markDead`. */
  setHp(id: EntityId, hp: number): void {
    const unit = this.living(id);
    if (unit) unit.hp = Math.min(unit.maxHp, Math.max(0, hp));
  }

  /** Kills a living unit: HP 0, every status removed (GDD §6). Returns false if it was not alive. */
  markDead(id: EntityId): boolean {
    const unit = this.living(id);
    if (!unit) return false;
    unit.hp = 0;
    unit.alive = false;
    unit.statuses.clear();
    return true;
  }

  setDeathCause(id: EntityId, cause: DeathCause): void {
    const unit = this.living(id);
    if (unit) unit.deathCause = cause;
  }

  setStatus(id: EntityId, instance: StatusInstance): void {
    this.living(id)?.statuses.set(instance.status, instance);
  }

  deleteStatus(id: EntityId, status: StatusId): void {
    this.living(id)?.statuses.delete(status);
  }

  private living(id: EntityId): MutableUnit | undefined {
    const unit = this.byId.get(id);
    return unit?.alive ? unit : undefined;
  }
}
