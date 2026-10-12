/**
 * Guards the layer boundaries of plan.md §7.3 against silent regression.
 * Lints in-memory snippets with the real eslint.config, at virtual paths inside each layer.
 */
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

// Virtual paths are not on disk, so the typed project service cannot load them.
// Type-aware rules are off here; the import boundaries do not depend on type information.
const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfig: [
    tseslint.configs.disableTypeChecked,
    { languageOptions: { parserOptions: { projectService: false } } },
  ],
});

async function lint(code: string, filePath: string): Promise<ESLint.LintResult> {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: true });
  if (!result) throw new Error(`ESLint returned no result for ${filePath}`);
  return result;
}

async function expectRestricted(
  code: string,
  filePath: string,
  ruleId = 'no-restricted-imports',
): Promise<void> {
  const result = await lint(code, filePath);
  const restricted = result.messages.filter((m) => m.ruleId === ruleId && m.severity === 2);
  expect(restricted, `expected a ${ruleId} error in ${filePath}`).not.toHaveLength(0);
}

async function expectClean(code: string, filePath: string): Promise<void> {
  const result = await lint(code, filePath);
  // A warning here usually means "File ignored", which would make the guard meaningless.
  expect(result.messages, `expected no lint messages in ${filePath}`).toEqual([]);
}

describe('src/core boundaries', () => {
  const file = 'src/core/math/__boundary__.ts';

  it('rejects importing phaser', async () => {
    await expectRestricted(`import Phaser from 'phaser';\nexport const p = Phaser;\n`, file);
  });

  it('rejects a type-only import of phaser', async () => {
    await expectRestricted(
      `import type Phaser from 'phaser';\nexport type Scene = Phaser.Scene;\n`,
      file,
    );
  });

  it('rejects importing @game', async () => {
    await expectRestricted(
      `import { MissionScene } from '@game/scenes/MissionScene';\nexport const s = MissionScene;\n`,
      file,
    );
  });

  it('rejects importing @platform', async () => {
    await expectRestricted(
      `import { storage } from '@platform/storage';\nexport const s = storage;\n`,
      file,
    );
  });

  it('rejects non-canonical relative paths even when they stay inside core', async () => {
    await expectRestricted(
      `import type { Vec2 } from './../types';\nexport const origin: Vec2 = { x: 0, y: 0 };\n`,
      file,
    );
  });

  it('rejects non-canonical relative paths that escape core', async () => {
    await expectRestricted(`import { x } from './../../game/x';\nexport const y = x;\n`, file);
    await expectRestricted(`import { x } from '../x/../../game/x';\nexport const y = x;\n`, file);
  });

  it('rejects relative imports into src/game and src/platform', async () => {
    await expectRestricted(
      `import { MissionScene } from '../../game/scenes/MissionScene';\nexport const s = MissionScene;\n`,
      file,
    );
    await expectRestricted(
      `import { storage } from '../../platform/storage';\nexport const s = storage;\n`,
      file,
    );
  });

  it('rejects importing @data, which sits above core', async () => {
    await expectRestricted(
      `import { CLASSES } from '@data/classes';\nexport const c = CLASSES;\n`,
      file,
    );
  });

  it('rejects relative imports into src/app and src/main', async () => {
    await expectRestricted(
      `import { config } from '../../app/config';\nexport const c = config;\n`,
      file,
    );
    await expectRestricted(`import '../../main';\nexport const m = 1;\n`, file);
    await expectRestricted(`import '../../main.ts';\nexport const m = 1;\n`, file);
    await expectRestricted(`import '../../styles/game.css';\nexport const m = 1;\n`, file);
  });

  it('rejects node built-ins', async () => {
    await expectRestricted(`import fs from 'node:fs';\nexport const f = fs;\n`, file);
    await expectRestricted(`import fs from 'fs';\nexport const f = fs;\n`, file);
  });

  it('rejects any third-party package, so the allow-list cannot become a deny-list', async () => {
    await expectRestricted(`import _ from 'lodash';\nexport const l = _;\n`, file);
  });

  it('rejects node and browser runtime globals', async () => {
    for (const code of [
      `export const p = process.env;\n`,
      `export const b = Buffer.alloc(1);\n`,
      `export const t = performance.now();\n`,
      `export const r = requestAnimationFrame;\n`,
      `export const s = localStorage;\n`,
      `export const s = globalThis.localStorage;\n`,
      `export const s = self.localStorage;\n`,
    ]) {
      await expectRestricted(code, file, 'no-restricted-globals');
    }
  });

  it('rejects dynamic import(), which would bypass no-restricted-imports', async () => {
    await expectRestricted(
      `export const load = (): Promise<unknown> => import('phaser');\n`,
      file,
      'no-restricted-syntax',
    );
  });

  it('rejects DOM globals', async () => {
    await expectRestricted(`export const w = window.innerWidth;\n`, file, 'no-restricted-globals');
    await expectRestricted(`export const el = document.body;\n`, file, 'no-restricted-globals');
  });

  it('accepts relative imports that stay inside core, even when a folder shares a layer name', async () => {
    await expectClean(`import { a } from './game';\n\nexport const b = a;\n`, file);
    await expectClean(`import { a } from '../ai/main';\n\nexport const b = a;\n`, file);
    await expectClean(
      `import { a } from '../../squad/formation';\n\nexport const b = a;\n`,
      'src/core/combat/status/__boundary__.ts',
    );
  });

  it('accepts a relative import of core types from a deeply nested core file', async () => {
    await expectClean(
      `import type { Vec2 } from '../../../../types';\n\nexport const origin: Vec2 = { x: 0, y: 0 };\n`,
      'src/core/a/b/c/d/__boundary__.ts',
    );
  });

  it('accepts a clean core file', async () => {
    await expectClean(
      `import type { Vec2 } from '@core/types';\n\nexport const origin: Vec2 = { x: 0, y: 0 };\n`,
      file,
    );
  });
});

