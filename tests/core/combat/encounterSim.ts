/**
 * Headless M4 encounter (D2, D4): the dev squad against DEV_ENCOUNTER with zero input, driving the
 * same core step functions in the scene's frame order (M4.md "Frame order"):
 *   squad (leader holds still) → enemy brains and bodies → wizard targeting and fire, enemy attacks
 *   → projectiles and hits → Burning ticks → the frame's deaths as one ascending-id batch (as the
 *   scene's CombatSystem flushes them) → succession.
 * Every frame it checks the D4 invariants and counts violations instead of throwing, so a test can
 * report them all.
 */
import type { DevEncounterSpawn, EnemyId, EntityId, Rect, Vec2 } from '@core/types';
import type { WizardView } from '@core/ai/goblin';
import { createAutoAttack, stepAutoAttack, type AutoAttackState } from '@core/combat/autoAttack';
import { applyHit, type HitResult } from '@core/combat/damage';
import { resolveFrameDeaths, type DeathRecord } from '@core/combat/death';
import { createProjectile, stepProjectile, type Projectile } from '@core/combat/projectile';
import { applyStatus, stepStatuses } from '@core/combat/status';
import { CombatWorld } from '@core/combat/world';
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
import type { TargetCandidate } from '@core/targeting/selectTarget';
import { CLASSES } from '@data/classes';
import { COMBAT, GIBS } from '@data/combat';
import { DEV_ARENA, DEV_ENCOUNTER, DEV_SQUAD } from '@data/devArena';
import { ENEMIES } from '@data/enemies';
import { MOVEMENT } from '@data/movement';
import { STATUSES } from '@data/statuses';
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
  /** Leader deaths that promoted a survivor (GDD §2). */
  readonly leaderChanges: number;
  /** D4: every entry is a broken invariant (dead unit moved, acted, ticked, was hit or damaged). */
  readonly violations: readonly string[];
}

interface Wizard {
  readonly id: EntityId;
  readonly attack: (typeof CLASSES)[keyof typeof CLASSES]['attack'];
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
    return { id, attack: CLASSES[cls].attack, auto: createAutoAttack() };
  });
  let squad: SquadState = createSquad(
    { ids: wizards.map((w) => w.id), leaderPosition: spawn, behind: { x: 0, y: 1 } },
    TRAIL,
  );

  // Enemies, offsets jittered per seed.
  let enemies: EnemyState[] = (options.encounter ?? DEV_ENCOUNTER).map((s) => {
    const id = ids.next();
    const def = ENEMIES[s.enemy];
    world.add({ id, team: 'enemy', maxHp: def.maxHp, bodyRadiusPx: def.bodyRadiusPx });
    const jitter = {
      x: (rng.next() * 2 - 1) * options.jitterPx,
      y: (rng.next() * 2 - 1) * options.jitterPx,
    };
    return createEnemy(id, def, add(add(spawn, s.offset), jitter));
  });
  const group = new Set(enemies.filter((e) => D2_GROUP.includes(e.enemy)).map((e) => e.id));

  let projectiles: Projectile[] = [];
  const kills: DeathRecord[] = [];
  const violations: string[] = [];
  const dead = new Set<EntityId>();
  let burningApplied = 0;
  let burningExpired = 0;
  let burningTicks = 0;
  let shotsFired = 0;
  let meleeSwings = 0;
  let leaderChanges = 0;
  /** Dead enemies, kept to check every frame that they stay frozen and silent (D4). */
  let corpses: EnemyState[] = [];
  let clearedAtMs: number | null = null;
  let t = 0;

  const flag = (what: string) => violations.push(`t=${t.toFixed(1)}: ${what}`);
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
      if (!action.landed) return;
      const result = applyHit(world, action.target, { ...attack, sourceId: action.enemyId }, GIBS);
      checkHit(result, `melee from ${String(action.enemyId)}`);
      if (result.killed) records.push(result.death);
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

  while (t < options.maxMs) {
    t += dtMs;

    // 1. Squad: zero input, the leader holds its position.
    const leader = squad.members[0];
    if (!leader) break;
    const beforeSquad = new Map(squad.members.map((m) => [m.id, m.position]));
    squad = stepSquad(squad, { leaderPosition: leader.position, walkable, dtMs }, TRAIL, MOVEMENT);
    for (const m of squad.members) {
      if (dead.has(m.id)) flag(`dead wizard ${String(m.id)} still in the squad`);
      if (!beforeSquad.has(m.id)) flag(`unknown wizard ${String(m.id)} appeared`);
    }

    // 2. Enemy brains and bodies.
    const enemyStep = stepEnemies(enemies, {
      defs: ENEMIES,
      wizards: wizardViews(),
      bounds: arena,
      isAlive: (id) => world.isAlive(id),
      dtMs,
    });
    enemies = [...enemyStep.enemies];
    // Dead enemies stepped alongside must neither move nor act (D4).
    const corpseStep = stepEnemies(corpses, {
      defs: ENEMIES,
      wizards: wizardViews(),
      bounds: arena,
      isAlive: (id) => world.isAlive(id),
      dtMs,
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
      );
      if (s.hit === null) {
        if (!s.expired) flying.push(s.projectile);
        continue;
      }
      const result = applyHit(world, s.hit, { ...p.source, sourceId: p.ownerId }, GIBS);
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
    leaderChanges,
    violations,
  };
}
