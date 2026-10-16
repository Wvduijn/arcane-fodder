/** Dev arena world bounds, M01's size (M2 Q3). Temporary: M7's TilemapLoader reads the size from the map JSON. */
import type { DevEncounterSpawn, DevSquadConfig, Rect } from '@core/types';

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
