import type { EntityId, MissionDef, PortalTuning, SurgeTuning, Vec2 } from '@core/types';
import type { MissionMap } from '@core/mission/mapData';
import {
  checkExtraction,
  createPortal,
  lightRune,
  openPortal,
  stepPortal,
  type PortalChange,
  type PortalPhase,
  type PortalState,
} from '@core/mission/portal';
import { scatterPositions } from '@core/mission/spawns';
import {
  createSurge,
  recordSurgeSpawn,
  startSurge,
  stepSurge,
  surgeFinished,
  type SurgeState,
} from '@core/mission/surge';
import { createRng, type Rng } from '@core/rng/rng';
import type { CollisionGrid } from '@core/world/collisionGrid';
import { ENEMIES } from '@data/enemies';
import { PORTAL, SURGE } from '@data/mission';
import type { EventBus, GameEventListener } from '../bus/EventBus';
import type { MissionHudSource } from '../hud/MissionHudModel';
import type { EnemySpawnTarget } from './SpawnerSystem';
import type { System } from './System';

/** The squad as extraction and the surge see it. */
export interface PortalSquad {
  /** Living members, leader first. */
  readonly members: readonly { readonly id: EntityId; readonly position: Vec2 }[];
  /** Active volunteer runners: never saved (GDD §11). */
  readonly runnerIds: readonly EntityId[];
  /** Every living wizard's feet, runners included (surge 160 px rule). */
  readonly wizardPositions: readonly Vec2[];
}

/** Objective totals for the HUD source. */
export interface ObjectiveTotals {
  readonly targetsDestroyed: number;
  readonly targetsRequired: number;
}

export interface PortalOptions {
  readonly grid: CollisionGrid;
  /** Seeds where surge goblins land within their point's radius. */
  readonly scatterSeed: number;
  /** CombatWorld liveness: dead surge goblins free their slot; dead runners aren't left behind. */
  readonly isAlive: (id: EntityId) => boolean;
  readonly portal?: PortalTuning;
  readonly surge?: SurgeTuning;
}

export interface PortalDebug {
  readonly phase: PortalPhase;
  readonly runesLit: number;
  readonly runeCount: number;
  readonly openingLeftMs: number;
  readonly surge: {
    readonly started: boolean;
    readonly alive: number;
    readonly queued: number;
    readonly spawned: number;
    readonly finished: boolean;
  };
}

/**
 * The portal (GDD §13) on core's portal and surge state: sealed with dark runes, one rune per
 * `mission:target-destroyed`, the opening on the last one (`portal:opened`, the final surge
 * starts; ConvergenceSystem charges the meter), enterable after `openingMs`, and the extraction
 * check after the frame's deaths ({@link lateStep}): the leader within `triggerRadiusPx` splits
 * saved and left behind (`portal:extracted`). Surge goblins spawn with the wave's aggro.
 * PortalView draws it; this system holds no display objects.
 */
export class PortalSystem implements System, MissionHudSource {
  private state: PortalState;
  private surge: SurgeState;
  private readonly rng: Rng;
  private readonly portalTuning: PortalTuning;
  private readonly surgeTuning: SurgeTuning;
  private surgeSpawned = 0;
  /** Bumps per lit rune, so the view can flare the newest. */
  private runeFlares = 0;

  constructor(
    private readonly mission: MissionDef,
    map: MissionMap,
    private readonly objectives: ObjectiveTotals,
    private readonly squad: PortalSquad,
    private readonly enemies: EnemySpawnTarget,
    private readonly bus: EventBus,
    private readonly options: PortalOptions,
  ) {
    this.portalTuning = options.portal ?? PORTAL;
    this.surgeTuning = options.surge ?? SURGE;
    this.rng = createRng(options.scatterSeed);
    this.state = createPortal(map.portal.position, objectives.targetsRequired);
    const { waveId, aggro } = mission.extraction.finalSurge;
    this.surge = createSurge(map.surgeSpawns, waveId, aggro);
    bus.on('mission:target-destroyed', this.handleTargetDestroyed);
  }

