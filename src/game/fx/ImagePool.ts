import type Phaser from 'phaser';

/** Live and created counts, for the debug overlay and the restart leak check. */
export interface PoolStats {
  /** Images in use right now. */
  readonly live: number;
  /** Images this pool ever created; stays flat once the pool is warm. */
  readonly created: number;
}

/**
 * Reusable images (projectiles, puffs, overlays). `acquire` hands out a released image, or makes a
 * new one with `create`; `release` hides and deactivates it for reuse. Created once per scene run
 * and destroyed on SHUTDOWN with every image it ever made.
 */
export class ImagePool {
  private readonly free: Phaser.GameObjects.Image[] = [];
  private readonly all = new Set<Phaser.GameObjects.Image>();
  private liveCount = 0;
  private createdCount = 0;

  constructor(private readonly create: () => Phaser.GameObjects.Image) {}

  get stats(): PoolStats {
    return { live: this.liveCount, created: this.createdCount };
  }

  /** An active, visible image. The caller sets position, texture state and depth. */
  acquire(): Phaser.GameObjects.Image {
    let image = this.free.pop();
    if (!image) {
      image = this.create();
      this.all.add(image);
      this.createdCount++;
    }
    this.liveCount++;
    return image.setActive(true).setVisible(true);
  }

  /** Back to the pool. Releasing an image twice, or one from another pool, is ignored. */
  release(image: Phaser.GameObjects.Image): void {
    if (!this.all.has(image) || !image.active) return;
    image.setActive(false).setVisible(false);
    this.free.push(image);
    this.liveCount--;
  }

  /** Destroys every image this pool made, in use or not. Safe to call twice. */
  destroy(): void {
    for (const image of this.all) image.destroy();
    this.all.clear();
    this.free.length = 0;
    this.liveCount = 0;
  }
}
