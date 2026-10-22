/**
 * Review M7-T8 m1: an open collision grid gives exactly the open-ground result for every step that
 * takes one, not only the squad (collisionSteps.test.ts). Enemies (with navigation), autos,
 * projectiles, Fireball, Kaboom knockback, the Convergence and the volunteer sprint all run here
 * with and without a grid covering the dev arena, and must match field for field.
 */
import { describe, expect, it } from 'vitest';
import { CollisionGrid } from '@core/world/collisionGrid';
import { FlowField } from '@core/world/flowField';
import { DEV_ARENA } from '@data/devArena';
import { CONVERGENCE } from '@data/convergences';
import { NAVIGATION } from '@data/navigation';
import { runEncounter } from '../combat/encounterSim';
import { M6Sim } from '../convergence/convergenceSim';

const TILE = 16;
const openArena = () => CollisionGrid.open(DEV_ARENA.width / TILE, DEV_ARENA.height / TILE, TILE);
const PACK = { x: 0, y: -194 };

describe('open grid = open ground (M7)', () => {
  it.each([30, 60, 144])(
    'the M4–M6 encounter: enemies, navigation, autos, projectiles (%i fps)',
    (fps) => {
      const options = { dtMs: 1000 / fps, seed: 3, jitterPx: 4, maxMs: 12_000 };
      const plain = runEncounter(options);
      const grid = openArena();
      const withGrid = runEncounter({
        ...options,
        collision: grid,
        navigation: { field: new FlowField(grid), rebuildMs: NAVIGATION.flowFieldRebuildMs },
      });
      expect(withGrid).toEqual(plain);
      expect(plain.clearedAtMs).not.toBeNull();
    },
  );

  it('Fireball, Kaboom knockback, Convergence and the volunteer sprint', () => {
    const play = (collision: CollisionGrid | null) => {
      const sim = new M6Sim(1000 / 60);
      sim.collision = collision;
      sim.frame({ press: { slot: 1, aim: sim.at(PACK) } });
      sim.run(1500);
      sim.pressVolunteer(sim.at({ x: 120, y: -150 }));
      sim.run(2500);
      sim.meter.fill();
      sim.pressConvergence(sim.at(PACK));
      sim.run(CONVERGENCE.channelMs + 4000);
      return {
        impacts: sim.impacts,
        deaths: sim.deaths,
        reactions: sim.reactions,
        detonations: sim.detonations,
        released: sim.released,
        squad: sim.squad,
        enemies: sim.enemies,
      };
    };
    const plain = play(null);
    expect(plain.impacts.length).toBeGreaterThan(0);
    expect(plain.detonations.length).toBe(1);
    expect(play(openArena())).toEqual(plain);
  });
});
