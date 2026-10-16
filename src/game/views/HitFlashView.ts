import Phaser from 'phaser';
import type { EntityId } from '@core/types';
import type { EventBus, GameEventListener } from '../bus/EventBus';
import type { UnitLookup } from '../entities/Positioned';
import type { System } from '../systems/System';

/** readability.md §1.8: full white, 60 ms, sprite only, never a team or element tint. */
const HIT_FLASH = {
  durationMs: 60,
  color: 0xffffff,
} as const;

/**
 * White hit flash on every `unit:damaged` with amount > 0 (status ticks included). A new hit
 * restarts the flash. The flash frame is not counted down on the frame it starts, so it shows for
 * the full 60 ms whatever the frame rate. Presentation only: it owns nothing but the timers.
 */
export class HitFlashView implements System {
  /** ms of flash left per unit. */
  private readonly remaining = new Map<EntityId, number>();
  private readonly startedThisFrame = new Set<EntityId>();

  constructor(
    private readonly units: UnitLookup,
    private readonly bus: EventBus,
  ) {
    bus.on('unit:damaged', this.handleDamaged);
  }

  /** Units flashing right now (debug). */
  get flashing(): number {
    return this.remaining.size;
  }

  update(dt: number): void {
    for (const [id, ms] of this.remaining) {
      if (this.startedThisFrame.has(id)) continue;
      const left = ms - dt;
      const sprite = this.units.spriteOf(id);
      if (left > 0 && sprite) {
        this.remaining.set(id, left);
        continue;
      }
      sprite?.clearTint();
      this.remaining.delete(id);
    }
    this.startedThisFrame.clear();
  }

  destroy(): void {
    this.bus.off('unit:damaged', this.handleDamaged);
    for (const id of this.remaining.keys()) this.units.spriteOf(id)?.clearTint();
    this.remaining.clear();
    this.startedThisFrame.clear();
  }

  private readonly handleDamaged: GameEventListener<'unit:damaged'> = ({ id, amount }) => {
    if (amount <= 0) return;
    const sprite = this.units.spriteOf(id);
    if (!sprite) return;
    sprite.setTint(HIT_FLASH.color).setTintMode(Phaser.TintModes.FILL);
    this.remaining.set(id, HIT_FLASH.durationMs);
    this.startedThisFrame.add(id);
  };
}
