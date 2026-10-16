import type { StatusDef, StatusId } from '@core/types';
import { stepStatuses } from '@core/combat/status';
import type { CombatWorld } from '@core/combat/world';
import { STATUSES } from '@data/statuses';
import type { EventBus } from '../bus/EventBus';
import type { CombatSystem } from './CombatSystem';
import type { System } from './System';

/**
 * Status ticks and expiry (GDD §6), after CombatSystem in the frame. Core's `stepStatuses` advances
 * every status on every living unit; each tick goes through `CombatSystem.applyHit` in order (a
 * tick kill is charred, a later tick on a unit that just died is a no-op). Then
 * `CombatSystem.flushDeaths` ends the frame's combat phase, so every death of the frame, hits and
 * ticks alike, resolves in one ascending-id batch (GDD §0). Last, `status:expired` for every
 * expiry core reports; core never lists one for a unit that died (a death is not an expiry).
 */
export class StatusSystem implements System {
  private ticksApplied = 0;

  constructor(
    private readonly world: CombatWorld,
    private readonly combat: CombatSystem,
    private readonly bus: EventBus,
    private readonly defs: Readonly<Record<StatusId, StatusDef>> = STATUSES,
  ) {}

  /** Status ticks resolved this run (debug). */
  get ticks(): number {
    return this.ticksApplied;
  }

  update(dt: number): void {
    const { ticks, expired } = stepStatuses(this.world, this.defs, dt);
    for (const tick of ticks) {
      this.combat.applyHit(tick.target, tick.hit);
      this.ticksApplied++;
    }
    this.combat.flushDeaths();
    for (const { id, status } of expired) this.bus.emit('status:expired', { id, status });
  }

  destroy(): void {
    // Owns no objects or listeners; statuses live on the units in the combat world.
  }
}
