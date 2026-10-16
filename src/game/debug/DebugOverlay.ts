import Phaser from 'phaser';
import type { EntityId, MageClassId, StatusId, Team, Vec2, Rect } from '@core/types';
import type { CombatWorld } from '@core/combat/world';
import { distance } from '@core/math/vec2';
import { attemptSeed } from '@core/names/recruitNames';
import { selectTarget } from '@core/targeting/selectTarget';
import { createRng, type Rng } from '@core/rng/rng';
import { slotPosition } from '@core/squad/squad';
import { CLASSES } from '@data/classes';
import { DEV_SQUAD } from '@data/devArena';
import { ENEMIES } from '@data/enemies';
import { MOVEMENT } from '@data/movement';
import type { EventBus, GameEventListener } from '../bus/EventBus';
import { Depth } from '../depths';
import type { LeaderMarker } from '../entities/LeaderMarker';
import type { PoolStats } from '../fx/ImagePool';
import type { GameInput } from '../input/GameInput';
import type { CombatCounters, CombatSystem } from '../systems/CombatSystem';
import type { EnemyAiSystem, EnemyDebug } from '../systems/EnemyAiSystem';
import type { SquadSystem } from '../systems/SquadSystem';
import type { StatusSystem } from '../systems/StatusSystem';
import type { System } from '../systems/System';
import type { TargetingSystem } from '../systems/TargetingSystem';
import type { BurningOverlayView } from '../views/BurningOverlayView';
import type { DeathPuffView } from '../views/DeathPuffView';
import type { HitFlashView } from '../views/HitFlashView';
import type { CameraController } from '../world/CameraController';

/** Read-only view of the debug state, for the overlay and for automated playtests. */
export interface DebugSnapshot {
  readonly visible: boolean;
  readonly fps: number;
  readonly frame: number;
  /** Last frame's delta in ms, as systems received it. */
  readonly delta: number;
  readonly world: Rect;
  /** Rect the leader position is clamped to. */
  readonly walkable: Rect;
  /** Visible world area (camera.worldView). */
  readonly view: Rect;
  readonly camera: { readonly scrollX: number; readonly scrollY: number };
  readonly deadzone: Rect;
  /** Tracked leader point (eased on succession) plus the smoothed camera look-ahead offset. */
  readonly followPoint: Vec2;
  /** Null once the squad is wiped. */
  readonly leader: Vec2 | null;
  readonly squad: SquadDebugSnapshot;
  readonly combat: CombatDebugSnapshot;
  readonly marker: LeaderMarker['debugState'];
  readonly moveVector: Vec2;
  readonly aimWorld: Vec2 | null;
  /** Pointer in game (logical) pixels, as Phaser reports it. */
  readonly pointerScreen: Vec2;
  /** Leak check: these must not grow across scene restarts. */
  readonly lifecycle: {
    readonly overlaysCreated: number;
    readonly overlaysLive: number;
    readonly pointerMoveListeners: number;
    readonly pointerDownListeners: number;
    readonly keyboardKeys: number;
    readonly keyDownListeners: number;
    readonly sceneShutdownListeners: number;
    /** Listeners on this run's game event bus, all events. */
    readonly busListeners: number;
    /** Game objects on the scene's display list (ground, units, pooled FX, marker, overlay). */
    readonly displayObjects: number;
  };
}

export interface UnitDebugSnapshot {
  readonly id: EntityId;
  readonly team: Team;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly statuses: readonly {
    readonly status: StatusId;
    readonly remainingMs: number;
    readonly nextTickInMs: number;
  }[];
}

export interface WizardCombatSnapshot {
  readonly id: EntityId;
  readonly mageClass: MageClassId;
  readonly target: EntityId | null;
  readonly cooldownMs: number;
  readonly sinceRetargetMs: number;
}

