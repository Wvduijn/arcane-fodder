import type Phaser from 'phaser';
import type { EnemyId, EntityId, HutDef, TargetId, Vec2 } from '@core/types';
import type { AreaBody } from '@core/combat/area';
import type { CombatWorld } from '@core/combat/world';
import type { EnemyOptions } from '@core/enemies/enemyMovement';
import type { IdAllocator } from '@core/ids';
import { distance } from '@core/math/vec2';
import type { EnemySpawnObject, MissionMap, TriggerZone } from '@core/mission/mapData';
import {
  createTriggers,
  initialSpawns,
  scatterPositions,
  spawnsForTrigger,
  stepTriggers,
  type TriggerState,
} from '@core/mission/spawns';
import { createRng, type Rng } from '@core/rng/rng';
import {
  createHut,
  defaultDoor,
  hutFootprint,
  hutSpawnPoint,
  hutUnitSpec,
  recordHutSpawn,
  resolveHutDef,
  stepHut,
  type HutState,
} from '@core/structures/hut';
import type { CollisionGrid } from '@core/world/collisionGrid';
import { ENEMIES } from '@data/enemies';
import { HUT } from '@data/structures';
import { unitDepth } from '../depths';
import type { Positioned } from '../entities/Positioned';
import { HUT_TEXTURE_PX, StructureTextures } from '../world/structurePlaceholders';
import type { SolidRegistry } from './KegSystem';
import type { StructureRoster } from './EnemyRoster';
import type { System } from './System';

/** What the spawner needs from the goblins (EnemyAiSystem implements it). */
export interface EnemySpawnTarget {
  spawn(enemy: EnemyId, position: Vec2, options?: EnemyOptions): EntityId;
  alert(ids: ReadonlySet<EntityId>): void;
  ids(): readonly EntityId[];
  positionOf(id: EntityId): Readonly<Vec2> | undefined;
}

/** Wizards' feet and the leader, read every frame. */
export interface SpawnerSquad {
  readonly leader: Positioned | null;
  readonly units: readonly { readonly position: Vec2 }[];
}

export interface SpawnerOptions {
  readonly ids: IdAllocator;
  readonly grid: CollisionGrid;
  readonly solids: SolidRegistry;
  /** Seeds the group scatter (the run's seed: same attempt, same layout). */
  readonly scatterSeed: number;
  readonly hut?: HutDef;
}

/** A trigger bark line (conventions §4.3 `bark`), for the bark view. */
export interface TriggerBark {
  readonly text: string;
  /** Bumps per bark, so a view notices a repeated line. */
  readonly count: number;
}

export interface SpawnerDebug {
  readonly huts: readonly {
    readonly id: EntityId;
    readonly phase: string;
    readonly untilSpawnMs: number;
    readonly telling: boolean;
    readonly alive: number;
  }[];
  /** Group → spawned ids (alive or not). */
  readonly groups: Readonly<Record<string, readonly EntityId[]>>;
  readonly firedTriggers: readonly string[];
}

/** Door glow alpha at the start and end of the 500 ms tell (readability §3: tells ramp up). */
const DOOR_GLOW = { fromAlpha: 0.25, toAlpha: 1 } as const;

interface HutView {
  readonly sprite: Phaser.GameObjects.Image;
  readonly glow: Phaser.GameObjects.Image;
  readonly target: TargetId;
}

/**
 * Everything the map spawns (tiled-conventions §4): Goblin Huts (GDD §12) through core's hut
 * timeline, `enemy-spawn` groups (at start, or when their trigger fires), `archer-post` archers
 * holding their post, and `trigger` zones the leader walks into (`activate-group`, `alert-group`,
 * `bark`). Huts are CombatWorld units and solid footprints; their sprites swap to rubble on death
 * (the solid stays, GDD Q16). Frame order: after the enemy step, before targeting.
 */