describe('src/data boundaries', () => {
  const file = 'src/data/__boundary__.ts';

  it('rejects importing phaser', async () => {
    await expectRestricted(`import Phaser from 'phaser';\nexport const p = Phaser;\n`, file);
  });

  it('rejects importing @game', async () => {
    await expectRestricted(
      `import { MissionScene } from '@game/scenes/MissionScene';\nexport const s = MissionScene;\n`,
      file,
    );
  });

  it('rejects importing @platform', async () => {
    await expectRestricted(
      `import { storage } from '@platform/storage';\nexport const s = storage;\n`,
      file,
    );
  });

  it('rejects relative imports into src/game and src/platform', async () => {
    await expectRestricted(
      `import { MissionScene } from '../game/scenes/MissionScene';\nexport const s = MissionScene;\n`,
      file,
    );
    await expectRestricted(
      `import { storage } from '../platform/storage';\nexport const s = storage;\n`,
      file,
    );
    await expectRestricted(`import '../main';\nexport const m = 1;\n`, file);
    await expectRestricted(`import '../styles/game.css';\nexport const m = 1;\n`, file);
  });

  it('rejects third-party packages, so "only @core" cannot become a deny-list', async () => {
    await expectRestricted(`import _ from 'lodash';\nexport const l = _;\n`, file);
  });

  it('rejects node built-ins', async () => {
    await expectRestricted(`import fs from 'node:fs';\nexport const f = fs;\n`, file);
  });

  it('rejects dynamic import()', async () => {
    await expectRestricted(
      `export const load = (): Promise<unknown> => import('@core/types');\n`,
      file,
      'no-restricted-syntax',
    );
  });

  // ADR 0003: data may only import types from core.
  it('rejects value imports from core via the alias', async () => {
    await expectRestricted(`import { add } from '@core/math/vec2';\nexport const a = add;\n`, file);
    await expectRestricted(
      `import * as vec2 from '@core/math/vec2';\nexport const v = vec2;\n`,
      file,
    );
    await expectRestricted(`import '@core/math/vec2';\nexport const m = 1;\n`, file);
  });

  it('rejects value imports from core via a relative path', async () => {
    await expectRestricted(
      `import { add } from '../core/math/vec2';\nexport const a = add;\n`,
      file,
    );
    await expectRestricted(
      `import { add } from '../../core/math/vec2';\nexport const a = add;\n`,
      'src/data/missions/__boundary__.ts',
    );
  });

  it('rejects a mixed import that pulls in a core value next to a type', async () => {
    await expectRestricted(
      `import { type Vec2, add } from '@core/math/vec2';\nexport const a: (p: Vec2, q: Vec2) => Vec2 = add;\n`,
      file,
    );
  });

  it('rejects a non-canonical relative value import from core', async () => {
    await expectRestricted(
      `import { add } from './../core/math/vec2';\nexport const a = add;\n`,
      file,
    );
  });

  // An inline type specifier keeps a runtime import under verbatimModuleSyntax.
  it('rejects an inline type specifier from core', async () => {
    await expectRestricted(
      `import { type Vec2 } from '@core/types';\nexport const spawn: Vec2 = { x: 0, y: 0 };\n`,
      file,
      '@typescript-eslint/no-import-type-side-effects',
    );
  });

  it('rejects re-exporting a core value', async () => {
    await expectRestricted(`export { add } from '@core/math/vec2';\n`, file);
  });

  it('accepts a type import from @core/types', async () => {
    await expectClean(
      `import type { Vec2 } from '@core/types';\n\nexport const spawn: Vec2 = { x: 0, y: 0 };\n`,
      file,
    );
  });

  it('accepts a type import from a relative core path', async () => {
    await expectClean(
      `import type { Vec2 } from '../core/types';\n\nexport const spawn: Vec2 = { x: 0, y: 0 };\n`,
      file,
    );
  });

  it('accepts re-exporting a core type', async () => {
    await expectClean(`export type { Vec2 } from '@core/types';\n`, file);
  });

  it('accepts imports from other data modules', async () => {
    await expectClean(
      `import { SPELLS } from '@data/spells';\n\nexport const spells = SPELLS;\n`,
      file,
    );
    await expectClean(
      `import { SPELLS } from './spells';\n\nexport const spells = SPELLS;\n`,
      file,
    );
    await expectClean(
      `import type { Vec2 } from '../../core/types';\n\nexport const spawn: Vec2 = { x: 0, y: 0 };\n`,
      'src/data/missions/__boundary__.ts',
    );
  });
});

describe('src/game inline type specifiers', () => {
  it('accepts a mixed type and value import, which no-import-type-side-effects leaves alone', async () => {
    await expectClean(
      `import { type Vec2, add } from '@core/math/vec2';\n\nexport const a: (p: Vec2, q: Vec2) => Vec2 = add;\n`,
      'src/game/__boundary__.ts',
    );
  });
});

describe('src storage access', () => {
  it('rejects localStorage through window or globalThis outside src/platform', async () => {
    const file = 'src/game/__boundary__.ts';
    await expectRestricted(
      `export const s = window.localStorage;\n`,
      file,
      'no-restricted-properties',
    );
    await expectRestricted(
      `export const s = globalThis.localStorage;\n`,
      file,
      'no-restricted-properties',
    );
  });

  it('accepts localStorage inside src/platform', async () => {
    await expectClean(
      `export const s = window.localStorage;\n`,
      'src/platform/storage/__boundary__.ts',
    );
  });
});
