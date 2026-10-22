import Phaser from 'phaser';
import type { EntityId, MissionDef, MissionResult, Vec2 } from '@core/types';
import { createIdAllocator } from '@core/ids';
import { CombatWorld } from '@core/combat/world';
import { attemptSeed } from '@core/names/recruitNames';
import { COMBAT } from '@data/combat';
import { PORTAL } from '@data/mission';
import { NAVIGATION } from '@data/navigation';
import { HUT } from '@data/structures';
import { EventBus } from '../bus/EventBus';
import { DebugOverlay, isDebugUrl } from '../debug/DebugOverlay';
import { MissionDebugKeys } from '../debug/MissionDebugKeys';
import { RestartLeakLog } from '../debug/RestartLeakLog';
import { LeaderMarker } from '../entities/LeaderMarker';
import { combineLookups } from '../entities/Positioned';
import { FlashBudget } from '../fx/FlashBudget';
import { ScreenShake } from '../fx/ScreenShake';
import { HudModel } from '../hud/HudModel';
import { MissionHudModel } from '../hud/MissionHudModel';
import type { GameInput } from '../input/GameInput';
import { KeyboardMouseInput } from '../input/KeyboardMouseInput';
import { SavedHatHill } from '../save/SavedHatHill';
import type { GameServices } from '../services';
import { CollisionSystem } from '../systems/CollisionSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { ConvergenceSystem } from '../systems/ConvergenceSystem';
import { EnemyAiSystem } from '../systems/EnemyAiSystem';
import { KegSystem } from '../systems/KegSystem';
import { MissionSystem } from '../systems/MissionSystem';
import { NavigationSystem } from '../systems/NavigationSystem';
import { PortalSystem } from '../systems/PortalSystem';
import { SpawnerSystem } from '../systems/SpawnerSystem';
import { SpellSystem } from '../systems/SpellSystem';
import { SquadSystem, type SquadHold } from '../systems/SquadSystem';
import { StatusSystem } from '../systems/StatusSystem';
import type { System } from '../systems/System';
import { TargetingSystem } from '../systems/TargetingSystem';
import { VolunteerSystem } from '../systems/VolunteerSystem';
import { BurningOverlayView } from '../views/BurningOverlayView';
import { ConvergenceFxView } from '../views/ConvergenceFxView';
import { DeathPuffView } from '../views/DeathPuffView';
import { HealthBarView } from '../views/HealthBarView';
import { HitFlashView } from '../views/HitFlashView';
import { PortalView } from '../views/PortalView';
import { ReactionFxView } from '../views/ReactionFxView';
import { SpellFxView } from '../views/SpellFxView';
import { VolunteerFxView } from '../views/VolunteerFxView';
import { CameraController } from '../world/CameraController';
import { IntroPan } from '../world/IntroPan';
import { loadMissionTilemap, type LoadedTilemap } from '../world/TilemapLoader';
import type { HudSceneData } from './HudScene';
import type { PauseSceneData } from './PauseScene';
import type { ResultsSceneData } from './ResultsScene';
import { SceneKeys } from './keys';

/** Mixed into the run's name seed, so the barrage picks and barks don't mirror the name draws. */
const CONVERGENCE_RNG_SALT = 0xc0_47e6;
const BARK_RNG_SALT = 0xba_4b5;
const SCATTER_RNG_SALT = 0x5c_a77e;
const SURGE_RNG_SALT = 0x5e_96e;

const NO_MOVE: Vec2 = { x: 0, y: 0 };
/** Debug I: followers line up south of the leader, as at spawn. */
const WARP_BEHIND: Vec2 = { x: 0, y: 1 };

/** Passed through `scene.restart(data)`. */
export interface MissionSceneData {
  /** Restart number, 0 for the first try. Each restart gives fresh recruits (GDD Q17). */
  readonly attempt?: number;
}

