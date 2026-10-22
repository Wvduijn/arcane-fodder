/**
 * Headless M4 encounter (D2, D4): the dev squad against DEV_ENCOUNTER with zero input, driving the
 * same core step functions in the scene's frame order (M4.md "Frame order"):
 *   squad (leader holds still) → enemy brains and bodies → wizard targeting and fire, enemy attacks
 *   → projectiles and hits → Burning ticks → the frame's deaths as one ascending-id batch (as the
 *   scene's CombatSystem flushes them) → succession.
 * M5: every hit goes through reactions.ts (`resolveUnitHit`), so sparks on burning goblins Combust
 * (D4), and the dev kegs stand in the arena to prove autos, arrows and melee never light them.
 * `reactions: false` runs the M4 rules (plain `applyHit`, no Combust) for the M4 regression tests:
 * with Combust the pack dies before any grunt reaches the squad, so M4's melee scenarios need it.
 * Every frame it checks the D4 invariants and counts violations instead of throwing, so a test can
 * report them all.
 * M6: an optional Convergence meter is fed every landed hit (with its credit) and every death, as
 * ConvergenceSystem feeds it from `unit:damaged` / `unit:died`, for the time-to-full log (GDD §16).
 */
import type {
  CombustDef,
  DevEncounterSpawn,
  EnemyId,
  EntityId,
  MageClassId,
  ProjectileAttackDef,
  Rect,
  Vec2,
} from '@core/types';
import type { WizardView } from '@core/ai/goblin';
import { createAutoAttack, stepAutoAttack, type AutoAttackState } from '@core/combat/autoAttack';
import type { UnitPosition } from '@core/combat/area';
import { applyHit, type Hit, type HitResult } from '@core/combat/damage';
import { resolveFrameDeaths, type DeathRecord } from '@core/combat/death';
import { createProjectile, stepProjectile, type Projectile } from '@core/combat/projectile';
import { resolveUnitHit, type ReactionContext, type ReactionResults } from '@core/combat/reactions';
import { applyStatus, stepStatuses } from '@core/combat/status';
import { CombatWorld } from '@core/combat/world';
import type { ConvergenceMeter } from '@core/convergence/meter';
import {
  createEnemy,
  knockEnemy,
  stepEnemies,
  type EnemyAction,
  type EnemyState,
} from '@core/enemies/enemyMovement';
import { createIdAllocator } from '@core/ids';
import { insetRect } from '@core/math/movement';
import { add } from '@core/math/vec2';
import { createRng } from '@core/rng/rng';
import { stepSquad } from '@core/squad/follow';
import { createSquad, killSquadMembers, type SquadState } from '@core/squad/squad';
import { createKeg, kegBodies, triggerKeg, type KegState } from '@core/structures/keg';
import type { TargetCandidate } from '@core/targeting/selectTarget';
import type { CollisionGrid } from '@core/world/collisionGrid';
import { FlowFieldClock, type FlowField } from '@core/world/flowField';
import { CLASSES } from '@data/classes';
import { COMBAT, GIBS } from '@data/combat';
import { DEV_ARENA, DEV_ENCOUNTER, DEV_KEGS, DEV_SQUAD } from '@data/devArena';
import { ENEMIES } from '@data/enemies';
import { MOVEMENT } from '@data/movement';
import { REACTIONS } from '@data/reactions';
import { STATUSES } from '@data/statuses';
import { KEG } from '@data/structures';
import { TRAIL } from '@data/trail';

export interface EncounterOptions {
  readonly dtMs: number;
  /** Seeds a small jitter of each spawn offset, so seeds give different fights. */
  readonly seed: number;
  readonly jitterPx: number;
  readonly maxMs: number;
  readonly arena?: Rect;
  /** Defaults to DEV_ENCOUNTER. */
  readonly encounter?: readonly DevEncounterSpawn[];
  /** Per-recruit maxHp overrides, leader first (forces losses to exercise succession). */
  readonly wizardMaxHp?: readonly (number | undefined)[];
  /** Spawned but not part of the D2 group (DEV_KEG_PACK): must stay out of the fight. */
  readonly bystanders?: readonly DevEncounterSpawn[];
  /** Default true (M5). False: M4 rules, hits through `applyHit`, no reactions. */
  readonly reactions?: boolean;
  /** Balance sweeps only: replaces REACTIONS.combust / a class's auto-attack in this run. */
  readonly combust?: CombustDef;
  readonly attacks?: Partial<Record<MageClassId, ProjectileAttackDef>>;
  /** M6: fed every landed hit and death of the fight. */
  readonly meter?: ConvergenceMeter;
  /** M7: tile collision for every step (squad, enemies, autos, projectiles). */
  readonly collision?: CollisionGrid;
  /** M7: enemy navigation (with `collision`), rebuilt on its clock toward the squad. */
  readonly navigation?: { readonly field: FlowField; readonly rebuildMs: number };
}

