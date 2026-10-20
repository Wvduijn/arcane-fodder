import type Phaser from 'phaser';

/** Live and created counts, for the debug overlay and the restart leak check. */
export interface PoolStats {
  /** Objects in use right now. */
  readonly live: number;
  /** Objects this pool ever created; stays flat once the pool is warm. */
  readonly created: number;
}

/** What a pool needs from its game objects: Image and Graphics both qualify. */
type Poolable = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Visible;

/**
 * Reusable game objects (projectiles, puffs, overlays, rings, bursts). `acquire` hands out a
 * released object, or makes a new one with `create`; `release` hides and deactivates it for reuse.
 * Created once per scene run and destroyed on SHUTDOWN with every object it ever made.
 */
export class ObjectPool<T extends Poolable> {
  private readonly free: T[] = [];
  private readonly all = new Set<T>();
  private liveCount = 0;
  private createdCount = 0;

  constructor(private readonly create: () => T) {}

  get stats(): PoolStats {
    return { live: this.liveCount, created: this.createdCount };
  }

  /** An active, visible object. The caller sets position, texture state and depth. */
  acquire(): T {
    let item = this.free.pop();
    if (!item) {
      item = this.create();
      this.all.add(item);
      this.createdCount++;
    }
    this.liveCount++;
    item.setActive(true).setVisible(true);
    return item;
  }

  /** Back to the pool. Releasing an object twice, or one from another pool, is ignored. */
  release(item: T): void {
    if (!this.all.has(item) || !item.active) return;
    item.setActive(false).setVisible(false);
    this.free.push(item);
    this.liveCount--;
  }

  /** Destroys every object this pool made, in use or not. Safe to call twice. */
  destroy(): void {
    for (const item of this.all) item.destroy();
    this.all.clear();
    this.free.length = 0;
    this.liveCount = 0;
  }
}

/** Pooled images (projectiles, puffs, overlays, FX sprites). */
export class ImagePool extends ObjectPool<Phaser.GameObjects.Image> {}

/** Pooled Graphics (engine-drawn rings, reticles, bursts). The caller clears and redraws on acquire. */
export class GraphicsPool extends ObjectPool<Phaser.GameObjects.Graphics> {}
