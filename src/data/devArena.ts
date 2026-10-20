/** Dev arena world bounds, M01's size (M2 Q3). Temporary: M7's TilemapLoader reads the size from the map JSON. */
import type { DevEncounterSpawn, DevKegSpawn, DevSquadConfig, Rect } from '@core/types';

export const DEV_ARENA = {
  x: 0,
  y: 0,
  width: 2048,
  height: 1536,
} as const satisfies Rect;

/**
 * Dev arena squad (M3, classes M4). Temporary: M7's mission data supplies the roster.
 * Classes P,S,P,S leader first (GDD Q18).
 * nameSeed is arbitrary but fixed; each restart uses nameSeed + attempt (GDD Q17).
 */
export const DEV_SQUAD = {
  classes: ['pyromancer', 'stormcaller', 'pyromancer', 'stormcaller'],
  nameSeed: 1337,
} as const satisfies DevSquadConfig;

/**
 * Dev encounter (M4 Q1, GDD §3 Verify). Offsets are relative to the leader's spawn (arena centre);
 * followers trail below it (+y). Temporary: M7's waves replace it.
 * - 6 grunts, 3×2 grid 32 px apart (bodies 24 px), 178–213 px north: inside grunt aggro 220 of the
 *   leader, so the squad wins with no input (D2).
 * - 2 archers 400 px east, 48 px apart: outside archer aggro 260 of every wizard at spawn, so the
 *   playtester has to walk over and push them.
 */
export const DEV_ENCOUNTER = [
  { enemy: 'goblin-grunt', offset: { x: -32, y: -210 } },
  { enemy: 'goblin-grunt', offset: { x: 0, y: -210 } },
  { enemy: 'goblin-grunt', offset: { x: 32, y: -210 } },
  { enemy: 'goblin-grunt', offset: { x: -32, y: -178 } },
  { enemy: 'goblin-grunt', offset: { x: 0, y: -178 } },
  { enemy: 'goblin-grunt', offset: { x: 32, y: -178 } },
  { enemy: 'goblin-archer', offset: { x: 400, y: -24 } },
  { enemy: 'goblin-archer', offset: { x: 400, y: 24 } },
] as const satisfies readonly DevEncounterSpawn[];

/**
 * Dev arena powder kegs (M5 Q2, GDD §8). Offsets relative to the leader's spawn, all ≥ 112 px from
 * it. Temporary: M7's map places the real kegs.
 * - A chain of 3, 64 px apart, 400 px west: each keg reaches the next (80 px) but not the one after
 *   (128 px), so it cascades in order, 300 ms apart. Shoot it as DEV_KEG_PACK runs past.
 * - 1 keg 40 px behind the archer pair: both archers 47 px away, inside the 82 px archer reach.
 *   Lightning on the keg kills the pair.
 */
export const DEV_KEGS = [
  { offset: { x: -400, y: -64 } },
  { offset: { x: -400, y: 0 } },
  { offset: { x: -400, y: 64 } },
  { offset: { x: 440, y: 0 } },
] as const satisfies readonly DevKegSpawn[];

/**
 * Grunt pack beside the keg chain (M5 Q2). Separate from DEV_ENCOUNTER so M4's no-input D2 fight is
 * unchanged: the nearest grunt is 448 px from the leader, outside grunt aggro 220 of every wizard at
 * spawn. 2×2 grid 32 px apart, 48–80 px west of the chain: the middle keg's blast (84 px reach on a
 * grunt, centres 51–82 px away) covers all 4.
 */
export const DEV_KEG_PACK = [
  { enemy: 'goblin-grunt', offset: { x: -448, y: -16 } },
  { enemy: 'goblin-grunt', offset: { x: -448, y: 16 } },
  { enemy: 'goblin-grunt', offset: { x: -480, y: -16 } },
  { enemy: 'goblin-grunt', offset: { x: -480, y: 16 } },
] as const satisfies readonly DevEncounterSpawn[];