export interface EncounterResult {
  /** When every enemy of the D2 group was dead, or null if that never happened. */
  readonly clearedAtMs: number | null;
  readonly elapsedMs: number;
  readonly wizardsAlive: number;
  readonly wizardsLost: number;
  readonly enemiesAlive: {
    readonly id: EntityId;
    readonly enemy: EnemyId;
    readonly state: string;
  }[];
  readonly kills: readonly DeathRecord[];
  readonly burningApplied: number;
  readonly burningExpired: number;
  readonly burningTicks: number;
  readonly shotsFired: number;
  readonly meleeSwings: number;
  /** Swings whose target was still in range at the end of the wind-up and took the hit. */
  readonly swingsLanded: number;
  /** Time of the first grunt swing, or null. */
  readonly firstSwingMs: number | null;
  /** Time of the first swing that landed on a wizard, or null (GDD §3 no-input targets). */
  readonly firstLandedSwingMs: number | null;
  /** Leader deaths that promoted a survivor (GDD §2). */
  readonly leaderChanges: number;
  /** Combust reactions (M5 D4). */
  readonly combusts: number;
  /** Kegs lit during the fight (none expected: only spells and reactions light them). */
  readonly kegsLit: number;
  /** D4: every entry is a broken invariant (dead unit moved, acted, ticked, was hit or damaged). */
  readonly violations: readonly string[];
  /** M6: when `options.meter` reached full, or null. */
  readonly meterFullAtMs: number | null;
}

interface Wizard {
  readonly id: EntityId;
  readonly attack: ProjectileAttackDef;
  auto: AutoAttackState;
}

/** The D2 group: the enemies a zero-input squad must clear (M4 Q1: the grunts). */
export const D2_GROUP: readonly EnemyId[] = ['goblin-grunt'];