/**
 * Runs one MissionDef (plan §4.4) on its Tiled map: the squad at `squad-start` with the mission's
 * roster and name seed (+ attempt), kegs, huts, spawn groups, archer posts, triggers, the portal
 * and the surge all from map objects. Systems read each other through narrow interfaces and react
 * to each other through the scene's {@link EventBus}.
 *
 * Phases (MissionSystem): intro (the camera pan, first attempt only) → playing → ended. Gameplay
 * systems step only while playing; presentation (HUD model, views, camera, debug) every frame.
 * Frame order: input → mission (timer, intro) → squad → navigation → enemies → spawner →
 * targeting → Convergence → Volunteer! → spells → kegs → combat → statuses (deaths) → portal
 * (surge) → extraction and defeat checks → HUD → views → camera → debug. Pause (CD Q6) pauses the
 * whole scene. The HUD, Pause and Results are their own scenes above it.
 *
 * Platform services (the save repository) come in through the constructor (registry.ts); Phaser
 * reuses this instance on restart, so they outlive every run.
 */
export class MissionScene extends Phaser.Scene {
  private attempt = 0;
  /** Created before every system and destroyed after all of them. */
  private bus: EventBus | null = null;
  private gameInput: GameInput | null = null;
  /** Every system of the run, destroyed in reverse order. */
  private systems: System[] = [];
  /** Steps only while the mission is `playing` (frozen during the intro pan and after the end). */
  private gameplay: System[] = [];
  /** Steps every frame: HUD model, views, debug. The camera is skipped while the intro pan runs. */
  private presentation: System[] = [];
  private run: MissionSystem | null = null;
  private intro: IntroPan | null = null;
  private camera: CameraController | null = null;
  private skipIntro: (() => boolean) | null = null;
  /** Created first, destroyed after every system. */
  private tilemap: LoadedTilemap | null = null;

  constructor(
    private readonly services: GameServices,
    private readonly mission: MissionDef,
  ) {
    super(SceneKeys.Mission);
  }

  init(data: MissionSceneData): void {
    this.attempt = data.attempt ?? 0;
  }

