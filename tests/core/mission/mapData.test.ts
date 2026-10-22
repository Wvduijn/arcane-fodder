import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MissionDef } from '@core/types';
import {
  collisionGridOf,
  KEG_MIN_START_DISTANCE_PX,
  parseMissionMap,
  type MapIssue,
} from '@core/mission/mapData';
import { FlowField } from '@core/world/flowField';
import { M01_GOBLIN_WOODS } from '@data/missions/m01-goblin-woods';

const W = 40;
const H = 30;
const TS = 16;

const MISSION: MissionDef = {
  id: 'm01-goblin-woods',
  name: 'Test Woods',
  map: 'tilemaps/test.json',
  squad: ['pyromancer', 'stormcaller'],
  nameSeed: 1,
  start: { spawnId: 'squad-start' },
  objectives: [{ kind: 'destroy', target: 'goblin-hut', count: 2 }],
  extraction: {
    kind: 'portal',
    spawnId: 'portal',
    radiusPx: 112,
    finalSurge: { waveId: 'surge-01', spawnPoints: 'all-remaining', aggro: 'always' },
  },
};

type Props = Record<string, string | number | boolean>;
interface Obj {
  name: string;
  type: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  props?: Props;
}

const point = (name: string, type: string, x: number, y: number, props: Props = {}): Obj => ({
  name,
  type,
  x,
  y,
  props,
});
const rect = (
  name: string,
  type: string,
  x: number,
  y: number,
  w: number,
  h: number,
  props: Props = {},
): Obj => ({
  name,
  type,
  x,
  y,
  w,
  h,
  props,
});

/** Huts at tiles (8..11, 4..7) and (28..31, 4..7) are marked in blockers, as conventions §3 asks. */
function blockersData(): number[] {
  const data = new Array<number>(W * H).fill(0);
  const mark = (x0: number, y0: number) => {
    for (let ty = y0; ty < y0 + 4; ty++)
      for (let tx = x0; tx < x0 + 4; tx++) data[ty * W + tx] = 15;
  };
  mark(8, 4);
  mark(28, 4);
  // A tree at tile (20, 20).
  data[20 * W + 20] = 14;
  return data;
}

function baseObjects(): Record<'zones' | 'spawns' | 'structures' | 'props', Obj[]> {
  return {
    zones: [
      rect('safe-start', 'safe-start', 16, 352, 128, 96),
      rect('sec-01', 'section', 0, 0, 640, 480, { index: 1, label: 'All' }),
      rect('trig-mid', 'trigger', 300, 200, 32, 80, {
        event: 'activate-group',
        group: 'grunts-mid',
      }),
      rect('trig-alert', 'trigger', 340, 200, 32, 80, {
        event: 'alert-group',
        group: 'archers',
        once: false,
      }),
    ],
    spawns: [
      point('squad-start', 'squad-start', 64, 400, { facing: 'n' }),
      point('grunts-mid-01', 'enemy-spawn', 400, 320, {
        enemy: 'goblin-grunt',
        group: 'grunts-mid',
        count: 3,
        trigger: 'trig-mid',
      }),
      point('grunts-open-01', 'enemy-spawn', 500, 380, {
        enemy: 'goblin-grunt',
        group: 'grunts-open',
      }),
      point('archer-01', 'archer-post', 440, 120, {
        group: 'archers',
        facing: 's',
        holdRadius: 20,
      }),
      point('surge-a', 'surge-spawn', 600, 400, {
        wave: 'surge-01',
        enemy: 'goblin-grunt',
        count: 4,
        delayMs: 0,
      }),
      point('surge-b', 'surge-spawn', 600, 100, {
        wave: 'surge-01',
        enemy: 'goblin-archer',
        count: 1,
        radius: 16,
        delayMs: 2000,
      }),
      point('hut-01-door', 'hut-spawn', 160, 140, { hut: 'hut-01' }),
    ],
    structures: [
      point('hut-01', 'goblin-hut', 160, 96, { runeIndex: 0, maxAlive: 2, activateRadius: 0 }),
      point('hut-02', 'goblin-hut', 480, 96, {
        target: 'goblin-hut',
        runeIndex: 1,
        spawnIntervalMs: 4000,
      }),
      point('portal', 'portal', 560, 240, { radiusPx: 112, runeCount: 2 }),
      point('rune-slot-01', 'rune-slot', 540, 200, { index: 0 }),
      point('rune-slot-02', 'rune-slot', 580, 200, { index: 1, portal: 'portal' }),
      point('keg-01', 'powder-keg', 360, 160, { chain: true, cluster: 'mid' }),
    ],
    props: [point('stump-01', 'prop', 260, 380, { sprite: 'env/stump-small', depth: 'above' })],
  };
}