  get position(): Vec2 {
    return this.state.position;
  }

  get phase(): PortalPhase {
    return this.state.phase;
  }

  get runesLit(): number {
    return this.state.runesLit;
  }

  get runeCount(): number {
    return this.state.runeCount;
  }

  get runeFlareCount(): number {
    return this.runeFlares;
  }

  /** 0 → 1 over the opening; 1 once open. */
  get openingProgress(): number {
    if (this.state.phase === 'sealed') return 0;
    if (this.state.phase !== 'opening') return 1;
    return 1 - this.state.openingLeftMs / this.portalTuning.openingMs;
  }

  /** MissionDef.extraction.radiusPx: the ring the view draws. */
  get extractionRadiusPx(): number {
    return this.mission.extraction.radiusPx;
  }

  // MissionHudSource
  get targetsDestroyed(): number {
    return this.objectives.targetsDestroyed;
  }

  get targetsRequired(): number {
    return this.objectives.targetsRequired;
  }

  get portalPosition(): Vec2 {
    return this.state.position;
  }

  get portalOpen(): boolean {
    return this.state.phase !== 'sealed';
  }

  get debugState(): PortalDebug {
    return {
      phase: this.state.phase,
      runesLit: this.state.runesLit,
      runeCount: this.state.runeCount,
      openingLeftMs: this.state.openingLeftMs,
      surge: {
        started: this.surge.started,
        alive: this.surge.alive.length,
        queued: this.surge.queue.length,
        spawned: this.surgeSpawned,
        finished: surgeFinished(this.surge),
      },
    };
  }

  /** Debug O: the opening starts now, as if the last rune lit. */
  forceOpen(): void {
    this.apply(openPortal(this.state, this.portalTuning));
  }

  update(dt: number): void {
    this.state = stepPortal(this.state, dt).state;
    const step = stepSurge(this.surge, {
      dtMs: dt,
      wizards: this.squad.wizardPositions,
      isAlive: this.options.isAlive,
      tuning: this.surgeTuning,
    });
    this.surge = step.state;
    for (const order of step.orders) {
      const placement = {
        grid: this.options.grid,
        bodyRadiusPx: ENEMIES[order.enemy].bodyRadiusPx,
      };
      const [at] = scatterPositions(order.position, 1, order.radiusPx, this.rng, placement);
      const id = this.enemies.spawn(order.enemy, at ?? order.position, { aggro: order.aggro });
      this.surge = recordSurgeSpawn(this.surge, id);
      this.surgeSpawned++;
    }
  }

  /** After the frame's deaths (GDD §2): a leader who died on the trigger frame doesn't count. */
  lateStep(): void {
    const check = checkExtraction(this.state, {
      members: this.squad.members,
      runners: this.squad.runnerIds,
      isAlive: this.options.isAlive,
      tuning: this.portalTuning,
      radiusPx: this.mission.extraction.radiusPx,
    });
    this.state = check.state;
    if (check.extraction) {
      this.bus.emit('portal:extracted', {
        saved: check.extraction.saved,
        leftBehind: check.extraction.leftBehind,
      });
    }
  }

  destroy(): void {
    this.bus.off('mission:target-destroyed', this.handleTargetDestroyed);
  }

  private apply(change: PortalChange): void {
    const lit = change.state.runesLit - this.state.runesLit;
    this.state = change.state;
    this.runeFlares += Math.max(0, lit);
    if (!change.opened) return;
    this.surge = startSurge(this.surge);
    this.bus.emit('portal:opened', { at: { ...this.state.position } });
  }

  private readonly handleTargetDestroyed: GameEventListener<'mission:target-destroyed'> = () => {
    this.apply(lightRune(this.state, this.portalTuning));
  };
}