export interface CombatDebugSnapshot {
  /** Every unit in the combat world, ascending id. */
  readonly units: readonly UnitDebugSnapshot[];
  readonly wizards: readonly WizardCombatSnapshot[];
  readonly enemies: readonly EnemyDebug[];
  readonly projectiles: readonly {
    readonly id: EntityId;
    readonly ownerId: EntityId;
    readonly team: Team;
    readonly position: Vec2;
    readonly radiusPx: number;
    readonly travelledPx: number;
  }[];
  readonly pools: {
    readonly projectiles: PoolStats;
    readonly puffs: PoolStats;
    readonly burning: PoolStats;
  };
  readonly counters: CombatCounters & { readonly statusTicks: number; readonly whiffs: number };
  /** Bus events seen this run. `damagedAfterDeath` and `statusAfterDeath` must stay 0 (D4). */
  readonly events: {
    readonly damaged: number;
    readonly died: number;
    readonly enemyDeaths: number;
    readonly statusApplied: number;
    readonly statusExpired: number;
    readonly damagedAfterDeath: number;
    readonly statusAfterDeath: number;
  };
  /** Units showing the Burning overlay. */
  readonly burningOverlays: readonly EntityId[];
  readonly flashing: number;
  /** Times the encounter was respawned with G this run. */
  readonly respawns: number;
}

export interface WizardDebugSnapshot {
  readonly id: EntityId;
  readonly name: string;
  /** 0 is the leader. */
  readonly index: number;
  readonly position: Vec2;
  /** px/s, exactly {0,0} at rest. */
  readonly velocity: Vec2;
  /** Trail slot (index × followerSpacingPx behind the leader); null for the leader. */
  readonly slot: Vec2 | null;
  /** Distance from position to slot; 0 for the leader. */
  readonly slotErrorPx: number;
  /** Distance to the wizard one index ahead; null for the leader. */
  readonly spacingToPredecessorPx: number | null;
}

export interface SquadDebugSnapshot {
  /** Restart number this run was started with (names use nameSeed + attempt). */
  readonly attempt: number;
  readonly leaderId: EntityId | null;
  readonly members: readonly WizardDebugSnapshot[];
  /** Largest body-circle overlap between any two wizards right now, ≥ 0. */
  readonly maxOverlapPx: number;
  readonly breadcrumbs: number;
  /** Trail crumbs, newest first (the head, the leader's position, is not included). */
  readonly trail: readonly Vec2[];
  /** True while the camera eases to a newly promoted leader. */
  readonly cameraEasing: boolean;
  /** `unit:died` events seen on the bus this run, in order. */
  readonly deaths: readonly EntityId[];
  /** Last `squad:leader-changed` seen on the bus this run, with the game frame it arrived on. */
  readonly lastLeaderChange: { readonly id: EntityId; readonly frame: number } | null;
}

export interface DebugHook {
  snapshot(): DebugSnapshot;
}

declare global {
  interface Window {
    /** Present only when the page was opened with ?debug. */
    __ARCANE_DEBUG__?: DebugHook;
  }
}

export interface DebugSources {
  readonly bus: EventBus;
  readonly input: GameInput;
  readonly squad: SquadSystem;
  readonly marker: LeaderMarker;
  readonly camera: CameraController;
  readonly world: Rect;
  readonly attempt: number;
  readonly combatWorld: CombatWorld;
  readonly enemies: EnemyAiSystem;
  readonly targeting: TargetingSystem;
  readonly combat: CombatSystem;
  readonly status: StatusSystem;
  readonly hitFlash: HitFlashView;
  readonly burning: BurningOverlayView;
  readonly puffs: DeathPuffView;
}

export interface DebugOptions {
  /** Start visible and publish `window.__ARCANE_DEBUG__`. */
  readonly debugUrl: boolean;
  /** Debug-only scene restart, used to prove nothing leaks or doubles. */
  readonly onRestart: () => void;
  /** Debug-only: despawn every goblin and spawn the dev encounter again. */
  readonly onRespawnEncounter: () => void;
}

const DEBUG_QUERY_PARAM = 'debug';
const ToggleKey = Phaser.Input.Keyboard.KeyCodes.BACKTICK;
const RestartKey = Phaser.Input.Keyboard.KeyCodes.BACKSPACE;
const KillLeaderKey = Phaser.Input.Keyboard.KeyCodes.K;
const KillFollowerKey = Phaser.Input.Keyboard.KeyCodes.L;
const RespawnKey = Phaser.Input.Keyboard.KeyCodes.G;
const BurnKey = Phaser.Input.Keyboard.KeyCodes.B;
/** Mixed into the run's name seed, so the L key's picks don't mirror the name draws. */
const DEBUG_RNG_SALT = 0x5eed_dead;

const TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '10px',
  color: '#ffffff',
  backgroundColor: '#000000aa',
  padding: { x: 3, y: 2 },
};
const TEXT_MARGIN_PX = 4;
const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  ...TEXT_STYLE,
  backgroundColor: '#00000088',
  padding: { x: 2, y: 1 },
};
const CRUMB_SIZE_PX = 2;
/**
 * Marker line widths in world px. The 640×360 canvas is shown with `image-rendering: pixelated`,
 * so below 1× (e.g. 0.61× on a 390 px phone) whole 1 px rows and columns are dropped. 2 px lines
 * survive any FIT scale.
 */
const MARKER_LINE_PX = 2;
/** Crosshair arm length from the centre: 11 px across, drawn over a dark outline. */
const CROSSHAIR_HALF_PX = 5;
const CROSSHAIR_OUTLINE_PX = 4;
const FOLLOW_DOT_RADIUS_PX = 2;
const Colors = {
  crosshair: 0xff4040,
  outline: 0x000000,
  deadzone: 0xffe14d,
  followPoint: 0xffe14d,
  body: 0x40e0ff,
  separation: 0x40e0ff,
  slotLine: 0xff8cf0,
  crumb: 0xffffff,
  wizardTarget: 0x7fffd4,
  wizardRange: 0x7fffd4,
  enemyTarget: 0xff5050,
  aggro: 0xffa040,
  enemyRange: 0xff5050,
  enemyBody: 0xff8c40,
  aim: 0xff5050,
  projectile: 0xffffff,
} as const;
const SEPARATION_ALPHA = 0.35;
const RANGE_ALPHA = 0.3;
const AIM_HALF_PX = 3;

let overlaysCreated = 0;
let overlaysLive = 0;

export function isDebugUrl(): boolean {
  return new URLSearchParams(window.location.search).has(DEBUG_QUERY_PARAM);
}

/**
 * Screen-fixed debug readout plus world-space markers: aim crosshair, deadzone, follow point, and
 * per wizard the body circle, separation radius, a line to its trail slot and its index (names,
 * slot error and spacing are in the panel); the breadcrumbs too. Backtick toggles it. While it is visible: Backspace restarts the scene, K kills
 * the leader and L a random follower (seeded per attempt), both through CombatSystem.kill like any
 * death (so the combat world and the squad agree), B sets the nearest living goblin to the
 * leader Burning (no damage, no source; so D3's expiry can be seen in game), and G
 * respawns the dev encounter.
 *
 * Combat (M4): HP, cooldown and target per wizard and per goblin (AI state, time in state,
 * statuses) in the panel; target lines, wizard attack ranges, goblin aggro and attack ranges, body
 * circles, archer aim locks, projectile hit circles and an AI state label per goblin in the world;
 * projectile and pool counts and the bus event counts (D4: damage after death stays 0).
 */
