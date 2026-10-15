import Phaser from 'phaser';
import { DEV_ARENA } from '@data/devArena';
import { DebugOverlay, isDebugUrl } from '../debug/DebugOverlay';
import { LeaderController } from '../entities/LeaderController';
import type { GameInput } from '../input/GameInput';
import { KeyboardMouseInput } from '../input/KeyboardMouseInput';
import type { System } from '../systems/System';
import { CameraController } from '../world/CameraController';
import { createPlaceholderGround } from '../world/PlaceholderGround';
import { SceneKeys } from './keys';

/** M2 dev arena: one leader walking a grid world. Input → leader → camera is wired directly (no bus yet). */
export class MissionScene extends Phaser.Scene {
  private gameInput: GameInput | null = null;
  /** Updated in order, destroyed in reverse order. */
  private systems: System[] = [];

  constructor() {
    super(SceneKeys.Mission);
  }

  create(): void {
    const world = DEV_ARENA;
    createPlaceholderGround(this, world);

    const gameInput = new KeyboardMouseInput(this);
    const center = { x: world.x + world.width / 2, y: world.y + world.height / 2 };
    const leader = new LeaderController(this, gameInput, world, center);
    const camera = new CameraController(this.cameras.main, leader, gameInput, world);
    const debug = new DebugOverlay(
      this,
      { input: gameInput, leader, camera, world, walkable: leader.walkable },
      { debugUrl: isDebugUrl(), onRestart: () => this.scene.restart() },
    );

    this.gameInput = gameInput;
    this.systems = [leader, camera, debug];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown);
  }

  override update(_time: number, delta: number): void {
    this.gameInput?.update();
    for (const system of this.systems) system.update(delta);
  }

  /** Every destroy() runs even if one throws; the first error is re-thrown afterwards. */
  private readonly handleShutdown = (): void => {
    const teardown: (() => void)[] = [...this.systems].reverse().map((system) => () => {
      system.destroy();
    });
    const { gameInput } = this;
    if (gameInput)
      teardown.push(() => {
        gameInput.destroy();
      });
    this.systems = [];
    this.gameInput = null;

    const errors: unknown[] = [];
    for (const step of teardown) {
      try {
        step();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw errors[0];
  };
}
