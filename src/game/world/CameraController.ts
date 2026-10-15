import Phaser from 'phaser';
import type { CameraTuning, Rect, Vec2 } from '@core/types';
import { dampFactor } from '@core/math/smoothing';
import { clamp, lerp } from '@core/math/vec2';
import { CAMERA } from '@data/camera';
import type { Positioned } from '../entities/Positioned';
import type { GameInput } from '../input/GameInput';
import type { System } from '../systems/System';

/**
 * Follows a target with a deadzone and frame-rate independent smoothing, never showing space
 * outside `world`.
 *
 * Phaser's built-in follow applies a fixed lerp per frame, which feels different at 30 and 144 fps,
 * so this drives the scroll itself. The deadzone is anchored on a goal scroll that is clamped to the
 * world, and the camera eases towards that goal with `dampFactor(followHalfLifeMs, dt)`. Because the
 * goal and the current scroll both stay inside the world, every eased value does too; Phaser's
 * camera bounds are set as well, as a second guard.
 *
 * Look-ahead: the followed point is the target plus a smoothed offset that eases towards
 * `moveVector × lookAheadPx` (half-life `lookAheadHalfLifeMs`) and back to 0 when movement stops.
 * The deadzone and clamp apply to that point.
 */
export class CameraController implements System {
  private goalX: number;
  private goalY: number;
  /** Phaser's CameraManager destroys scene cameras on SHUTDOWN, before the scene's own handler. */
  private cameraDestroyed = false;
  private lookAhead: Vec2 = { x: 0, y: 0 };

  constructor(
    private readonly camera: Phaser.Cameras.Scene2D.Camera,
    private readonly target: Positioned,
    private readonly input: Pick<GameInput, 'moveVector'>,
    private readonly world: Rect,
    private readonly tuning: CameraTuning = CAMERA,
  ) {
    camera.once(Phaser.Cameras.Scene2D.Events.DESTROY, this.handleCameraDestroyed);
    camera.setBounds(world.x, world.y, world.width, world.height);
    camera.setRoundPixels(true);

    // Start centred on the target (look-ahead 0), without easing in from the origin.
    const { x, y } = target.position;
    this.goalX = this.clampScrollX(x - camera.width / 2);
    this.goalY = this.clampScrollY(y - camera.height / 2);
    camera.setScroll(this.goalX, this.goalY);
  }

  /** Deadzone in world coordinates, centred on the goal view. */
  get deadzoneWorld(): Rect {
    const { deadzoneWidthPx: width, deadzoneHeightPx: height } = this.tuning;
    return {
      x: this.goalX + (this.camera.width - width) / 2,
      y: this.goalY + (this.camera.height - height) / 2,
      width,
      height,
    };
  }

  /** The point the camera follows: target plus the smoothed look-ahead offset. */
  get followPoint(): Vec2 {
    const { x, y } = this.target.position;
    return { x: x + this.lookAhead.x, y: y + this.lookAhead.y };
  }

  update(dt: number): void {
    const { moveVector } = this.input;
    const { lookAheadPx, lookAheadHalfLifeMs } = this.tuning;
    const k = dampFactor(lookAheadHalfLifeMs, dt);
    this.lookAhead = {
      x: lerp(this.lookAhead.x, moveVector.x * lookAheadPx, k),
      y: lerp(this.lookAhead.y, moveVector.y * lookAheadPx, k),
    };

    const { x, y } = this.followPoint;
    const zone = this.deadzoneWorld;

    if (x < zone.x) this.goalX -= zone.x - x;
    else if (x > zone.x + zone.width) this.goalX += x - (zone.x + zone.width);
    if (y < zone.y) this.goalY -= zone.y - y;
    else if (y > zone.y + zone.height) this.goalY += y - (zone.y + zone.height);

    this.goalX = this.clampScrollX(this.goalX);
    this.goalY = this.clampScrollY(this.goalY);

    const t = dampFactor(this.tuning.followHalfLifeMs, dt);
    this.camera.setScroll(
      lerp(this.camera.scrollX, this.goalX, t),
      lerp(this.camera.scrollY, this.goalY, t),
    );
  }

  destroy(): void {
    if (this.cameraDestroyed) return;
    this.camera.off(Phaser.Cameras.Scene2D.Events.DESTROY, this.handleCameraDestroyed);
    this.camera.removeBounds();
  }

  private readonly handleCameraDestroyed = (): void => {
    this.cameraDestroyed = true;
  };

  /**
   * Same range as Phaser's bounds clamp. Scroll is the unzoomed view origin, so the visible world
   * starts half the zoom difference further in; a world smaller than the view pins to its start.
   */
  private clampScrollX(scrollX: number): number {
    const { width, displayWidth } = this.camera;
    const min = this.world.x + (displayWidth - width) / 2;
    return clamp(scrollX, min, Math.max(min, min + this.world.width - displayWidth));
  }

  private clampScrollY(scrollY: number): number {
    const { height, displayHeight } = this.camera;
    const min = this.world.y + (displayHeight - height) / 2;
    return clamp(scrollY, min, Math.max(min, min + this.world.height - displayHeight));
  }
}