export class SpawnerSystem implements System, StructureRoster {
  private huts: HutState[] = [];
  private readonly hutViews = new Map<EntityId, HutView>();
  private readonly groups = new Map<string, EntityId[]>();
  private triggers: TriggerState;
  /** Trigger names that fired this run, in order (debug). */
  private readonly fired: string[] = [];
  private readonly rng: Rng;
  private bark: TriggerBark | null = null;
  private readonly hutDef: HutDef;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: MissionMap,
    private readonly world: CombatWorld,
    private readonly enemies: EnemySpawnTarget,
    private readonly squad: SpawnerSquad,
    private readonly options: SpawnerOptions,
  ) {
    this.hutDef = options.hut ?? HUT;
    this.rng = createRng(options.scatterSeed);
    this.triggers = createTriggers(map.triggers);
    for (const hut of map.huts) this.addHut(hut.position, hut.overrides, hut.door, hut.target);
    for (const spawn of initialSpawns(map)) this.spawnGroup(spawn);
    for (const post of map.archerPosts) {
      const id = enemies.spawn('goblin-archer', post.position, {
        post: { position: post.position, holdRadiusPx: post.holdRadiusPx },
      });
      this.addToGroup(post.group, id);
    }
  }

  /** The last trigger bark, or null. */
  get lastBark(): TriggerBark | null {
    return this.bark;
  }

  /** Huts still standing, in map order (rune order: ascending runeIndex). */
  get standingHuts(): readonly { readonly id: EntityId; readonly position: Vec2 }[] {
    return this.huts.filter((hut) => hut.phase !== 'destroyed');
  }

  get debugState(): SpawnerDebug {
    return {
      huts: this.huts.map((hut) => ({
        id: hut.id,
        phase: hut.phase,
        untilSpawnMs: hut.untilSpawnMs,
        telling: hut.telling,
        alive: hut.spawned.length,
      })),
      groups: Object.fromEntries(this.groups),
      firedTriggers: [...this.fired],
    };
  }

  structureIds(): readonly EntityId[] {
    return this.huts.filter((hut) => this.world.isAlive(hut.id)).map((hut) => hut.id);
  }

  areaBodies(): AreaBody[] {
    return this.huts
      .filter((hut) => this.world.isAlive(hut.id))
      .map((hut) => ({
        id: hut.id,
        position: hut.position,
        bodyRadiusPx: hut.def.bodyRadiusPx,
        alive: true,
        footprintPx: hut.def.footprintPx,
      }));
  }

  targetOf(id: EntityId): TargetId | undefined {
    return this.hutViews.get(id)?.target;
  }

  positionOf(id: EntityId): Readonly<Vec2> | undefined {
    return this.huts.find((hut) => hut.id === id)?.position;
  }

  spriteOf(id: EntityId): Phaser.GameObjects.Image | undefined {
    // Only a standing hut flashes and shows a bar; rubble is scenery.
    return this.world.isAlive(id) ? this.hutViews.get(id)?.sprite : undefined;
  }

  update(dt: number): void {
    const leader = this.squad.leader?.position ?? null;
    this.huts = this.huts.map((hut) => this.stepOneHut(hut, leader, dt));
    const step = stepTriggers(this.triggers, leader);
    this.triggers = step.state;
    for (const trigger of step.fired) this.fire(trigger);
  }

  destroy(): void {
    for (const view of this.hutViews.values()) {
      view.sprite.destroy();
      view.glow.destroy();
    }
    this.hutViews.clear();
    this.huts = [];
    this.groups.clear();
    this.fired.length = 0;
    this.bark = null;
  }

  private addHut(
    position: Vec2,
    overrides: Partial<HutDef>,
    door: Vec2 | null,
    target: TargetId,
  ): void {
    const def = resolveHutDef(this.hutDef, overrides);
    const id = this.options.ids.next();
    // Just outside the south wall for the body it spawns, so the glow is where the grunt appears.
    const hutDoor = door ?? defaultDoor(position, def, ENEMIES[def.spawnEnemy].bodyRadiusPx);
    this.huts.push(createHut(id, position, def, hutDoor));
    this.world.add(hutUnitSpec(id, def));
    this.options.solids.addSolid(id, hutFootprint(position, def), true);

    // Sorted by its south edge: a unit standing north of the hut is behind it.
    const southEdge = position.y + def.footprintPx / 2;
    const sprite = this.scene.add
      .image(position.x, position.y, StructureTextures.Hut)
      .setDisplaySize(def.footprintPx, def.footprintPx)
      .setDepth(unitDepth(southEdge));
    const scale = def.footprintPx / HUT_TEXTURE_PX;
    // The tell sits on the door point (map `hut-spawn` or core's default), bottom-centred where the
    // grunt's feet land, so the glow is exactly where it appears (review M7-T10 m1).
    const glow = this.scene.add
      .image(hutDoor.x, hutDoor.y, StructureTextures.HutDoorGlow)
      .setOrigin(0.5, 1)
      .setScale(scale)
      // Half a pixel further south than whichever is lower: in front of its hut and the ground.
      .setDepth(unitDepth(Math.max(southEdge, hutDoor.y) + 0.5))
      .setVisible(false);
    this.hutViews.set(id, { sprite, glow, target });
  }

  private stepOneHut(hut: HutState, leader: Vec2 | null, dt: number): HutState {
    const step = stepHut(hut, { leader, dtMs: dt, isAlive: (id) => this.world.isAlive(id) });
    let next = step.hut;
    if (step.spawn) {
      const radius = ENEMIES[step.spawn.enemy].bodyRadiusPx;
      const at = hutSpawnPoint(this.options.grid, step.spawn.door, radius, (p) =>
        this.isFree(p, radius),
      );
      if (at) next = recordHutSpawn(next, this.enemies.spawn(step.spawn.enemy, at));
    }
    this.syncHut(next);
    return next;
  }

  private syncHut(hut: HutState): void {
    const view = this.hutViews.get(hut.id);
    if (!view) return;
    if (hut.phase === 'destroyed') {
      view.sprite.setTexture(StructureTextures.HutRubble);
      view.glow.setVisible(false);
      return;
    }
    view.glow.setVisible(hut.telling);
    if (hut.telling) {
      const progress = 1 - Math.max(0, hut.untilSpawnMs) / hut.def.spawnTellMs;
      const { fromAlpha, toAlpha } = DOOR_GLOW;
      view.glow.setAlpha(fromAlpha + (toAlpha - fromAlpha) * Math.min(1, progress));
    }
  }

  /** No living goblin or wizard body overlaps a body of `radiusPx` at `p`. */
  private isFree(p: Vec2, radiusPx: number): boolean {
    for (const id of this.enemies.ids()) {
      const at = this.enemies.positionOf(id);
      if (at && distance(at, p) < radiusPx * 2) return false;
    }
    return this.squad.units.every((unit) => distance(unit.position, p) >= radiusPx * 2);
  }

  /** `count` goblins scattered over the spawn's disc, pushed off solids (core spawns.ts). */
  private spawnGroup(spawn: EnemySpawnObject): void {
    const placement = { grid: this.options.grid, bodyRadiusPx: ENEMIES[spawn.enemy].bodyRadiusPx };
    for (const at of scatterPositions(
      spawn.position,
      spawn.count,
      spawn.radiusPx,
      this.rng,
      placement,
    )) {
      this.addToGroup(spawn.group, this.enemies.spawn(spawn.enemy, at));
    }
  }

  private addToGroup(group: string, id: EntityId): void {
    const list = this.groups.get(group);
    if (list) list.push(id);
    else this.groups.set(group, [id]);
  }

  private fire(trigger: TriggerZone): void {
    this.fired.push(trigger.name);
    const { event } = trigger;
    switch (event.kind) {
      case 'activate-group':
        for (const spawn of spawnsForTrigger(this.map, trigger.name)) this.spawnGroup(spawn);
        break;
      case 'alert-group':
        this.enemies.alert(new Set(this.groups.get(event.group) ?? []));
        break;
      case 'bark':
        this.bark = { text: event.text, count: (this.bark?.count ?? 0) + 1 };
        break;
    }
  }
}
