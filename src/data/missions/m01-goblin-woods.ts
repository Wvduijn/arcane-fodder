import type { MissionDef } from '@core/types';

/** Mission 1 (plan §4.4). Where things stand lives in the map; see docs/design/levels/m01-goblin-woods.md. */
export const M01_GOBLIN_WOODS = {
  id: 'm01-goblin-woods',
  name: 'Goblin Woods',
  map: 'tilemaps/m01-goblin-woods.json',
  squad: ['pyromancer', 'stormcaller', 'pyromancer', 'stormcaller'],
  nameSeed: 1701,
  start: { spawnId: 'squad-start' },
  objectives: [{ kind: 'destroy', target: 'goblin-hut', count: 2 }],
  extraction: {
    kind: 'portal',
    spawnId: 'portal',
    radiusPx: 112,
    finalSurge: { waveId: 'surge-01', spawnPoints: 'all-remaining', aggro: 'always' },
  },
} as const satisfies MissionDef;
