import Phaser from 'phaser';
import type { Vec2 } from '@core/types';
import { Palette } from '../palette';
import type { ImagePool } from './ImagePool';

/** A rising column of ash puffs (readability.md §5 Kaboom, §5c Meteor). Presentation. */
export interface SmokeSpec {
  /** One puff per entry: how far it rises, px. */
  readonly rises: readonly number[];
  readonly riseMs: number;
  readonly lifeMs: number;
  readonly swayPx: number;
  readonly startScale: number;
  readonly endScale: number;
  readonly startAlpha: number;
}

/** Bark/slate specks hopping out and landing (readability.md §5 Kaboom, §5c Meteor). */
export interface DebrisSpec {
  readonly chips: number;
  readonly lifeMs: number;
  /** Landing distance per chip, cycled. */
  readonly distancesPx: readonly number[];
  readonly hopPx: number;
}

const DEBRIS_TINTS = [Palette.bark, Palette.slate] as const;

interface Mover {
  readonly image: Phaser.GameObjects.Image;
  readonly pool: ImagePool;
  readonly from: Vec2;
  readonly to: Vec2;
  readonly arcPx: number;
  readonly moveMs: number;
  readonly lifeMs: number;
  /** Smoke grows and fades with its spec; debris fades out quadratically. */
  readonly smoke: SmokeSpec | null;
  ageMs: number;
}

/**
 * Pooled smoke puffs and debris specks on eased arcs, aged on the scene's dt. Owned by an FX view,
 * which owns the two pools (made with the Puff texture tinted `ash` and the Debris texture).
 */
export class Movers {
  private readonly movers: Mover[] = [];

  constructor(
    private readonly smokePool: ImagePool,
    private readonly debrisPool: ImagePool,
  ) {}

  /** Staggered upward so it reads as a column, not a ring. */
  playSmoke(at: Vec2, spec: SmokeSpec): void {
    const middle = (spec.rises.length - 1) / 2;
    spec.rises.forEach((risePx, i) => {
      const from = { x: at.x + (i - middle) * spec.swayPx, y: at.y };
      const image = this.smokePool
        .acquire()
        .setPosition(from.x, from.y)
        .setScale(spec.startScale)
        .setAlpha(spec.startAlpha);
      const to = { x: from.x, y: from.y - risePx };
      this.add(image, this.smokePool, from, to, 0, spec.riseMs, spec.lifeMs, spec);
    });
  }

  playDebris(at: Vec2, spec: DebrisSpec): void {
    for (let i = 0; i < spec.chips; i++) {
      const angle = ((i + 0.5) / spec.chips) * Math.PI * 2;
      const d = spec.distancesPx[i % spec.distancesPx.length] ?? 0;
      const to = { x: at.x + Math.cos(angle) * d, y: at.y + Math.sin(angle) * d };
      const image = this.debrisPool
        .acquire()
        .setPosition(at.x, at.y)
        .setAlpha(1)
        .setRotation(angle)
        .setTint(DEBRIS_TINTS[i % DEBRIS_TINTS.length] ?? Palette.bark);
      this.add(image, this.debrisPool, at, to, spec.hopPx, spec.lifeMs, spec.lifeMs, null);
    }
  }

  /** Smoke rises then lingers and fades; debris hops out and lands. */
  update(dt: number): void {
    for (let i = this.movers.length - 1; i >= 0; i--) {
      const mover = this.movers[i];
      if (!mover) continue;
      mover.ageMs += dt;
      if (mover.ageMs >= mover.lifeMs) {
        mover.pool.release(mover.image);
        this.movers.splice(i, 1);
        continue;
      }
      const t = Math.min(1, mover.ageMs / mover.moveMs);
      const life = mover.ageMs / mover.lifeMs;
      const p = arcPoint(mover.from, mover.to, Phaser.Math.Easing.Quadratic.Out(t), mover.arcPx);
      mover.image.setPosition(p.x, p.y);
      const { smoke } = mover;
      if (smoke) {
        mover.image
          .setScale(smoke.startScale + (smoke.endScale - smoke.startScale) * life)
          .setAlpha(smoke.startAlpha * (1 - life));
      } else {
        mover.image.setAlpha(1 - life * life);
      }
    }
  }

  /** Forgets every mover; the owner destroys the pools. */
  clear(): void {
    this.movers.length = 0;
  }

  private add(
    image: Phaser.GameObjects.Image,
    pool: ImagePool,
    from: Vec2,
    to: Vec2,
    arcPx: number,
    moveMs: number,
    lifeMs: number,
    smoke: SmokeSpec | null,
  ): void {
    this.movers.push({ image, pool, from, to, arcPx, moveMs, lifeMs, smoke, ageMs: 0 });
  }
}

/** Point at progress t on the straight line from → to, lifted by a sine arc peaking at `arcPx`. */
export function arcPoint(from: Vec2, to: Vec2, t: number, arcPx: number): Vec2 {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * arcPx,
  };
}