export function runEncounter(options: EncounterOptions): EncounterResult {
  const { dtMs } = options;
  const arena = options.arena ?? DEV_ARENA;
  const rng = createRng(options.seed);
  const ids = createIdAllocator();
  const world = new CombatWorld();
  const r = MOVEMENT.wizardBodyRadiusPx;
  const walkable = insetRect(arena, { top: r, right: r, bottom: r, left: r });
  const spawn: Vec2 = { x: arena.x + arena.width / 2, y: arena.y + arena.height / 2 };

  // Squad: P,S,P,S leader first, ids 1..4.
  const wizards: Wizard[] = DEV_SQUAD.classes.map((cls, index) => {
    const id = ids.next();
    const maxHp = options.wizardMaxHp?.[index] ?? CLASSES[cls].maxHp;
    world.add({ id, team: 'squad', maxHp, bodyRadiusPx: r });
    return { id, attack: options.attacks?.[cls] ?? CLASSES[cls].attack, auto: createAutoAttack() };
  });
  let squad: SquadState = createSquad(
    { ids: wizards.map((w) => w.id), leaderPosition: spawn, behind: { x: 0, y: 1 } },
    TRAIL,
  );

  // Enemies, offsets jittered per seed.
  const fighting = options.encounter ?? DEV_ENCOUNTER;
  const spawns = [...fighting, ...(options.bystanders ?? [])];
  let enemies: EnemyState[] = spawns.map((s) => {
    const id = ids.next();
    const def = ENEMIES[s.enemy];
    world.add({ id, team: 'enemy', maxHp: def.maxHp, bodyRadiusPx: def.bodyRadiusPx });
    const jitter = {
      x: (rng.next() * 2 - 1) * options.jitterPx,
      y: (rng.next() * 2 - 1) * options.jitterPx,
    };
    return createEnemy(id, def, add(add(spawn, s.offset), jitter));
  });
  const group = new Set(
    enemies
      .slice(0, fighting.length)
      .filter((e) => D2_GROUP.includes(e.enemy))
      .map((e) => e.id),
  );
  const withReactions = options.reactions ?? true;

  let projectiles: Projectile[] = [];
  const kills: DeathRecord[] = [];
  const violations: string[] = [];
  const dead = new Set<EntityId>();
  let burningApplied = 0;
  let burningExpired = 0;
  let burningTicks = 0;
  let shotsFired = 0;
  let meleeSwings = 0;
  let swingsLanded = 0;
  let firstSwingMs: number | null = null;
  let firstLandedSwingMs: number | null = null;
  let leaderChanges = 0;
  let combusts = 0;
  let kegs: KegState[] = DEV_KEGS.map((k) => createKeg(ids.next(), add(spawn, k.offset)));
  /** Dead enemies, kept to check every frame that they stay frozen and silent (D4). */
  let corpses: EnemyState[] = [];
  let clearedAtMs: number | null = null;
  let meterFullAtMs: number | null = null;
  let t = 0;

  const flag = (what: string) => violations.push(`t=${t.toFixed(1)}: ${what}`);
  /** `unit:damaged` for the meter: a landed hit and its credit. */
  const charge = (result: HitResult, source: EntityId | null) => {
    const team = world.get(result.target)?.team;
    if (!options.meter || !result.landed || team === undefined) return;
    if (options.meter.onDamaged({ id: result.target, team, amount: result.dealt, source })) {
      meterFullAtMs ??= t;
    }
  };
  const checkHit = (result: HitResult, what: string) => {
    if (dead.has(result.target) && (result.landed || result.dealt > 0)) {
      flag(`${what} landed on dead unit ${String(result.target)}`);
    }
  };
  const wizardViews = (): WizardView[] =>
    squad.members.map((m) => ({
      id: m.id,
      position: m.position,
      bodyRadiusPx: r,
      alive: world.isAlive(m.id),
    }));
  const handleDeaths = (records: DeathRecord[]) => {
    const resolved = resolveFrameDeaths(records);
    if (resolved.length === 0) return;
    for (const d of resolved) {
      dead.add(d.id);
      kills.push(d);
      if (options.meter?.onDied(d)) meterFullAtMs ??= t;
    }
    const wizardIds = resolved.filter((d) => d.team === 'squad').map((d) => d.id);
    if (wizardIds.length > 0) {
      const before = squad.members.map((m) => m.id);
      const result = killSquadMembers(squad, wizardIds, TRAIL);
      squad = result.state;
      // Succession (GDD §2): the lowest surviving index leads.
      const expected = before.find((id) => !wizardIds.includes(id)) ?? null;
      if (squad.members[0]?.id !== (expected ?? undefined)) flag('wrong successor');
      if (result.leaderChanged) {
        leaderChanges++;
        if (result.newLeader !== expected) flag('leader-changed names the wrong wizard');
      } else if (before[0] !== undefined && wizardIds.includes(before[0]) && expected !== null) {
        flag('leader died without a leader change');
      }
    }
    const enemyIds = new Set(resolved.filter((d) => d.team === 'enemy').map((d) => d.id));
    corpses = [...corpses, ...enemies.filter((e) => enemyIds.has(e.id))];
    enemies = enemies.filter((e) => !enemyIds.has(e.id));
  };

  const reactionCtx = (): ReactionContext => ({
    world,
    statuses: STATUSES,
    gibs: GIBS,
    combust: options.combust ?? REACTIONS.combust,
    kaboom: REACTIONS.kaboom,
    units: [
      ...squad.members.map((m): UnitPosition => ({ id: m.id, position: m.position })),
      ...enemies.map((e): UnitPosition => ({ id: e.id, position: e.position })),
    ],
    kegs: kegBodies(kegs, KEG),
  });
  /** Follow-ups of a hit: Combust blasts (statuses, deaths) and keg lights. */
  const handleReactions = (r: ReactionResults, records: DeathRecord[]): void => {
    for (const reaction of r.reactions) {
      if (reaction.reaction === 'combust') combusts++;
      for (const h of reaction.area.hits) {
        checkHit(h, `${reaction.reaction} blast`);
        charge(h, reaction.sourceId);
      }
      for (const st of reaction.area.statuses) if (st.result === 'applied') burningApplied++;
    }
    records.push(...r.reactions.flatMap((x) => x.area.deaths));
    kegs = kegs.map((k) => (r.kegs.includes(k.id) ? triggerKeg(k, REACTIONS.kaboom).keg : k));
  };

  /** One single-target hit: M5 through reactions (follow-ups handled here), M4 plain. */
  const hitUnit = (target: EntityId, hit: Hit, records: DeathRecord[]): HitResult => {
    if (!withReactions) {
      const plain = applyHit(world, target, hit, GIBS);
      charge(plain, hit.sourceId);
      return plain;
    }
    const r = resolveUnitHit(target, hit, reactionCtx());
    charge(r.hit, hit.sourceId);
    handleReactions(r, records);
    return r.hit;
  };

  const resolveEnemyAction = (action: EnemyAction, records: DeathRecord[]): void => {
    if (dead.has(action.enemyId) || !world.isAlive(action.enemyId)) {
      flag(`dead enemy ${String(action.enemyId)} attacked`);
      return;
    }
    const kind = enemies.find((e) => e.id === action.enemyId)?.enemy;
    if (!kind) return;
    const attack = ENEMIES[kind].attack;
    if (action.kind === 'melee') {
      meleeSwings++;
      firstSwingMs ??= t;
      if (!action.landed) return;
      const r = hitUnit(action.target, { ...attack, sourceId: action.enemyId }, records);
      checkHit(r, `melee from ${String(action.enemyId)}`);
      if (r.landed) {
        swingsLanded++;
        firstLandedSwingMs ??= t;
      }
      if (r.killed) records.push(r.death);
      return;
    }
    if (attack.kind !== 'projectile') return;
    shotsFired++;
    projectiles.push(
      createProjectile({
        id: ids.next(),
        ownerId: action.enemyId,
        team: 'enemy',
        from: action.from,
        aimAt: action.aimAt,
        attack,
        rangeFactor: COMBAT.projectileRangeFactor,
      }),
    );
  };

  const grid = options.collision;
  const nav = options.navigation;
  const navClock = nav ? new FlowFieldClock(nav.rebuildMs) : null;
  while (t < options.maxMs) {
    t += dtMs;

    // 1. Squad: zero input, the leader holds its position.
    const leader = squad.members[0];
    if (!leader) break;
    const beforeSquad = new Map(squad.members.map((m) => [m.id, m.position]));
    squad = stepSquad(
      squad,
      {
        leaderPosition: leader.position,
        walkable,
        dtMs,
        ...(grid ? { collision: { grid, bodyRadiusPx: r } } : {}),
      },
      TRAIL,
      MOVEMENT,
    );
    for (const m of squad.members) {
      if (dead.has(m.id)) flag(`dead wizard ${String(m.id)} still in the squad`);
      if (!beforeSquad.has(m.id)) flag(`unknown wizard ${String(m.id)} appeared`);
    }

    // 2. Enemy brains and bodies.
    const refresh = navClock?.step(dtMs) ?? false;
    if (nav && refresh) nav.field.build(squad.members.map((m) => m.position));
    const world7 = {
      ...(grid ? { collision: grid } : {}),
      ...(grid && nav ? { navigation: nav.field, refreshNavigation: refresh } : {}),
    };
    const enemyStep = stepEnemies(enemies, {
      defs: ENEMIES,
      wizards: wizardViews(),
      bounds: arena,
      isAlive: (id) => world.isAlive(id),
      dtMs,
      ...world7,
    });
    enemies = [...enemyStep.enemies];
    // Dead enemies stepped alongside must neither move nor act (D4).
    const corpseStep = stepEnemies(corpses, {
      defs: ENEMIES,
      wizards: wizardViews(),
      bounds: arena,
      isAlive: (id) => world.isAlive(id),
      dtMs,
      ...world7,
    });
    corpseStep.enemies.forEach((e, i) => {
      const before = corpses[i];
      if (before && (e.position.x !== before.position.x || e.position.y !== before.position.y)) {
        flag(`dead enemy ${String(e.id)} moved`);
      }
    });
    if (corpseStep.actions.length > 0) flag('a dead enemy attacked');
    corpses = [...corpseStep.enemies];

    // 3. Wizard targeting and fire, then enemy attacks. Ascending id within each.
    const records: DeathRecord[] = [];
    const candidates: TargetCandidate[] = enemies.map((e) => ({
      id: e.id,
      position: e.position,
      kind: 'unit',
      alive: world.isAlive(e.id),
    }));
    const positions = new Map(squad.members.map((m) => [m.id, m.position]));
    for (const w of [...wizards].sort((a, b) => a.id - b.id)) {
      const position = positions.get(w.id);
      if (!position || !world.isAlive(w.id)) continue;
      const s = stepAutoAttack(w.auto, {
        position,
        attack: w.attack,
        retargetMs: COMBAT.retargetMs,
        candidates,
        dtMs,
        ...(grid ? { collision: grid } : {}),
      });
      w.auto = s.state;
      if (!s.fire) continue;
      if (dead.has(s.fire.target))
        flag(`wizard ${String(w.id)} fired at dead ${String(s.fire.target)}`);
      shotsFired++;
      projectiles.push(
        createProjectile({
          id: ids.next(),
          ownerId: w.id,
          team: 'squad',
          from: position,
          aimAt: s.fire.aimAt,
          attack: w.attack,
          rangeFactor: COMBAT.projectileRangeFactor,
        }),
      );
    }
    for (const action of enemyStep.actions) resolveEnemyAction(action, records);

    // 4. Projectiles, ascending id.
    const bodies = [
      ...squad.members.map((m) => ({
        id: m.id,
        team: 'squad' as const,
        position: m.position,
        bodyRadiusPx: r,
        alive: world.isAlive(m.id),
      })),
      ...enemies.map((e) => ({
        id: e.id,
        team: 'enemy' as const,
        position: e.position,
        bodyRadiusPx: ENEMIES[e.enemy].bodyRadiusPx,
        alive: world.isAlive(e.id),
      })),
    ];
    const flying: Projectile[] = [];
    for (const p of [...projectiles].sort((a, b) => a.id - b.id)) {
      const s = stepProjectile(
        p,
        dtMs,
        bodies.map((b) => ({ ...b, alive: world.isAlive(b.id) })),
        grid,
      );
      if (s.hit === null) {
        if (!s.expired && !s.blocked) flying.push(s.projectile);
        continue;
      }
      const result = hitUnit(s.hit, { ...p.source, sourceId: p.ownerId }, records);
      checkHit(result, `projectile ${String(p.id)}`);
      if (result.killed) records.push(result.death);
      if (!result.landed || result.killed) continue;
      if (
        p.source.applies &&
        applyStatus(world, s.hit, STATUSES[p.source.applies], p.ownerId) === 'applied'
      ) {
        burningApplied++;
      }
      const target = s.hit;
      enemies = enemies.map((e) =>
        e.id === target
          ? knockEnemy(e, ENEMIES[e.enemy], p.direction, p.source.knockbackPx, COMBAT.knockbackMs)
          : e,
      );
    }
    projectiles = flying;

    // 5. Burning. Its deaths join the frame's batch.
    const statusStep = stepStatuses(world, STATUSES, dtMs);
    for (const tick of statusStep.ticks) {
      if (dead.has(tick.target)) flag(`status ticked on dead ${String(tick.target)}`);
      const result = applyHit(world, tick.target, tick.hit, GIBS);
      checkHit(result, 'burning tick');
      charge(result, tick.hit.sourceId);
      if (result.landed) burningTicks++;
      if (result.killed) records.push(result.death);
    }
    // status:expired is never reported for a unit that died (events.ts contract).
    for (const e of statusStep.expired) {
      if (world.isAlive(e.id)) burningExpired++;
      else flag(`expiry reported for dead ${String(e.id)}`);
    }

    // 6. The frame's deaths, one ascending-id batch.
    handleDeaths(records);

    // Dead units keep no statuses and no HP.
    for (const id of dead) {
      const unit = world.get(id);
      if (unit && (unit.alive || unit.hp !== 0 || unit.statuses.size > 0))
        flag(`dead unit ${String(id)} changed`);
    }

    if ([...group].every((id) => !world.isAlive(id))) {
      clearedAtMs = t;
      break;
    }
    if (squad.members.length === 0) break;
  }

  return {
    clearedAtMs,
    elapsedMs: t,
    wizardsAlive: squad.members.length,
    wizardsLost: wizards.length - squad.members.length,
    enemiesAlive: enemies.map((e) => ({
      id: e.id,
      enemy: e.enemy,
      state: e.brain.machine.current,
    })),
    kills,
    burningApplied,
    burningExpired,
    burningTicks,
    shotsFired,
    meleeSwings,
    swingsLanded,
    firstSwingMs,
    firstLandedSwingMs,
    leaderChanges,
    combusts,
    kegsLit: kegs.filter((k) => k.phase !== 'idle').length,
    violations,
    meterFullAtMs,
  };
}
