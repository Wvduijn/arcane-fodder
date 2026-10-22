/** Review M7-T7 m1: the straight-line answer is cached per enemy between flow-field ticks. */
import { describe, expect, it } from 'vitest';
import type { EntityId, Vec2 } from '@core/types';
import type { WizardView } from '@core/ai/goblin';
import { createEnemy, stepEnemies, type EnemyStepInput } from '@core/enemies/enemyMovement';
import { FlowField } from '@core/world/flowField';
import { ENEMIES } from '@data/enemies';
import { MOVEMENT } from '@data/movement';
import { gridWhere } from './fixtures';

const v = (x: number, y: number): Vec2 => ({ x, y });
const id = (n: number) => n as EntityId;
const GRUNT = ENEMIES['goblin-grunt'];
const wiz = (n: number, p: Vec2): WizardView => ({
  id: id(n),
  position: p,
  bodyRadiusPx: MOVEMENT.wizardBodyRadiusPx,
  alive: true,
});

describe('navigation cache', () => {
  // Wall at column 20 for rows 0..22.
  const grid = gridWhere(40, 30, (tx, ty) => tx === 20 && ty <= 22);
  const field = new FlowField(grid);
  const base = (wizards: WizardView[], refresh: boolean): EnemyStepInput => ({
    defs: ENEMIES,
    wizards,
    bounds: grid.bounds,
    isAlive: () => true,
    dtMs: 1000 / 60,
    collision: grid,
    navigation: field,
    refreshNavigation: refresh,
  });

  it('asks once, then reuses the answer until the clock ticks', () => {
    const hidden = [wiz(1, v(400, 100))];
    field.build(hidden.map((w) => w.position));
    let enemies = [createEnemy(id(10), GRUNT, v(200, 100), { aggro: 'always' })];
    // Frame 1 aggroes (no move yet); frame 2 walks and asks.
    for (let i = 0; i < 2; i++) enemies = [...stepEnemies(enemies, base(hidden, false)).enemies];
    expect(enemies[0]?.nav).toEqual({ goal: 1, straightClear: false });
    // The wall is gone from the answer's point of view only after a refresh: move the wizard into
    // plain sight; without a tick the cached "blocked" stays.
    const seen = [wiz(1, v(260, 100))];
    enemies = [...stepEnemies(enemies, base(seen, false)).enemies];
    expect(enemies[0]?.nav?.straightClear).toBe(false);
    enemies = [...stepEnemies(enemies, base(seen, true)).enemies];
    expect(enemies[0]?.nav?.straightClear).toBe(true);
  });

  it('a new target is asked at once, tick or not', () => {
    field.build([v(400, 100)]);
    let enemies = [createEnemy(id(10), GRUNT, v(200, 100), { aggro: 'always' })];
    for (let i = 0; i < 2; i++) {
      enemies = [...stepEnemies(enemies, base([wiz(1, v(400, 100))], false)).enemies];
    }
    expect(enemies[0]?.nav?.goal).toBe(1);
    // Wizard 1 is gone; the brain retargets wizard 2 in plain sight.
    for (let i = 0; i < 2; i++) {
      enemies = [...stepEnemies(enemies, base([wiz(2, v(250, 140))], false)).enemies];
    }
    expect(enemies[0]?.nav).toEqual({ goal: 2, straightClear: true });
  });
});
