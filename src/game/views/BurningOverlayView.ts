import type Phaser from 'phaser';
import type { EntityId, StatusId } from '@core/types';
import type { EventBus, GameEventListener } from '../bus/EventBus';
import { Depth } from '../depths';
import type { UnitLookup } from '../entities/Positioned';
import { ImagePool, type PoolStats } from '../fx/ImagePool';
import { PlaceholderTextures } from '../placeholders';
import type { System } from '../systems/System';

/**
 * Placeholder Burning overlay (readability.md §5): a flame rising above the head and shoulders
 * with a 2-frame flicker, no sprite tint. Presentation, not tuning.
 */
const BURNING_OVERLAY = {
  /** The flame's base sits at shoulder height; at 2× the 10 px frame reaches above a goblin's head. */
  baseAboveFeetPx: 16,
  scale: 2,
  flickerMs: 100,
} as const;

/** Statuses this view draws. */
const SHOWN: ReadonlySet<StatusId> = new Set<StatusId>(['burning']);

const FRAMES = [PlaceholderTextures.BurningA, PlaceholderTextures.BurningB] as const;

/**
 * One pooled flame per burning unit: added on `status:applied`, removed on `status:expired` and on
 * `unit:died` (death removes every status, GDD §6), or once the unit is gone. Follows the unit's
 * feet every frame.
 */
export class BurningOverlayView implements System {
  private readonly pool: ImagePool;
  private readonly overlays = new Map<EntityId, Phaser.GameObjects.Image>();
  private flickerMs = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly units: UnitLookup,
    private readonly bus: EventBus,
  ) {
    this.pool = new ImagePool(() =>
      scene.add
        .image(0, 0, FRAMES[0])
        .setOrigin(0.5, 1)
        .setScale(BURNING_OVERLAY.scale)
        .setDepth(Depth.UnitOverlays),
    );
    bus.on('status:applied', this.handleApplied);
    bus.on('status:expired', this.handleExpired);
    bus.on('unit:died', this.handleDied);
  }

  get poolStats(): PoolStats {
    return this.pool.stats;
  }

  /** Units showing the overlay right now (debug, D3 check). */
  get burningIds(): readonly EntityId[] {
    return [...this.overlays.keys()];
  }

  update(dt: number): void {
    this.flickerMs = (this.flickerMs + dt) % (BURNING_OVERLAY.flickerMs * FRAMES.length);
    const frame = Math.floor(this.flickerMs / BURNING_OVERLAY.flickerMs);
    for (const [id, image] of this.overlays) {
      const feet = this.units.positionOf(id);
      if (!feet) {
        // Despawned without a death (debug G respawn).
        this.remove(id);
        continue;
      }
      // Neighbours flicker out of phase, so a burning crowd doesn't pulse in sync.
      const texture = FRAMES[(frame + id) % FRAMES.length] ?? FRAMES[0];
      if (image.texture.key !== texture) image.setTexture(texture);
      image.setPosition(feet.x, feet.y - BURNING_OVERLAY.baseAboveFeetPx);
    }
  }

  destroy(): void {
    this.bus.off('status:applied', this.handleApplied);
    this.bus.off('status:expired', this.handleExpired);
    this.bus.off('unit:died', this.handleDied);
    this.overlays.clear();
    this.pool.destroy();
  }

  private remove(id: EntityId): void {
    const image = this.overlays.get(id);
    if (!image) return;
    this.pool.release(image);
    this.overlays.delete(id);
  }

  private readonly handleApplied: GameEventListener<'status:applied'> = ({ id, status }) => {
    if (!SHOWN.has(status) || this.overlays.has(id)) return;
    const feet = this.units.positionOf(id);
    if (!feet) return;
    const image = this.pool.acquire().setPosition(feet.x, feet.y - BURNING_OVERLAY.baseAboveFeetPx);
    this.overlays.set(id, image);
  };

  private readonly handleExpired: GameEventListener<'status:expired'> = ({ id, status }) => {
    if (SHOWN.has(status)) this.remove(id);
  };

  private readonly handleDied: GameEventListener<'unit:died'> = ({ id }) => {
    this.remove(id);
  };
}