function tiledObject(o: Obj, id: number): Record<string, unknown> {
  const isRect = o.w !== undefined;
  return {
    id,
    name: o.name,
    type: o.type,
    x: o.x,
    y: o.y,
    width: o.w ?? 0,
    height: o.h ?? 0,
    rotation: 0,
    visible: true,
    ...(isRect ? {} : { point: true }),
    properties: Object.entries(o.props ?? {}).map(([name, value]) => ({
      name,
      type: typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'bool' : 'int',
      value,
    })),
  };
}

/** A Tiled JSON map like the generator writes. */
function tiledMap(
  objects = baseObjects(),
  blockers = blockersData(),
): Record<string, unknown> & { layers: Record<string, unknown>[] } {
  let id = 1;
  const tile = (name: string, data: number[]) => ({
    id: id++,
    name,
    type: 'tilelayer',
    x: 0,
    y: 0,
    width: W,
    height: H,
    opacity: 1,
    visible: true,
    data,
  });
  let objectId = 1;
  const group = (name: string, list: Obj[]) => ({
    id: id++,
    name,
    type: 'objectgroup',
    draworder: 'topdown',
    objects: list.map((o) => tiledObject(o, objectId++)),
  });
  return {
    type: 'map',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    width: W,
    height: H,
    tilewidth: TS,
    tileheight: TS,
    layers: [
      tile('ground', new Array<number>(W * H).fill(1)),
      tile('ground-detail', new Array<number>(W * H).fill(0)),
      tile('blockers', blockers),
      tile('canopy', new Array<number>(W * H).fill(0)),
      group('zones', objects.zones),
      group('spawns', objects.spawns),
      group('structures', objects.structures),
      group('props', objects.props),
    ],
    tilesets: [],
  };
}

function withObjects(edit: (o: ReturnType<typeof baseObjects>) => void) {
  const objects = baseObjects();
  edit(objects);
  return tiledMap(objects);
}

const rulesOf = (issues: readonly MapIssue[]) => issues.map((i) => i.rule);

function expectError(
  json: unknown,
  rule: MapIssue['rule'],
  mission: MissionDef = MISSION,
): MapIssue[] {
  const result = parseMissionMap(json, mission);
  expect(result.map).toBeNull();
  expect(rulesOf(result.errors)).toContain(rule);
  return [...result.errors];
}

