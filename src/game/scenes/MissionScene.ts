import Phaser from 'phaser';
import type { Vec2 } from '@core/types';
import { createIdAllocator } from '@core/ids';
import { CombatWorld } from '@core/combat/world';
import { attemptSeed } from '@core/names/recruitNames';
import { COMBAT } from '@data/combat';
import { DEV_ARENA, DEV_ENCOUNTER, DEV_KEG_PACK, DEV_SQUAD } from '@data/devArena';
import { EventBus } from '../bus/EventBus';
import { DebugOverlay, isDebugUrl } from '../debug/DebugOverlay';
import { LeaderMarker } from '../entities/LeaderMarker';
import { combineLookups } from '../entities/Positioned';
import { FlashBudget } from '../fx/FlashBudget';
import { ScreenShake } from '../fx/ScreenShake';
import { HudModel } from '../hud/HudModel';
import type { GameInput } from '../input/GameInput';
import { KeyboardMouseInput } from '../input/KeyboardMouseInput';
import { SavedHatHill } from '../save/SavedHatHill';
import type { GameServices } from '../services';
import { CombatSystem } from '../systems/CombatSystem';
import { ConvergenceSystem } from '../systems/ConvergenceSystem';
import { EnemyAiSystem } from '../systems/EnemyAiSystem';
import { KegSystem } from '../systems/KegSystem';
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
import { ReactionFxView } from '../views/ReactionFxView';
import { SpellFxView } from '../views/SpellFxView';
import { VolunteerFxView } from '../views/VolunteerFxView';
import { CameraController } from '../world/CameraController';
import { createPlaceholderGround } from '../world/PlaceholderGround';
import type { HudSceneData } from './HudScene';
import { SceneKeys } from './keys';

/** Mixed into the run's name seed, so the barrage picks and barks don't mirror the name draws. */
const CONVERGENCE_RNG_SALT = 0xc0_47e6;
const BARK_RNG_SALT = 0xba_4b5;

const NO_MOVE: Vec2 = { x: 0, y: 0 };

/** Passed through `scene.restart(data)`. */
export interface MissionSceneData {
  /** Restart number, 0 for the first try. Each restart gives fresh recruits (GDD Q17). */
  readonly attempt?: number;
}

/**
 * Dev arena: a squad fighting the dev goblin encounter on a grid world. Systems read each other
 * through narrow interfaces (the camera reads the squad's leader, combat reads targets) and react
 * to each other through the scene's {@link EventBus}.
 *
 * Frame order (M6.md): input → squad → enemies (brains, movement, knockback) → targeting →
 * Convergence (channel, strike timeline, burning ground, R press) → Volunteer! (sprints,
 * detonations, F press) → spells (slots, cooldowns, strikes, Fireball flights, casts) → kegs (fuses,
 * Kaboom) → combat (cooldowns, shots, projectiles, hits) → statuses (ticks, then the frame's
 * deaths) → HUD model → views (hit flash, health bars, Burning, death puffs, spell, reaction,
 * Convergence and Volunteer! FX, leader marker) → camera → debug. The HUD is its own scene above.
 *
 * Platform services (the save repository) come in through the constructor (registry.ts); Phaser
 * reuses this instance on restart, so they outlive every run.
 */
export class MissionScene extends Phaser.Scene {
  private attempt = 0;
  /** Created before every system and destroyed after all of them. */
  private bus: EventBus | null = null;
  private gameInput: GameInput | null = null;
  /** Updated in order, destroyed in reverse order. */
  private systems: System[] = [];

  constructor(private readonly services: GameServices) {
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
    // One allocator per scene run, so ids restart at 1 and stay ascending (GDD §0).
    const ids = createIdAllocator();
    // The Convergence holds the squad and blocks autos while it channels (GDD §10). It is built
    // after the squad, so the squad and targeting read it through this lazy view.
    const hold: SquadHold = {
      get held() {
        return convergence.held;
      },
    };
    const squad = new SquadSystem(this, gameInput, bus, world, center, {
      attempt: this.attempt,
      ids,
      hold,
    });
    // HP, statuses and alive/dead of every unit; CombatSystem resolves every change to it.
    const combatWorld = new CombatWorld();
    const origin = squad.leader?.position ?? center;
    const enemies = new EnemyAiSystem(this, combatWorld, squad, world, {
      ids,
      origin,
      // The keg pack sits outside every aggro at spawn, so M4's no-input fight is unchanged (Q2).
      encounter: [...DEV_ENCOUNTER, ...DEV_KEG_PACK],
    });
    const targeting = new TargetingSystem(squad, enemies, combatWorld, hold);
    // Kegs hand each ended fuse to combat for the Kaboom; combat lights kegs back through them.
    const kegs = new KegSystem(
      this,
      bus,
      (keg) => {
        combat.resolveKaboom(keg);
      },
      { ids, origin },
    );
    const combat = new CombatSystem(this, combatWorld, squad, enemies, targeting, ids, bus, kegs);
    const runSeed = attemptSeed(DEV_SQUAD.nameSeed, this.attempt);
    const convergence = new ConvergenceSystem(gameInput, squad, enemies, combat, bus, {
      // Credit ids, never units: strikes (no meter charge) and the reactions they cause (Q3).
      ids: { sourceId: ids.next(), reactionSourceId: ids.next() },
      rngSeed: runSeed ^ CONVERGENCE_RNG_SALT,
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
      { barkSeed: runSeed ^ BARK_RNG_SALT, missionId: 'dev-arena' },
    );
    const spells = new SpellSystem(gameInput, squad, enemies, combat, kegs, convergence, ids, bus);
    // Runners that fell mid-sprint detonate just before the frame's death flush.
    const status = new StatusSystem(combatWorld, combat, bus, [volunteer]);
    const hud = new HudModel(spells, convergence, volunteer, bus);
    const flashBudget = new FlashBudget();
    // One shake for every FX view: the §5c rule (bigger or equal replaces, never stacks).
    const screenShake = new ScreenShake(this.cameras.main);
    const units = combineLookups(squad, enemies);
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
      },
      {
        debugUrl: isDebugUrl(),
        onRestart: () => {
          const data: MissionSceneData = { attempt: this.attempt + 1 };
          this.scene.restart(data);
        },
        onRespawnEncounter: () => {
          enemies.respawn();
          kegs.respawn();
        },
      },
    );

    this.bus = bus;
    this.gameInput = gameInput;
    this.systems = [
      squad,
      enemies,
      targeting,
      convergence,
      volunteer,
      spells,
      kegs,
      combat,
      status,
      hud,
      flashBudget,
      hitFlash,
      healthBars,
      burning,
      puffs,
      spellFx,
      reactionFx,
      convergenceFx,
      volunteerFx,
      marker,
      camera,
      debug,
    ];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown);
    // A fresh HUD per run, reading this run's model (M5 Q3); stopped in handleShutdown.
    const hudData: HudSceneData = { view: hud };
    this.scene.launch(SceneKeys.Hud, hudData);
  }

  /** Gameplay dt is clamped (tab switches, hitches), so nothing tunnels or jumps after a stall. */
  override update(_time: number, delta: number): void {
    const dt = Math.min(delta, COMBAT.maxFrameDtMs);
    this.gameInput?.update();
    for (const system of this.systems) system.update(dt);
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
    // Queued: runs after this shutdown, before the next run launches its own HUD.
    this.scene.stop(SceneKeys.Hud);
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
