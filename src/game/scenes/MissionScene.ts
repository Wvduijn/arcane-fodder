import Phaser from 'phaser';
import { DEV_ARENA } from '@data/devArena';
import { EventBus } from '../bus/EventBus';
import { DebugOverlay, isDebugUrl } from '../debug/DebugOverlay';
import { LeaderMarker } from '../entities/LeaderMarker';
import type { GameInput } from '../input/GameInput';
import { KeyboardMouseInput } from '../input/KeyboardMouseInput';
import { SquadSystem } from '../systems/SquadSystem';
import type { System } from '../systems/System';
import { CameraController } from '../world/CameraController';
import { createPlaceholderGround } from '../world/PlaceholderGround';
import { SceneKeys } from './keys';

/** Passed through `scene.restart(data)`. */
export interface MissionSceneData {
  /** Restart number, 0 for the first try. Each restart gives fresh recruits (GDD Q17). */
  readonly attempt?: number;
}

/**
 * Dev arena: a squad walking a grid world. Systems read each other through narrow interfaces
 * (the camera reads the squad's leader) and react to each other through the scene's {@link EventBus}.
 */
export class MissionScene extends Phaser.Scene {
  private attempt = 0;
  /** Created before every system and destroyed after all of them. */
  private bus: EventBus | null = null;
  private gameInput: GameInput | null = null;
  /** Updated in order, destroyed in reverse order. */
  private systems: System[] = [];

  constructor() {
    super(SceneKeys.Mission);
  }

  init(data: MissionSceneData): void {
    this.attempt = data.attempt ?? 0;
  }

  create(): void {
    const world = DEV_ARENA;
    const bus = new EventBus();
    createPlaceholderGround(this, world);

    const gameInput = new KeyboardMouseInput(this);
    const center = { x: world.x + world.width / 2, y: world.y + world.height / 2 };
    const squad = new SquadSystem(this, gameInput, bus, world, center, { attempt: this.attempt });
    const marker = new LeaderMarker(this, squad, bus);
    const camera = new CameraController(this.cameras.main, squad, gameInput, world, bus);
    const debug = new DebugOverlay(
      this,
      { bus, input: gameInput, squad, marker, camera, world, attempt: this.attempt },
      {
        debugUrl: isDebugUrl(),
        onRestart: () => {
          const data: MissionSceneData = { attempt: this.attempt + 1 };
          this.scene.restart(data);
        },
      },
    );

    this.bus = bus;
    this.gameInput = gameInput;
    this.systems = [squad, marker, camera, debug];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown);
  }

  override update(_time: number, delta: number): void {
    this.gameInput?.update();
    for (const system of this.systems) system.update(delta);
  }

  /**
   * Systems in reverse order, then input, then the bus last (systems still `off()` their listeners
   * in destroy). Every destroy() runs even if one throws; the first error is re-thrown afterwards.
   */
  private readonly handleShutdown = (): void => {
    const teardown: (() => void)[] = [...this.systems].reverse().map((system) => () => {
      system.destroy();
    });
    const { gameInput, bus } = this;
    if (gameInput)
      teardown.push(() => {
        gameInput.destroy();
      });
    if (bus)
      teardown.push(() => {
        bus.destroy();
      });
    this.systems = [];
    this.gameInput = null;
    this.bus = null;

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
