/**
 * The Convergence meter (GDD §9). Fed from what the squad deals to enemies, spent on a channel.
 * One meter per run: create a new one on mission start (it resets there, never on wizard deaths).
 * Never keep one across restarts: it remembers the last hit on every enemy hit this run.
 *
 * API:
 * - `new ConvergenceMeter(tuning, convergenceSourceId)`: starts at `meterStart`, clamped to
 *   `meterMax`. `convergenceSourceId` is the run's Convergence id (the `source` of its strikes and of
 *   the Burning they apply).
 * - `meter.onDamaged(event)`: a `unit:damaged` payload. Charges `amount × chargePerDamage` (amount is
 *   already overkill-free) for team `enemy` (units and huts) unless `source` is the Convergence id.
 *   Remembers the source as that unit's last hit, for its kill.
 * - `meter.onDied(event)`: a `unit:died` payload. Charges `chargePerKill` for team `enemy` unless the
 *   unit's last hit came from the Convergence. A kill with no hit before it (a debug kill) charges.
 * - `meter.onHutDestroyed()`, `meter.onPortalOpened()`: `chargePerHutDestroyed`, `chargeOnPortalOpen`
 *   (wired in M7). M7 decides whether a hut's death also goes through `onDied`.
 * - `meter.fill()`: straight to max (debug `C`).
 * - `meter.spend()`: true and the meter drops to 0 when it was full; false (no change) otherwise.
 * - Every charging call returns true on the call that brings the meter to max: emit
 *   `convergence:charged` then. Once per fill: charge on a full meter returns false.
 * - `meter.value`, `meter.max`, `meter.full`, `meter.fraction` (0..1, for the HUD bar).
 *
 * No snowballing (GDD §9, M6 Q3): Convergence strikes and the Burning they apply carry
 * `convergenceSourceId` and never charge. Reactions they cause (Combust from a Firestorm bolt) are
 * credited to a separate id (`AreaEvent.reactionSourceId`, area.ts) and do charge, as do Kaboom
 * (the keg's id) and Volunteer! (the volunteer's id).
 */
import type { ConvergenceTuning, EntityId, Team } from '@core/types';

export interface MeterDamage {
  readonly id: EntityId;
  readonly team: Team;
  readonly amount: number;
  readonly source: EntityId | null;
}

export interface MeterDeath {
  readonly id: EntityId;
  readonly team: Team;
}

export class ConvergenceMeter {
  private current: number;
  /** Who hit each enemy last, so its death can be credited (`unit:died` has no source). */
  private readonly lastSource = new Map<EntityId, EntityId | null>();

  constructor(
    private readonly tuning: ConvergenceTuning,
    private readonly convergenceSourceId: EntityId,
  ) {
    if (!(tuning.meterMax > 0)) {
      throw new RangeError(`meterMax must be positive, got ${String(tuning.meterMax)}`);
    }
    this.current = clamp(tuning.meterStart, tuning.meterMax);
  }

  get value(): number {
    return this.current;
  }

  get max(): number {
    return this.tuning.meterMax;
  }

  get full(): boolean {
    return this.current >= this.tuning.meterMax;
  }

  get fraction(): number {
    return this.current / this.tuning.meterMax;
  }

  onDamaged(event: MeterDamage): boolean {
    if (event.team !== 'enemy') return false;
    this.lastSource.set(event.id, event.source);
    if (event.source === this.convergenceSourceId) return false;
    return this.charge(event.amount * this.tuning.chargePerDamage);
  }

  onDied(event: MeterDeath): boolean {
    const source = this.lastSource.get(event.id) ?? null;
    this.lastSource.delete(event.id);
    if (event.team !== 'enemy' || source === this.convergenceSourceId) return false;
    return this.charge(this.tuning.chargePerKill);
  }

  onHutDestroyed(): boolean {
    return this.charge(this.tuning.chargePerHutDestroyed);
  }

  onPortalOpened(): boolean {
    return this.charge(this.tuning.chargeOnPortalOpen);
  }

  fill(): boolean {
    return this.charge(this.tuning.meterMax);
  }

  spend(): boolean {
    if (!this.full) return false;
    this.current = 0;
    return true;
  }

  /** Adds charge, clamped. True when this call filled the meter. */
  private charge(amount: number): boolean {
    if (!(amount > 0) || this.full) return false;
    this.current = clamp(this.current + amount, this.tuning.meterMax);
    return this.full;
  }
}

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}
