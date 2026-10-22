import type Phaser from 'phaser';
import type { EventBus } from '../bus/EventBus';
import type { PoolStats } from '../fx/ImagePool';
import { SceneKeys } from '../scenes/keys';
import type { System } from '../systems/System';

/** What one run contributes to the leak counts; MissionScene fills it at create. */
export interface LeakSources {
  readonly attempt: number;
  readonly bus: EventBus;
  readonly systems: readonly System[];
  /** Every pool of the run by name (flattened from each FX system's poolStats). */
  readonly pools: () => Readonly<Record<string, PoolStats>>;
  readonly entities: () => Readonly<Record<string, number>>;
}

/** Frames after create before the counts are taken: the HUD scene starts on the next step. */
const SETTLE_FRAMES = 2;

/**
 * Restart leak check (plan §8 DoD, M7 D6). On a debug URL each run logs, once it has settled, one
 * `[leak]` console line with the counts a leak would grow: bus listeners, keyboard keys, game-level
 * listeners, display objects per scene, tweens, textures, pool sizes, systems, entities,
 * and the HUD / Pause / Results scene state. The reviewer compares the lines across 10 restarts:
 * apart from `attempt`, they must be identical. The last snapshot is also on `window`.
 */
export class RestartLeakLog implements System {
  private frames = 0;
  private logged = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sources: LeakSources,
  ) {}

  update(): void {
    if (this.logged || ++this.frames < SETTLE_FRAMES) return;
    this.logged = true;
    const counts = this.counts();
    window.__ARCANE_LEAK__ = counts;
    console.info(`[leak] ${JSON.stringify(counts)}`);
  }

  destroy(): void {
    this.logged = true;
  }

  private counts(): Readonly<Record<string, unknown>> {
    const { scene, sources } = this;
    const { game } = scene;
    // By event name, so a difference between runs says which listener it is.
    const gameListeners = Object.fromEntries(
      game.events.eventNames().map((name) => [String(name), game.events.listenerCount(name)]),
    );
    const sceneState = (key: string): Readonly<Record<string, unknown>> => {
      const other = scene.scene.get(key);
      return {
        active: scene.scene.isActive(key),
        sleeping: scene.scene.isSleeping(key),
        children: other.children.length,
        keys: other.input.keyboard?.keys.filter(Boolean).length ?? 0,
      };
    };
    const pools = Object.fromEntries(
      Object.entries(sources.pools()).map(([name, stats]) => [
        name,
        `${String(stats.live)}/${String(stats.created)}`,
      ]),
    );
    return {
      attempt: sources.attempt,
      busListeners: sources.bus.listenerCount(),
      keys: scene.input.keyboard?.keys.filter(Boolean).length ?? 0,
      gameListeners,
      inputListeners: scene.input.eventNames().length,
      displayObjects: scene.children.length,
      tweens: scene.tweens.getTweens().length,
      textures: game.textures.getTextureKeys().length,
      systems: sources.systems.length,
      pools,
      entities: sources.entities(),
      hud: sceneState(SceneKeys.Hud),
      pause: sceneState(SceneKeys.Pause),
      results: sceneState(SceneKeys.Results),
    };
  }
}

declare global {
  interface Window {
    /** Last restart leak snapshot; present only on a debug URL. */
    __ARCANE_LEAK__?: Readonly<Record<string, unknown>>;
  }
}