  create(): void {
    const { mission } = this;
    const tilemap = loadMissionTilemap(this, mission);
    this.tilemap = tilemap;
    const { map } = tilemap;
    const world = tilemap.bounds;
    const bus = new EventBus();
    // Blockers plus structure solids, handed to every step that moves or shoots (M7).
    const collision = new CollisionSystem(tilemap.map);
    const grid = collision.grid;

    const gameInput = new KeyboardMouseInput(this);
    // One allocator per scene run, so ids restart at 1 and stay ascending (GDD §0).
    const ids = createIdAllocator();
    // The Convergence holds the squad and blocks autos while it channels (GDD §10). It is built
    // after the squad, so the squad and targeting read it through this lazy view.
    const hold: SquadHold = {
      get held() {
        return convergence.held;
      },
    };
    const squad = new SquadSystem(this, gameInput, bus, world, map.squadStart.position, {
      classes: mission.squad,
      nameSeed: mission.nameSeed,
      attempt: this.attempt,
      ids,
      hold,
      collision: grid,
    });
    // HP, statuses and alive/dead of every unit; CombatSystem resolves every change to it.
    const combatWorld = new CombatWorld();
    // Flow field toward the wizards (CD Q2), rebuilt before the enemy step reads it.
    const navigation = new NavigationSystem(
      grid,
      {
        get goalPositions() {
          return squad.units.map((unit) => unit.position);
        },
      },
      bus,
      NAVIGATION.flowFieldRebuildMs,
    );
    const enemies = new EnemyAiSystem(this, combatWorld, squad, world, {
      ids,
      collision: grid,
      navigation: navigation.field,
      refreshNavigation: () => navigation.tickedThisStep,
    });
    // Before the spawner: every keg solid is on the grid before any goblin is scattered.
    // Kegs hand each ended fuse to combat for the Kaboom; combat lights kegs back through them.
    const kegs = new KegSystem(
      this,
      bus,
      (keg) => {
        combat.resolveKaboom(keg);
      },
      { ids, positions: map.kegs.map((keg) => keg.position), solids: collision },
    );
    // Huts, enemy-spawn groups, archer posts and triggers, all from the map (conventions §4).
    const spawner = new SpawnerSystem(this, map, combatWorld, enemies, squad, {
      ids,
      grid,
      solids: collision,
      scatterSeed: attemptSeed(mission.nameSeed, this.attempt) ^ SCATTER_RNG_SALT,
    });
    const targeting = new TargetingSystem(squad, enemies, combatWorld, hold, COMBAT, grid, spawner);
    const combat = new CombatSystem(this, combatWorld, squad, enemies, targeting, ids, bus, kegs, {
      collision: grid,
      structures: spawner,
    });
    const runSeed = attemptSeed(mission.nameSeed, this.attempt);
    const convergence = new ConvergenceSystem(gameInput, squad, enemies, combat, bus, {
      // Credit ids, never units: strikes (no meter charge) and the reactions they cause (Q3).
      ids: { sourceId: ids.next(), reactionSourceId: ids.next() },
      rngSeed: runSeed ^ CONVERGENCE_RNG_SALT,
      structures: spawner,
    });
    const hatHill = new SavedHatHill(this.services.saves);
    const volunteer = new VolunteerSystem(
      gameInput,
      squad,
      enemies,
      combat,
      convergence,
      hatHill,
      bus,
      {
        barkSeed: runSeed ^ BARK_RNG_SALT,
        missionId: mission.id,
        collision: grid,
        structures: spawner,
      },
    );
    const spells = new SpellSystem(gameInput, squad, enemies, combat, kegs, convergence, ids, bus, {
      collision: grid,
      structures: spawner,
    });
    // Runners that fell mid-sprint detonate just before the frame's death flush.
    const status = new StatusSystem(combatWorld, combat, bus, [volunteer]);
    const runnerIds = (): EntityId[] => squad.volunteerState.runners.map((runner) => runner.id);
    const run = new MissionSystem(
      mission,
      {
        get memberCount() {
          return squad.state.members.length;
        },
        get runnerIds() {
          return runnerIds();
        },
        nameOf: (id) => squad.nameOf(id),
        classOf: (id) => squad.classOf(id),
      },
      hatHill,
      this.services.saves,
      bus,
      this.showResults,
    );
    const portal = new PortalSystem(
      mission,
      map,
      run,
      {
        get members() {
          return squad.state.members.map(({ id, position }) => ({ id, position }));
        },
        get runnerIds() {
          return runnerIds();
        },
        get wizardPositions() {
          return squad.units.map((unit) => unit.position);
        },
      },
      enemies,
      bus,
      {
        grid,
        scatterSeed: runSeed ^ SURGE_RNG_SALT,
        isAlive: (id) => combatWorld.isAlive(id),
      },
    );
    const hud = new HudModel(spells, convergence, volunteer, bus);
    const missionHud = new MissionHudModel(portal, this.cameras.main, bus);
    const flashBudget = new FlashBudget();
    // One shake for every FX view: the §5c rule (bigger or equal replaces, never stacks).
    const screenShake = new ScreenShake(this.cameras.main);
    const units = combineLookups(squad, enemies, spawner);
    const hitFlash = new HitFlashView(units, bus);
    const healthBars = new HealthBarView(this, combatWorld, units);
    const burning = new BurningOverlayView(this, units, combat, bus);
    const puffs = new DeathPuffView(this, units, bus);
    const spellFx = new SpellFxView(this, this.cameras.main, spells, bus, flashBudget);
    const reactionFx = new ReactionFxView(this, screenShake, units, bus, flashBudget);
    const convergenceFx = new ConvergenceFxView(
      this,
      this.cameras.main,
      screenShake,
      convergence,
      bus,
      flashBudget,
    );
    const volunteerFx = new VolunteerFxView(
      this,
      this.cameras.main,
      screenShake,
      volunteer,
      squad,
      bus,
      flashBudget,
    );
    const portalView = new PortalView(this, portal, map.runeSlots, units, flashBudget, bus);
    const marker = new LeaderMarker(this, squad, bus);
    // No look-ahead while the channel holds the squad: it isn't going anywhere.
    const cameraInput = {
      get moveVector() {
        return convergence.held ? NO_MOVE : gameInput.moveVector;
      },
    };
    const camera = new CameraController(this.cameras.main, squad, cameraInput, world, bus);
    const debug = new DebugOverlay(
      this,
      {
        bus,
        input: gameInput,
        squad,
        marker,
        camera,
        world,
        attempt: this.attempt,
        nameSeed: mission.nameSeed,
        combatWorld,
        enemies,
        targeting,
        combat,
        status,
        hitFlash,
        burning,
        puffs,
        spells,
        kegs,
        spellFx,
        reactionFx,
        flashBudget,
        convergence,
        volunteer,
        convergenceFx,
        volunteerFx,
        hatHill,
        screenShake,
        mission: { run, portal, spawner, collision, navigation },
      },
      {
        debugUrl: isDebugUrl(),
        onRestart: this.restartMission,
        onRespawnEncounter: () => {
          enemies.despawnAll();
          kegs.respawn();
        },
      },
    );

    const debugUrl = isDebugUrl();
    const debugKeys = debugUrl
      ? new MissionDebugKeys(this, {
          destroyNextHut: () => {
            const next = spawner.standingHuts[0];
            if (next) combat.kill(next.id, 'combat');
          },
          openPortal: () => {
            portal.forceOpen();
          },
          warpToPortal: () => {
            const { x, y } = portal.position;
            squad.teleport({ x, y: y + mission.extraction.radiusPx / 2 }, WARP_BEHIND);
          },
          warpToHut: () => {
            const next = spawner.standingHuts[0];
            if (!next) return;
            // Two footprints south of the hut: inside its activation radius, clear of its door.
            const { x, y } = next.position;
            squad.teleport({ x, y: y + HUT.footprintPx * 2 }, WARP_BEHIND);
          },
        })
      : null;

    // Frame order (M7.md): input → mission (timer, intro) → squad → enemies → spawner → targeting →
    // Convergence → Volunteer! → spells → kegs → combat → statuses (deaths) → portal (surge, then
    // the extraction check after deaths) → mission end checks → HUD → views → camera → debug.
    this.gameplay = [
      collision,
      squad,
      navigation,
      enemies,
      spawner,
      targeting,
      convergence,
      volunteer,
      spells,
      kegs,
      combat,
      status,
      portal,
      {
        update: () => {
          portal.lateStep();
          run.lateStep();
        },
        destroy: () => undefined,
      },
    ];
    this.presentation = [
      hud,
      missionHud,
      flashBudget,
      hitFlash,
      healthBars,
      burning,
      puffs,
      spellFx,
      reactionFx,
      convergenceFx,
      volunteerFx,
      portalView,
      marker,
      camera,
      debug,
    ];
    const extras: System[] = debugKeys ? [debugKeys] : [];
    this.systems = [run, ...this.gameplay, ...this.presentation, ...extras];
    if (debugUrl) {
      const leakLog = new RestartLeakLog(this, {
        attempt: this.attempt,
        bus,
        systems: this.systems,
        pools: () => ({
          projectiles: combat.poolStats,
          puffs: puffs.poolStats,
          ...prefixed('keg', kegs.poolStats),
          ...prefixed('spell', spellFx.poolStats),
          ...prefixed('reaction', reactionFx.poolStats),
          ...prefixed('convergence', convergenceFx.poolStats),
        }),
        entities: () => ({
          units: combatWorld.units().length,
          enemies: enemies.count,
          squad: squad.state.members.length,
          huts: spawner.debugState.huts.length,
          solids: collision.solidCount,
        }),
      });
      this.presentation.push(leakLog);
      this.systems.push(leakLog);
    }

    this.bus = bus;
    this.gameInput = gameInput;
    this.run = run;
    this.camera = camera;
    // The intro pan plays once per session's first attempt (M7.md "my calls"); restarts skip it.
    if (this.attempt === 0) {
      this.intro = new IntroPan(
        this.cameras.main,
        map.squadStart.position,
        map.portal.position,
        PORTAL.introPanMs,
      );
      this.skipIntro = () =>
        gameInput.moveVector.x !== 0 ||
        gameInput.moveVector.y !== 0 ||
        gameInput.consume('spell1') ||
        gameInput.consume('spell2');
    } else {
      run.beginPlay();
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown);
    // A fresh HUD per run, reading this run's model (M5 Q3); stopped in handleShutdown.
    const hudData: HudSceneData = { view: hud, mission: missionHud };
    // The Results of an earlier run, if Again came from there, is already stopped.
    this.scene.launch(SceneKeys.Hud, hudData);
  }

