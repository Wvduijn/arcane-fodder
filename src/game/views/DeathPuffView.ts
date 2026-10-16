import Phaser from 'phaser';
import type { DeathVariantId } from '@core/types';
import type { EventBus, GameEventListener } from '../bus/EventBus';
import { Depth } from '../depths';
import type { UnitLookup } from '../entities/Positioned';
import { ImagePool, type PoolStats } from '../fx/ImagePool';
import { PlaceholderTextures } from '../placeholders';
import type { System } from '../systems/System';

/**
 * Placeholder death puffs (M4 Q4): one coloured collapse puff per enemy death variant, a neutral
 * grey puff for wizards (readability.md §5). Corpses, decals, gibs and the dropped hat come in M8.
 */
const PUFF = {
  durationMs: 300,
  startScale: 1.5,
  endScale: 3.5,
  /** The puff centres on the body, not the feet. */
  liftAboveFeetPx: 12,
  wizard: 0x9a9a9a,
  variants: {
    charred: 0x3a3632,
    electrified: 0xc8f8ff,
    blood: 0x6a1028,
  } satisfies Record<DeathVariantId, number>,
} as const;

interface Puff {
  readonly image: Phaser.GameObjects.Image;
  elapsedMs: number;
}

/** Plays a pooled puff where each unit died. Driven by the scene's dt (Phaser clock). */
export class DeathPuffView implements System {
  private readonly pool: ImagePool;
  private readonly puffs: Puff[] = [];

  constructor(
    scene: Phaser.Scene,
    private readonly units: UnitLookup,
    private readonly bus: EventBus,
  ) {
    this.pool = new ImagePool(() =>
      scene.add.image(0, 0, PlaceholderTextures.Puff).setDepth(Depth.Fx),
    );
    bus.on('unit:died', this.handleDied);
  }

  get poolStats(): PoolStats {
    return this.pool.stats;
  }

  update(dt: number): void {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const puff = this.puffs[i];
      if (!puff) continue;
      puff.elapsedMs += dt;
      const t = Math.min(1, puff.elapsedMs / PUFF.durationMs);
      if (t >= 1) {
        this.pool.release(puff.image);
        this.puffs.splice(i, 1);
        continue;
      }
      const eased = Phaser.Math.Easing.Quadratic.Out(t);
      puff.image
        .setScale(PUFF.startScale + (PUFF.endScale - PUFF.startScale) * eased)
        .setAlpha(1 - t);
    }
  }

  destroy(): void {
    this.bus.off('unit:died', this.handleDied);
    this.puffs.length = 0;
    this.pool.destroy();
  }

  private readonly handleDied: GameEventListener<'unit:died'> = ({ id, team, deathVariant }) => {
    const feet = this.units.positionOf(id);
    if (!feet) return;
    const color = team === 'squad' ? PUFF.wizard : PUFF.variants[deathVariant];
    const image = this.pool
      .acquire()
      .setPosition(feet.x, feet.y - PUFF.liftAboveFeetPx)
      .setTint(color)
      .setScale(PUFF.startScale)
      .setAlpha(1);
    this.puffs.push({ image, elapsedMs: 0 });
  };
}