export class DebugOverlay implements System {
  private readonly text: Phaser.GameObjects.Text;
  private readonly markers: Phaser.GameObjects.Graphics;
  private readonly toggleKey: Phaser.Input.Keyboard.Key;
  private readonly restartKey: Phaser.Input.Keyboard.Key;
  private readonly killLeaderKey: Phaser.Input.Keyboard.Key;
  private readonly killFollowerKey: Phaser.Input.Keyboard.Key;
  private readonly respawnKey: Phaser.Input.Keyboard.Key;
  private readonly burnKey: Phaser.Input.Keyboard.Key;
  /** One state label per goblin, made on first sight and destroyed when it is gone. */
  private readonly enemyLabels = new Map<EntityId, Phaser.GameObjects.Text>();
  private readonly diedIds = new Set<EntityId>();
  private events: CombatDebugSnapshot['events'] = {
    damaged: 0,
    died: 0,
    enemyDeaths: 0,
    statusApplied: 0,
    statusExpired: 0,
    damagedAfterDeath: 0,
    statusAfterDeath: 0,
  };
  private respawns = 0;
  /**
   * One index label per recruit (the squad never grows within a run), centred on the feet. Full
   * names collide in a 26 px single file, so they live in the panel; two index labels only overlap
   * when the bodies do.
   */
  private readonly labels: Phaser.GameObjects.Text[];
  private readonly killRng: Rng;
  private readonly hook: DebugHook | null;
  private readonly deaths: EntityId[] = [];
  private lastLeaderChange: SquadDebugSnapshot['lastLeaderChange'] = null;
  private visible: boolean;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sources: DebugSources,
    private readonly options: DebugOptions,
  ) {
    overlaysCreated++;
    overlaysLive++;
    this.visible = options.debugUrl;

    this.text = scene.add
      .text(TEXT_MARGIN_PX, TEXT_MARGIN_PX, '', TEXT_STYLE)
      .setScrollFactor(0)
      .setDepth(Depth.Debug);
    this.markers = scene.add.graphics().setDepth(Depth.Debug);
    this.labels = sources.squad.state.members.map(() =>
      scene.add.text(0, 0, '', LABEL_STYLE).setOrigin(0.5, 0.5).setDepth(Depth.Debug),
    );
    this.killRng = createRng(attemptSeed(DEV_SQUAD.nameSeed, sources.attempt) ^ DEBUG_RNG_SALT);
    sources.bus.on('unit:died', this.handleUnitDied);
    sources.bus.on('squad:leader-changed', this.handleLeaderChanged);
    sources.bus.on('unit:damaged', this.handleDamaged);
    sources.bus.on('status:applied', this.handleStatusApplied);
    sources.bus.on('status:expired', this.handleStatusExpired);

    const keyboard = this.keyboard;
    this.toggleKey = keyboard.addKey(ToggleKey).on(Phaser.Input.Keyboard.Events.DOWN, this.toggle);
    this.restartKey = keyboard
      .addKey(RestartKey)
      .on(Phaser.Input.Keyboard.Events.DOWN, this.restart);
    this.killLeaderKey = keyboard
      .addKey(KillLeaderKey)
      .on(Phaser.Input.Keyboard.Events.DOWN, this.killLeader);
    this.killFollowerKey = keyboard
      .addKey(KillFollowerKey)
      .on(Phaser.Input.Keyboard.Events.DOWN, this.killFollower);
    this.respawnKey = keyboard
      .addKey(RespawnKey)
      .on(Phaser.Input.Keyboard.Events.DOWN, this.respawnEncounter);
    this.burnKey = keyboard.addKey(BurnKey).on(Phaser.Input.Keyboard.Events.DOWN, this.burnNearest);

    this.hook = options.debugUrl ? { snapshot: () => this.snapshot() } : null;
    if (this.hook) window.__ARCANE_DEBUG__ = this.hook;

    this.applyVisibility();
  }

  update(): void {
    if (!this.visible) return;
    const s = this.snapshot();

    const lines = [
      `fps     ${s.fps.toFixed(0)}`,
      `leader  ${s.leader ? formatVec(s.leader) : '-'}`,
      `move    ${formatVec(s.moveVector, 2)}`,
      `aim     ${s.aimWorld ? formatVec(s.aimWorld) : '-'}`,
      `scroll  ${formatVec({ x: s.camera.scrollX, y: s.camera.scrollY })}`,
      `look    ${s.leader ? formatVec({ x: s.followPoint.x - s.leader.x, y: s.followPoint.y - s.leader.y }) : '-'}`,
      `squad   attempt ${String(s.squad.attempt)}  overlap ${s.squad.maxOverlapPx.toFixed(1)}  crumbs ${String(s.squad.breadcrumbs)}${s.squad.cameraEasing ? '  cam easing' : ''}`,
      ...s.squad.members.map((w) => {
        const combat = s.combat.wizards.find((c) => c.id === w.id);
        return `${String(w.index)} ${w.name.padEnd(28)} err ${w.slotErrorPx.toFixed(1).padStart(5)}  gap ${w.spacingToPredecessorPx === null ? '    -' : w.spacingToPredecessorPx.toFixed(1).padStart(5)}  ${this.unitLine(s.combat, w.id)}  cd ${formatSeconds(combat?.cooldownMs ?? 0)} ${formatTarget(combat?.target ?? null)}`;
      }),
      ...(s.squad.members.length === 0 ? ['Squad wiped. [Backspace] restart'] : []),
      ...s.combat.enemies.map(
        (e) =>
          `#${String(e.id).padEnd(3)} ${e.enemy.replace('goblin-', '').padEnd(6)} ${e.state.padEnd(10)} ${formatSeconds(e.timeInStateMs)}  ${this.unitLine(s.combat, e.id)}  cd ${formatSeconds(e.cooldownMs)} ${formatTarget(e.target)}${e.knockbacks > 0 ? '  knock' : ''}`,
      ),
      `proj    ${String(s.combat.projectiles.length)}  pools proj ${formatPool(s.combat.pools.projectiles)} puff ${formatPool(s.combat.pools.puffs)} burn ${formatPool(s.combat.pools.burning)}`,
      `events  dmg ${String(s.combat.events.damaged)} died ${String(s.combat.events.died)} burn +${String(s.combat.events.statusApplied)}/-${String(s.combat.events.statusExpired)} ticks ${String(s.combat.counters.statusTicks)} whiffs ${String(s.combat.counters.whiffs)}  after death ${String(s.combat.events.damagedAfterDeath + s.combat.events.statusAfterDeath)}`,
      '[`] hide  [Backspace] restart  [K] kill leader  [L] kill follower  [G] respawn goblins  [B] burn nearest goblin',
    ];
    const content = lines.join('\n');
    if (this.text.text !== content) this.text.setText(content);

    const g = this.markers.clear();
    const zone = s.deadzone;
    g.lineStyle(MARKER_LINE_PX, Colors.deadzone).strokeRect(
      zone.x,
      zone.y,
      zone.width,
      zone.height,
    );
    for (const crumb of s.squad.trail) {
      g.fillStyle(Colors.crumb).fillRect(
        crumb.x - CRUMB_SIZE_PX / 2,
        crumb.y - CRUMB_SIZE_PX / 2,
        CRUMB_SIZE_PX,
        CRUMB_SIZE_PX,
      );
    }
    const { separationRadiusPx } = this.sources.squad.trailTuning;
    for (const wizard of s.squad.members) {
      const { x, y } = wizard.position;
      g.lineStyle(MARKER_LINE_PX, Colors.separation, SEPARATION_ALPHA).strokeCircle(
        x,
        y,
        separationRadiusPx,
      );
      g.lineStyle(MARKER_LINE_PX, Colors.body).strokeCircle(x, y, MOVEMENT.wizardBodyRadiusPx);
      if (wizard.slot) {
        g.lineStyle(MARKER_LINE_PX, Colors.slotLine).lineBetween(
          x,
          y,
          wizard.slot.x,
          wizard.slot.y,
        );
      }
    }
    this.labels.forEach((label, i) => {
      const wizard = s.squad.members[i];
      label.setVisible(wizard !== undefined);
      if (!wizard) return;
      const content = String(wizard.index);
      if (label.text !== content) label.setText(content);
      label.setPosition(wizard.position.x, wizard.position.y);
    });
    g.fillStyle(Colors.followPoint).fillCircle(
      s.followPoint.x,
      s.followPoint.y,
      FOLLOW_DOT_RADIUS_PX,
    );
    this.drawCombat(g, s);
    if (s.aimWorld) this.drawCrosshair(g, s.aimWorld);
  }

  snapshot(): DebugSnapshot {
    const { input, squad, camera, world } = this.sources;
    const { leader } = squad;
    const cam = this.scene.cameras.main;
    const { worldView } = cam;
    const pointer = this.scene.input.activePointer;
    // Phaser types `keys` as dense, but removeKey() and shutdown leave undefined slots behind.
    const slots: readonly (Phaser.Input.Keyboard.Key | undefined)[] = this.keyboard.keys;
    const keys = slots.filter((key) => key !== undefined);
    return {
      visible: this.visible,
      fps: this.scene.game.loop.actualFps,
      frame: this.scene.game.loop.frame,
      delta: this.scene.game.loop.delta,
      world: { ...world },
      walkable: { ...squad.walkable },
      view: { x: worldView.x, y: worldView.y, width: worldView.width, height: worldView.height },
      camera: { scrollX: cam.scrollX, scrollY: cam.scrollY },
      deadzone: camera.deadzoneWorld,
      followPoint: camera.followPoint,
      leader: leader ? { ...leader.position } : null,
      squad: this.squadSnapshot(),
      combat: this.combatSnapshot(),
      marker: this.sources.marker.debugState,
      moveVector: { ...input.moveVector },
      aimWorld: input.aimWorld ? { ...input.aimWorld } : null,
      pointerScreen: { x: pointer.x, y: pointer.y },
      lifecycle: {
        overlaysCreated,
        overlaysLive,
        pointerMoveListeners: this.scene.input.listenerCount(Phaser.Input.Events.POINTER_MOVE),
        pointerDownListeners: this.scene.input.listenerCount(Phaser.Input.Events.POINTER_DOWN),
        keyboardKeys: keys.length,
        keyDownListeners: keys.reduce(
          (sum, key) => sum + key.listenerCount(Phaser.Input.Keyboard.Events.DOWN),
          0,
        ),
        sceneShutdownListeners: this.scene.events.listenerCount(Phaser.Scenes.Events.SHUTDOWN),
        busListeners: this.sources.bus.listenerCount(),
        displayObjects: this.scene.children.length,
      },
    };
  }

  destroy(): void {
    // Keys may be shared with other systems (addKey returns the existing Key), so only our
    // handlers are removed; KeyboardPlugin.shutdown removes the Key objects.
    this.toggleKey.off(Phaser.Input.Keyboard.Events.DOWN, this.toggle);
    this.restartKey.off(Phaser.Input.Keyboard.Events.DOWN, this.restart);
    this.killLeaderKey.off(Phaser.Input.Keyboard.Events.DOWN, this.killLeader);
    this.killFollowerKey.off(Phaser.Input.Keyboard.Events.DOWN, this.killFollower);
    this.respawnKey.off(Phaser.Input.Keyboard.Events.DOWN, this.respawnEncounter);
    this.burnKey.off(Phaser.Input.Keyboard.Events.DOWN, this.burnNearest);
    this.sources.bus.off('unit:died', this.handleUnitDied);
    this.sources.bus.off('squad:leader-changed', this.handleLeaderChanged);
    this.sources.bus.off('unit:damaged', this.handleDamaged);
    this.sources.bus.off('status:applied', this.handleStatusApplied);
    this.sources.bus.off('status:expired', this.handleStatusExpired);
    this.text.destroy();
    this.markers.destroy();
    for (const label of this.labels) label.destroy();
    for (const label of this.enemyLabels.values()) label.destroy();
    this.enemyLabels.clear();
    if (this.hook && window.__ARCANE_DEBUG__ === this.hook) delete window.__ARCANE_DEBUG__;
    overlaysLive--;
  }

  private squadSnapshot(): SquadDebugSnapshot {
    const { squad, camera, attempt } = this.sources;
    const { state, trailTuning } = squad;
    const members = state.members.map((member, index): WizardDebugSnapshot => {
      const slot = index > 0 ? slotPosition(state, index, trailTuning) : null;
      const ahead = state.members[index - 1];
      return {
        id: member.id,
        name: squad.nameOf(member.id),
        index,
        position: { ...member.position },
        velocity: { ...member.velocity },
        slot: slot ? { ...slot } : null,
        slotErrorPx: slot ? distance(member.position, slot) : 0,
        spacingToPredecessorPx: ahead ? distance(member.position, ahead.position) : null,
      };
    });
    const diameter = MOVEMENT.wizardBodyRadiusPx * 2;
    let maxOverlapPx = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i];
        const b = members[j];
        if (!a || !b) continue;
        maxOverlapPx = Math.max(maxOverlapPx, diameter - distance(a.position, b.position));
      }
    }
    return {
      attempt,
      leaderId: state.members[0]?.id ?? null,
      members,
      maxOverlapPx,
      breadcrumbs: state.trail.crumbs.length,
      trail: state.trail.crumbs.map((crumb) => ({ ...crumb })),
      cameraEasing: camera.isEasingSuccession,
      deaths: [...this.deaths],
      lastLeaderChange: this.lastLeaderChange,
    };
  }

  private combatSnapshot(): CombatDebugSnapshot {
    const { combatWorld, squad, enemies, targeting, combat, status, hitFlash, burning, puffs } =
      this.sources;
    return {
      units: combatWorld.units().map((unit) => ({
        id: unit.id,
        team: unit.team,
        hp: unit.hp,
        maxHp: unit.maxHp,
        alive: unit.alive,
        statuses: [...unit.statuses.values()].map(({ status, remainingMs, nextTickInMs }) => ({
          status,
          remainingMs,
          nextTickInMs,
        })),
      })),
      wizards: squad.state.members.map((member) => ({
        id: member.id,
        mageClass: squad.classOf(member.id),
        target: targeting.targetOf(member.id),
        cooldownMs: targeting.cooldownOf(member.id),
        sinceRetargetMs: targeting.sinceRetargetOf(member.id),
      })),
      enemies: enemies.debugEnemies,
      projectiles: combat.liveProjectiles.map((p) => ({
        id: p.id,
        ownerId: p.ownerId,
        team: p.team,
        position: { ...p.position },
        radiusPx: p.radiusPx,
        travelledPx: p.travelledPx,
      })),
      pools: { projectiles: combat.poolStats, puffs: puffs.poolStats, burning: burning.poolStats },
      counters: { ...combat.stats, statusTicks: status.ticks, whiffs: enemies.whiffs },
      events: { ...this.events },
      burningOverlays: burning.burningIds,
      flashing: hitFlash.flashing,
      respawns: this.respawns,
    };
  }

  /** "hp 18/24 burn 2.5s" for one unit. */
  private unitLine(combat: CombatDebugSnapshot, id: EntityId): string {
    const unit = combat.units.find((u) => u.id === id);
    if (!unit) return 'hp -';
    const statuses = unit.statuses.map((st) => ` ${st.status} ${formatSeconds(st.remainingMs)}`);
    return `hp ${String(unit.hp).padStart(2)}/${String(unit.maxHp)}${statuses.join('')}`;
  }

  /**
   * Wizard attack ranges and target lines; goblin body, aggro and attack range circles, target
   * lines, archer aim locks and state labels; projectile hit circles.
   */
  private drawCombat(g: Phaser.GameObjects.Graphics, s: DebugSnapshot): void {
    const at = (id: EntityId | null): Vec2 | undefined => {
      if (id === null) return undefined;
      return (
        s.squad.members.find((m) => m.id === id)?.position ??
        s.combat.enemies.find((e) => e.id === id)?.position
      );
    };
    for (const wizard of s.combat.wizards) {
      const from = at(wizard.id);
      if (!from) continue;
      const { rangePx } = CLASSES[wizard.mageClass].attack;
      g.lineStyle(MARKER_LINE_PX, Colors.wizardRange, RANGE_ALPHA).strokeCircle(
        from.x,
        from.y,
        rangePx,
      );
      const to = at(wizard.target);
      if (to)
        g.lineStyle(MARKER_LINE_PX, Colors.wizardTarget).lineBetween(from.x, from.y, to.x, to.y);
    }
    const seen = new Set<EntityId>();
    for (const enemy of s.combat.enemies) {
      seen.add(enemy.id);
      const def = ENEMIES[enemy.enemy];
      const { x, y } = enemy.position;
      g.lineStyle(MARKER_LINE_PX, Colors.aggro, RANGE_ALPHA).strokeCircle(x, y, def.aggroRadiusPx);
      g.lineStyle(MARKER_LINE_PX, Colors.enemyRange, RANGE_ALPHA).strokeCircle(
        x,
        y,
        def.attack.rangePx,
      );
      g.lineStyle(MARKER_LINE_PX, Colors.enemyBody).strokeCircle(x, y, def.bodyRadiusPx);
      const to = at(enemy.target);
      if (to) g.lineStyle(MARKER_LINE_PX, Colors.enemyTarget).lineBetween(x, y, to.x, to.y);
      if (enemy.aim) {
        const a = enemy.aim;
        g.lineStyle(MARKER_LINE_PX, Colors.aim)
          .lineBetween(a.x - AIM_HALF_PX, a.y - AIM_HALF_PX, a.x + AIM_HALF_PX, a.y + AIM_HALF_PX)
          .lineBetween(a.x - AIM_HALF_PX, a.y + AIM_HALF_PX, a.x + AIM_HALF_PX, a.y - AIM_HALF_PX);
      }
      let label = this.enemyLabels.get(enemy.id);
      if (!label) {
        label = this.scene.add.text(0, 0, '', LABEL_STYLE).setOrigin(0.5, 0).setDepth(Depth.Debug);
        this.enemyLabels.set(enemy.id, label);
      }
      const content = `${String(enemy.id)} ${enemy.state}`;
      if (label.text !== content) label.setText(content);
      label.setPosition(x, y + def.bodyRadiusPx).setVisible(true);
    }
    for (const [id, label] of this.enemyLabels) {
      if (seen.has(id)) continue;
      label.destroy();
      this.enemyLabels.delete(id);
    }
    for (const p of s.combat.projectiles) {
      g.lineStyle(MARKER_LINE_PX, Colors.projectile).strokeCircle(
        p.position.x,
        p.position.y,
        p.radiusPx,
      );
    }
  }

  private drawCrosshair(g: Phaser.GameObjects.Graphics, { x, y }: Vec2): void {
    const arms = (width: number, color: number, reach: number): void => {
      g.lineStyle(width, color)
        .lineBetween(x - reach, y, x + reach, y)
        .lineBetween(x, y - reach, x, y + reach);
    };
    const outlineReach = CROSSHAIR_HALF_PX + (CROSSHAIR_OUTLINE_PX - MARKER_LINE_PX) / 2;
    arms(CROSSHAIR_OUTLINE_PX, Colors.outline, outlineReach);
    arms(MARKER_LINE_PX, Colors.crosshair, CROSSHAIR_HALF_PX);
  }

  private get keyboard(): Phaser.Input.Keyboard.KeyboardPlugin {
    const { keyboard } = this.scene.input;
    if (!keyboard) throw new Error('DebugOverlay needs the keyboard plugin');
    return keyboard;
  }

  private applyVisibility(): void {
    this.text.setVisible(this.visible);
    this.markers.setVisible(this.visible);
    for (const label of this.labels) label.setVisible(this.visible);
    for (const label of this.enemyLabels.values()) label.setVisible(this.visible);
  }

  // OS auto-repeat is ignored, or a held key would toggle or restart again after each restart.
  private readonly toggle = (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent): void => {
    if (event.repeat) return;
    this.visible = !this.visible;
    this.applyVisibility();
  };

  private readonly restart = (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent): void => {
    if (this.visible && !event.repeat) this.options.onRestart();
  };

  private readonly killLeader = (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent): void => {
    if (!this.visible || event.repeat) return;
    const { squad } = this.sources;
    const leader = squad.state.members[0];
    if (leader) this.sources.combat.kill(leader.id, 'combat');
  };

  private readonly killFollower = (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent): void => {
    if (!this.visible || event.repeat) return;
    const { squad } = this.sources;
    const followers = squad.state.members.slice(1);
    if (followers.length > 0) this.sources.combat.kill(this.killRng.pick(followers).id, 'combat');
  };

  private readonly respawnEncounter = (
    _key: Phaser.Input.Keyboard.Key,
    event: KeyboardEvent,
  ): void => {
    if (!this.visible || event.repeat) return;
    this.respawns++;
    this.options.onRespawnEncounter();
  };

  /** Debug B: Burning on the nearest living goblin to the leader, through the normal status path. */
  private readonly burnNearest = (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent): void => {
    if (!this.visible || event.repeat) return;
    const { squad, enemies, combatWorld, combat } = this.sources;
    const leader = squad.leader;
    if (!leader) return;
    const candidates = enemies.ids().flatMap((id) => {
      const position = enemies.positionOf(id);
      return position
        ? [{ id, position, kind: 'unit' as const, alive: combatWorld.isAlive(id) }]
        : [];
    });
    const target = selectTarget(leader.position, Number.POSITIVE_INFINITY, candidates);
    if (target !== null) combat.applyStatus(target, 'burning', null);
  };

  private readonly handleUnitDied: GameEventListener<'unit:died'> = ({ id, team }) => {
    this.deaths.push(id);
    this.diedIds.add(id);
    this.events = {
      ...this.events,
      died: this.events.died + 1,
      enemyDeaths: this.events.enemyDeaths + (team === 'enemy' ? 1 : 0),
    };
  };

  private readonly handleDamaged: GameEventListener<'unit:damaged'> = ({ id }) => {
    this.events = {
      ...this.events,
      damaged: this.events.damaged + 1,
      damagedAfterDeath: this.events.damagedAfterDeath + (this.diedIds.has(id) ? 1 : 0),
    };
  };

  private readonly handleStatusApplied: GameEventListener<'status:applied'> = ({ id }) => {
    this.events = {
      ...this.events,
      statusApplied: this.events.statusApplied + 1,
      statusAfterDeath: this.events.statusAfterDeath + (this.diedIds.has(id) ? 1 : 0),
    };
  };

  private readonly handleStatusExpired: GameEventListener<'status:expired'> = ({ id }) => {
    this.events = {
      ...this.events,
      statusExpired: this.events.statusExpired + 1,
      statusAfterDeath: this.events.statusAfterDeath + (this.diedIds.has(id) ? 1 : 0),
    };
  };

  private readonly handleLeaderChanged: GameEventListener<'squad:leader-changed'> = ({ id }) => {
    this.lastLeaderChange = { id, frame: this.scene.game.loop.frame };
  };
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTarget(id: EntityId | null): string {
  return id === null ? '-> -' : `-> #${String(id)}`;
}

function formatPool({ live, created }: PoolStats): string {
  return `${String(live)}/${String(created)}`;
}

function formatVec(v: Vec2, digits = 1): string {
  return `${v.x.toFixed(digits)}, ${v.y.toFixed(digits)}`;
}