  /** Gameplay dt is clamped (tab switches, hitches), so nothing tunnels or jumps after a stall. */
  override update(_time: number, delta: number): void {
    const dt = Math.min(delta, COMBAT.maxFrameDtMs);
    const { gameInput } = this;
    gameInput?.update();
    if (gameInput?.consume('pause')) {
      this.pauseMission();
      return;
    }
    const { run, intro } = this;
    run?.update(dt);
    if (intro && !intro.done) {
      if (this.skipIntro?.()) {
        intro.skip();
        run?.beginPlay();
      } else if (intro.update(dt)) {
        run?.beginPlay();
      }
    }
    if (run?.playing) for (const system of this.gameplay) system.update(dt);
    const panning = intro !== null && !intro.done;
    for (const system of this.presentation) {
      if (panning && system === this.camera) continue;
      system.update(dt);
    }
  }

  /** Results over the frozen mission (GDD §14), launched by MissionSystem 1 s after the end. */
  private readonly showResults = (result: MissionResult): void => {
    const data: ResultsSceneData = {
      result,
      onAgain: () => {
        this.scene.stop(SceneKeys.Results);
        this.restartMission();
      },
    };
    this.scene.launch(SceneKeys.Results, data);
  };

  /**
   * Minimal pause (CD Q6): the whole scene pauses, so its clock, tweens, systems and the mission
   * timer freeze together, and the overlay above the HUD takes Resume / Restart.
   */
  private pauseMission(): void {
    const data: PauseSceneData = {
      onResume: () => {
        this.scene.stop(SceneKeys.Pause);
        this.scene.resume();
      },
      onRestart: () => {
        this.scene.stop(SceneKeys.Pause);
        this.restartMission();
      },
    };
    this.scene.pause();
    this.scene.launch(SceneKeys.Pause, data);
  }