describe('parseMissionMap: a valid map', () => {
  const result = parseMissionMap(tiledMap(), MISSION);
  const map = result.map;

  it('has no errors or warnings', () => {
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(map).not.toBeNull();
  });

  it('reads size, bounds and the blockers layer', () => {
    expect(map?.widthTiles).toBe(W);
    expect(map?.tileSizePx).toBe(TS);
    expect(map?.bounds).toEqual({ x: 0, y: 0, width: W * TS, height: H * TS });
    if (!map) return;
    const grid = collisionGridOf(map);
    expect(grid.isTerrainSolid({ tx: 20, ty: 20 })).toBe(true);
    expect(grid.isTerrainSolid({ tx: 9, ty: 5 })).toBe(true);
    expect(grid.isTerrainSolid({ tx: 1, ty: 1 })).toBe(false);
  });

  it('types every object with conventions §4 defaults', () => {
    if (!map) throw new Error('no map');
    expect(map.squadStart).toEqual({
      name: 'squad-start',
      position: { x: 64, y: 400 },
      facing: 'n',
    });
    expect(map.portal).toEqual({
      name: 'portal',
      position: { x: 560, y: 240 },
      radiusPx: 112,
      runeCount: 2,
    });
    expect(map.runeSlots.map((r) => [r.name, r.index, r.portal])).toEqual([
      ['rune-slot-01', 0, 'portal'],
      ['rune-slot-02', 1, 'portal'],
    ]);
    expect(map.huts.map((h) => h.name)).toEqual(['hut-01', 'hut-02']);
    expect(map.huts[0]).toMatchObject({
      target: 'goblin-hut',
      runeIndex: 0,
      overrides: { maxAlive: 2, activateRadiusPx: 0 },
      door: { x: 160, y: 140 },
    });
    expect(map.huts[1]).toMatchObject({ overrides: { spawnIntervalMs: 4000 }, door: null });
    expect(map.kegs).toEqual([
      { name: 'keg-01', position: { x: 360, y: 160 }, cluster: 'mid', chain: true },
    ]);
    expect(map.enemySpawns).toEqual([
      {
        name: 'grunts-mid-01',
        position: { x: 400, y: 320 },
        enemy: 'goblin-grunt',
        group: 'grunts-mid',
        count: 3,
        radiusPx: 24,
        trigger: 'trig-mid',
        leashPx: 0,
      },
      {
        name: 'grunts-open-01',
        position: { x: 500, y: 380 },
        enemy: 'goblin-grunt',
        group: 'grunts-open',
        count: 1,
        radiusPx: 24,
        trigger: null,
        leashPx: 0,
      },
    ]);
    expect(map.archerPosts).toEqual([
      {
        name: 'archer-01',
        position: { x: 440, y: 120 },
        group: 'archers',
        facing: 's',
        holdRadiusPx: 20,
      },
    ]);
    expect(map.surgeSpawns.map((s) => [s.name, s.enemy, s.count, s.radiusPx, s.delayMs])).toEqual([
      ['surge-a', 'goblin-grunt', 4, 24, 0],
      ['surge-b', 'goblin-archer', 1, 16, 2000],
    ]);
    expect(map.triggers).toEqual([
      {
        name: 'trig-mid',
        rect: { x: 300, y: 200, width: 32, height: 80 },
        once: true,
        event: { kind: 'activate-group', group: 'grunts-mid' },
      },
      {
        name: 'trig-alert',
        rect: { x: 340, y: 200, width: 32, height: 80 },
        once: false,
        event: { kind: 'alert-group', group: 'archers' },
      },
    ]);
    expect(map.sections).toEqual([
      { name: 'sec-01', rect: { x: 0, y: 0, width: 640, height: 480 }, index: 1, label: 'All' },
    ]);
    expect(map.safeStarts).toEqual([
      { name: 'safe-start', rect: { x: 16, y: 352, width: 128, height: 96 } },
    ]);
    expect(map.boundsHint).toBeNull();
    expect(map.props).toEqual([
      {
        name: 'stump-01',
        position: { x: 260, y: 380 },
        sprite: 'env/stump-small',
        depth: 'above',
        flipX: false,
      },
    ]);
  });

  it('reads the Tiled class field, plain-object properties and base64 data too', () => {
    const json = tiledMap();
    const zones = json.layers[4] as { objects: Record<string, unknown>[] };
    const first = zones.objects[0];
    if (!first) throw new Error('no zone');
    first['class'] = first['type'];
    delete first['type'];
    const blockers = json.layers[2];
    if (!blockers) throw new Error('no blockers');
    const bytes = new Uint8Array(new Uint32Array(blockersData()).buffer);
    blockers['data'] = Buffer.from(bytes).toString('base64');
    blockers['encoding'] = 'base64';
    const result = parseMissionMap(json, MISSION);
    expect(result.errors).toEqual([]);
    expect(result.map?.blockers).toEqual(blockersData());
    expect(result.map?.safeStarts).toHaveLength(1);
  });
});

