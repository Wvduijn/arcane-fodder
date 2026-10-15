import type Phaser from 'phaser';
import type { MovementTuning, Rect, Vec2 } from '@core/types';
import { clampToRect, insetRect, stepPosition } from '@core/math/movement';
import { MOVEMENT } from '@data/movement';
import { Depth } from '../depths';
import type { GameInput } from '../input/GameInput';
import {
  CHARACTER_ANCHOR,
  CHARACTER_EXTENT_ABOVE_FEET_PX,
  PLACEHOLDER_WIZARD_SCALE,
  PlaceholderTextures,
} from '../placeholders';
import type { System } from '../systems/System';
import type { Positioned } from './Positioned';

/**
 * Moves the squad leader from input: no acceleration, one squad speed, kept inside `walkable`.
 * Walkable is the world inset by the sprite's extent above the feet at the top (so the whole
 * sprite stays on the map) and by the body radius on the other sides. M7's blocker perimeter
 * makes the top inset redundant on real maps.
 * `position` is the authoritative state (the feet, centre of the body circle); the sprite only
 * mirrors it.
 */
export class LeaderController implements System, Positioned {
  private readonly sprite: Phaser.GameObjects.Image;
  private current: Vec2;
  /** The rect `position` is clamped to. */
  readonly walkable: Rect;

  constructor(
    scene: Phaser.Scene,
    private readonly input: GameInput,
    world: Rect,
    start: Vec2,
    private readonly tuning: MovementTuning = MOVEMENT,
  ) {
    this.sprite = scene.add
      .image(start.x, start.y, PlaceholderTextures.Wizard)
      .setOrigin(CHARACTER_ANCHOR.x, CHARACTER_ANCHOR.y)
      .setScale(PLACEHOLDER_WIZARD_SCALE)
      .setDepth(Depth.Units);

    const body = tuning.wizardBodyRadiusPx;
    this.walkable = insetRect(world, {
      top: CHARACTER_EXTENT_ABOVE_FEET_PX,
      right: body,
      bottom: body,
      left: body,
    });
    this.current = clampToRect(start, this.walkable, 0);
    this.sprite.setPosition(this.current.x, this.current.y);
  }

  get position(): Readonly<Vec2> {
    return this.current;
  }

  update(dt: number): void {
    const stepped = stepPosition(
      this.current,
      this.input.moveVector,
      this.tuning.squadMoveSpeed,
      dt,
    );
    this.current = clampToRect(stepped, this.walkable, 0);
    this.sprite.setPosition(this.current.x, this.current.y);
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