  /** The one restart path (pause, results, debug): a new attempt with fresh recruits (GDD §14). */
  private readonly restartMission = (): void => {
    const data: MissionSceneData = { attempt: this.attempt + 1 };
    this.scene.restart(data);
  };

  /**
   * Systems in reverse order, then input, then the bus last (systems still `off()` their listeners
   * in destroy). Every destroy() runs even if one throws; the first error is re-thrown afterwards.
   */
  private readonly handleShutdown = (): void => {
    const teardown: (() => void)[] = [...this.systems].reverse().map((system) => () => {
      system.destroy();
    });
    const { gameInput, bus, tilemap } = this;
    if (tilemap)
      teardown.push(() => {
        tilemap.destroy();
      });
    if (gameInput)
      teardown.push(() => {
        gameInput.destroy();
      });
    if (bus)
      teardown.push(() => {
        bus.destroy();
      });
    this.systems = [];
    this.gameplay = [];
    this.presentation = [];
    this.run = null;
    this.intro = null;
    this.camera = null;
    this.skipIntro = null;
    this.gameInput = null;
    this.tilemap = null;
    // Queued: runs after this shutdown, before the next run launches its own overlays.
    this.scene.stop(SceneKeys.Hud);
    this.scene.stop(SceneKeys.Pause);
    this.scene.stop(SceneKeys.Results);
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

/** `{ "<prefix>.<name>": stats }`, so pools from several views stay apart in the leak log. */
function prefixed<T>(prefix: string, record: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).map(([name, value]) => [`${prefix}.${name}`, value]),
  );
}