describe('parseMissionMap: format errors', () => {
  it.each([null, 42, 'map', []])('not an object (%j)', (json) => {
    expect(parseMissionMap(json, MISSION).errors[0]?.rule).toBe('format');
  });

  it('a missing required layer, or a layer of the wrong kind', () => {
    const missing = tiledMap();
    missing.layers = missing.layers.filter((l) => l['name'] !== 'blockers');
    expect(expectError(missing, 'format').some((e) => e.message.includes('"blockers"'))).toBe(true);
    const wrong = tiledMap();
    const zones = wrong.layers[4];
    if (zones) zones['type'] = 'tilelayer';
    expectError(wrong, 'format');
  });

  it('optional layers may be missing', () => {
    const json = tiledMap();
    json.layers = json.layers.filter((l) => l['name'] !== 'canopy' && l['name'] !== 'props');
    expect(parseMissionMap(json, MISSION).errors).toEqual([]);
  });

  it('tile data of the wrong size, or compressed', () => {
    const json = tiledMap();
    const blockers = json.layers[2];
    if (blockers) blockers['data'] = [0, 0, 0];
    expectError(json, 'format');
    const zipped = tiledMap();
    const b2 = zipped.layers[2];
    if (b2) b2['compression'] = 'zlib';
    expectError(zipped, 'format');
  });

  it('infinite or non-orthogonal maps', () => {
    expectError({ ...tiledMap(), infinite: true }, 'format');
    expectError({ ...tiledMap(), orientation: 'isometric' }, 'format');
  });

  it('an unknown type, the wrong layer, the wrong geometry, a tile object', () => {
    expectError(
      withObjects((o) => o.spawns.push(point('x-01', 'dragon', 10, 10))),
      'format',
    );
    expectError(
      withObjects((o) => o.zones.push(rect('keg-x', 'powder-keg', 400, 400, 16, 16))),
      'format',
    );
    expectError(
      withObjects((o) =>
        o.spawns.push(
          rect('grunts-x', 'enemy-spawn', 400, 400, 16, 16, { enemy: 'goblin-grunt', group: 'g' }),
        ),
      ),
      'format',
    );
    const gid = tiledMap();
    const structures = gid.layers[6] as { objects: Record<string, unknown>[] };
    const keg = structures.objects.find((x) => x['name'] === 'keg-01');
    if (keg) keg['gid'] = 5;
    expectError(gid, 'format');
  });

  it('missing or bad properties name the object', () => {
    const errors = expectError(
      withObjects((o) => {
        o.spawns.push(point('bad-enemy', 'enemy-spawn', 420, 420, { enemy: 'dragon', group: 'g' }));
        o.spawns.push(point('no-group', 'enemy-spawn', 430, 420, { enemy: 'goblin-grunt' }));
        o.spawns.push(
          point('zero', 'enemy-spawn', 440, 420, { enemy: 'goblin-grunt', group: 'g', count: 0 }),
        );
        o.spawns.push(point('bad-facing', 'archer-post', 450, 420, { group: 'g', facing: 'up' }));
        o.zones.push(rect('bad-event', 'trigger', 10, 10, 16, 16, { event: 'explode' }));
      }),
      'format',
    );
    const named = new Set(errors.map((e) => e.object));
    for (const n of ['bad-enemy', 'no-group', 'zero', 'bad-facing', 'bad-event'])
      expect(named.has(n)).toBe(true);
  });

  it('an object outside the map', () => {
    expectError(
      withObjects((o) => o.structures.push(point('keg-far', 'powder-keg', 9000, 300))),
      'format',
    );
  });

  it('a point on the far map edge (x = width) is outside (review M7-T2 m3)', () => {
    expectError(
      withObjects((o) => o.structures.push(point('keg-edge', 'powder-keg', W * TS, 300))),
      'format',
    );
    const inside = withObjects((o) =>
      o.structures.push(point('keg-in', 'powder-keg', W * TS - 1, 300)),
    );
    expect(parseMissionMap(inside, MISSION).errors).toEqual([]);
  });

  it('warns about empty ground cells', () => {
    const json = tiledMap();
    const ground = json.layers[0] as { data: number[] };
    ground.data[5] = 0;
    const result = parseMissionMap(json, MISSION);
    expect(result.errors).toEqual([]);
    expect(rulesOf(result.warnings)).toEqual(['format']);
  });
});

describe('parseMissionMap: conventions §6 rules', () => {
  it('rule 1: exactly one squad-start and one portal, with the mission names', () => {
    expectError(
      withObjects((o) => (o.spawns = o.spawns.filter((s) => s.type !== 'squad-start'))),
      1,
    );
    expectError(
      withObjects((o) => o.spawns.push(point('squad-start-2', 'squad-start', 80, 400))),
      1,
    );
    expectError(
      withObjects((o) => (o.structures = o.structures.filter((s) => s.type !== 'portal'))),
      1,
    );
    expectError(
      withObjects((o) => o.structures.push(point('portal-2', 'portal', 300, 300))),
      1,
    );
    expectError(tiledMap(), 1, { ...MISSION, start: { spawnId: 'elsewhere' } });
    expectError(tiledMap(), 1, {
      ...MISSION,
      extraction: { ...MISSION.extraction, spawnId: 'gate' },
    });
  });

  it('rule 1: without mission.start the single squad-start is used', () => {
    const noStart: MissionDef = {
      id: MISSION.id,
      name: MISSION.name,
      map: MISSION.map,
      squad: MISSION.squad,
      nameSeed: MISSION.nameSeed,
      objectives: MISSION.objectives,
      extraction: MISSION.extraction,
    };
    expect(parseMissionMap(tiledMap(), noStart).map?.squadStart.name).toBe('squad-start');
  });

  it('rule 2: hut count equals the objective count', () => {
    expectError(tiledMap(), 2, {
      ...MISSION,
      objectives: [{ kind: 'destroy', target: 'goblin-hut', count: 3 }],
    });
    expectError(
      withObjects((o) => (o.structures = o.structures.filter((s) => s.name !== 'hut-02'))),
      2,
    );
  });

  it('rule 2: runeIndex unique and covering 0..count−1', () => {
    const dup = withObjects((o) => {
      const h = o.structures.find((s) => s.name === 'hut-02');
      if (h?.props) h.props['runeIndex'] = 0;
    });
    expectError(dup, 2);
    const gap = withObjects((o) => {
      const h = o.structures.find((s) => s.name === 'hut-02');
      if (h?.props) h.props['runeIndex'] = 5;
    });
    expectError(gap, 2);
    expectError(
      withObjects((o) => {
        const h = o.structures.find((s) => s.name === 'hut-02');
        if (h?.props) delete h.props['runeIndex'];
      }),
      'format',
    );
  });

  it('rule 2: portal runeCount must match; a radius mismatch only warns (mission wins)', () => {
    expectError(
      withObjects((o) => {
        const p = o.structures.find((s) => s.name === 'portal');
        if (p?.props) p.props['runeCount'] = 3;
      }),
      2,
    );
    const radius = parseMissionMap(
      withObjects((o) => {
        const p = o.structures.find((s) => s.name === 'portal');
        if (p?.props) p.props['radiusPx'] = 48;
      }),
      MISSION,
    );
    expect(radius.errors).toEqual([]);
    expect(rulesOf(radius.warnings)).toEqual([2]);
    expect(radius.map?.portal.radiusPx).toBe(48);
  });

  it('rule 3: the final surge wave has at least one surge-spawn', () => {
    expectError(tiledMap(), 3, {
      ...MISSION,
      extraction: {
        ...MISSION.extraction,
        finalSurge: { ...MISSION.extraction.finalSurge, waveId: 'surge-02' },
      },
    });
  });

  it('rule 4: triggers, groups, huts and portals resolve', () => {
    expectError(
      withObjects((o) => {
        const s = o.spawns.find((x) => x.name === 'grunts-mid-01');
        if (s?.props) s.props['trigger'] = 'trig-nowhere';
      }),
      4,
    );
    expectError(
      withObjects((o) =>
        o.zones.push(
          rect('trig-x', 'trigger', 10, 10, 16, 16, { event: 'alert-group', group: 'ghosts' }),
        ),
      ),
      4,
    );
    expectError(
      withObjects((o) => o.spawns.push(point('door-x', 'hut-spawn', 300, 300, { hut: 'hut-09' }))),
      4,
    );
    expectError(
      withObjects((o) =>
        o.structures.push(point('rune-x', 'rune-slot', 300, 300, { index: 0, portal: 'gate' })),
      ),
      4,
    );
  });

  it('rule 5: names are unique across layers', () => {
    expectError(
      withObjects((o) => o.structures.push(point('archer-01', 'powder-keg', 600, 300))),
      5,
    );
  });

  it('rule 6: a spawn or structure point on a blockers tile warns; huts on their footprint do not', () => {
    const result = parseMissionMap(
      withObjects((o) => {
        o.spawns.push(
          point('grunts-tree', 'enemy-spawn', 20 * 16 + 4, 20 * 16 + 4, {
            enemy: 'goblin-grunt',
            group: 'g',
          }),
        );
        o.structures.push(point('keg-tree', 'powder-keg', 20 * 16 + 8, 20 * 16 + 8));
        o.props.push(point('prop-tree', 'prop', 20 * 16 + 8, 20 * 16 + 9, { sprite: 'env/x' }));
      }),
      MISSION,
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => [w.rule, w.object])).toEqual([
      [6, 'grunts-tree'],
      [6, 'keg-tree'],
    ]);
  });

  it('rule 7: no keg in safe-start, none within 192 px of the squad start', () => {
    expect(KEG_MIN_START_DISTANCE_PX).toBe(192);
    expectError(
      withObjects((o) => o.structures.push(point('keg-safe', 'powder-keg', 140, 440))),
      7,
    );
    expectError(
      withObjects((o) => o.structures.push(point('keg-near', 'powder-keg', 64 + 191, 400))),
      7,
    );
    const ok = parseMissionMap(
      withObjects((o) => o.structures.push(point('keg-ok', 'powder-keg', 64 + 192, 400))),
      MISSION,
    );
    expect(ok.errors).toEqual([]);
  });

  it('rule 7 (warning): an enemy spawn point inside safe-start (conventions §4.3)', () => {
    const result = parseMissionMap(
      withObjects((o) => {
        o.spawns.push(
          point('grunts-safe', 'enemy-spawn', 100, 400, { enemy: 'goblin-grunt', group: 'g' }),
        );
        o.spawns.push(point('archer-safe', 'archer-post', 120, 420, { group: 'archers' }));
        o.spawns.push(
          point('surge-safe', 'surge-spawn', 30, 360, {
            wave: 'surge-01',
            enemy: 'goblin-grunt',
            count: 1,
          }),
        );
      }),
      MISSION,
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => [w.rule, w.object])).toEqual([
      [7, 'grunts-safe'],
      [7, 'archer-safe'],
      [7, 'surge-safe'],
    ]);
  });

  it('rule 6 (warning): a 1-tile passage between blockers', () => {
    const blockers = blockersData();
    // A wall along column 15, rows 10..20, with a one-tile gap at row 15.
    for (let ty = 10; ty <= 20; ty++) if (ty !== 15) blockers[ty * W + 15] = 14;
    const narrow = parseMissionMap(tiledMap(baseObjects(), blockers), MISSION);
    expect(narrow.errors).toEqual([]);
    expect(narrow.warnings).toHaveLength(1);
    expect(narrow.warnings[0]).toMatchObject({ rule: 6 });
    expect(narrow.warnings[0]?.message).toContain('tile (15, 15)');
    // Two tiles wide: a body fits, no warning.
    blockers[16 * W + 15] = 0;
    expect(parseMissionMap(tiledMap(baseObjects(), blockers), MISSION).warnings).toEqual([]);
  });

  it('lists every problem at once', () => {
    const result = parseMissionMap(
      withObjects((o) => {
        o.spawns = o.spawns.filter((s) => s.type !== 'squad-start');
        o.structures.push(point('archer-01', 'powder-keg', 600, 300));
      }),
      MISSION,
    );
    expect(rulesOf(result.errors)).toEqual(expect.arrayContaining([1, 5]));
  });
});

const M01_PATH = 'public/assets/tilemaps/m01-goblin-woods.json';

describe('the real Goblin Woods map', () => {
  // Never skipped (review M7-T9 M1): a missing or uncommitted map must fail loudly (D1).
  it(`${M01_PATH} passes every loader rule for M01_GOBLIN_WOODS`, () => {
    const json: unknown = JSON.parse(readFileSync(M01_PATH, 'utf8'));
    const result = parseMissionMap(json, M01_GOBLIN_WOODS);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    const map = result.map;
    if (!map) throw new Error('no map');
    expect(map.widthTiles).toBe(128);
    expect(map.heightTiles).toBe(96);
    // The MissionDef's references resolve to map objects (review M7-T3 m3).
    expect(map.squadStart.name).toBe(M01_GOBLIN_WOODS.start.spawnId);
    expect(map.portal.name).toBe(M01_GOBLIN_WOODS.extraction.spawnId);
    const wave = M01_GOBLIN_WOODS.extraction.finalSurge.waveId;
    expect(map.surgeSpawns.filter((s) => s.wave === wave).length).toBeGreaterThan(0);
    expect(map.huts).toHaveLength(2);
    expect(map.surgeSpawns.length).toBeGreaterThan(0);
    const grid = collisionGridOf(map);
    expect(grid.overlapsSolid(map.squadStart.position, 10)).toBe(false);
    expect(grid.isBlockedTile(grid.tileAt(map.portal.position))).toBe(false);
  });

  it('is one connected route: start, huts, spawns and surge reach the portal', () => {
    const map = parseMissionMap(JSON.parse(readFileSync(M01_PATH, 'utf8')), M01_GOBLIN_WOODS).map;
    if (!map) throw new Error('no map');
    const grid = collisionGridOf(map);
    const field = new FlowField(grid);
    field.build([map.portal.position]);
    const reach = (p: { x: number; y: number }) =>
      field.distanceAt(grid.nearestFreeTile(p, { clearancePx: 10 }) ?? p);
    expect(reach(map.squadStart.position)).toBeLessThan(Number.POSITIVE_INFINITY);
    for (const h of map.huts) expect(reach(h.door ?? h.position)).toBeLessThan(Infinity);
    for (const s of [...map.enemySpawns, ...map.archerPosts, ...map.surgeSpawns]) {
      expect(reach(s.position), s.name).toBeLessThan(Infinity);
    }
  });
});

describe('generator ↔ loader format (review M7-T2 m1)', () => {
  it('scripts/levels/stub, built by `build-tilemap.js`, parses with 0 errors and 0 warnings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-stub-'));
    try {
      const out = join(dir, 'stub.json');
      // The CLI path is what `pnpm maps:build` runs (plain Node ESM, no types to import).
      execFileSync(process.execPath, [
        'scripts/levels/build-tilemap.js',
        '--src',
        'scripts/levels/stub',
        '--out',
        out,
      ]);
      const json: unknown = JSON.parse(readFileSync(out, 'utf8'));
      const oneHut: MissionDef = {
        ...MISSION,
        objectives: [{ kind: 'destroy', target: 'goblin-hut', count: 1 }],
      };
      const result = parseMissionMap(json, oneHut);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.map?.huts.map((h) => h.name)).toEqual(['hut-01']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
