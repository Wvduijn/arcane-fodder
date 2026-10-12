// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Phaser clock only (CLAUDE.md). Repeated per block because later rule options replace earlier ones. */
const timerGlobals = [
  { name: 'setTimeout', message: 'Use the Phaser clock (scene.time).' },
  { name: 'setInterval', message: 'Use the Phaser clock (scene.time).' },
];
const storageGlobals = ['localStorage', 'sessionStorage'].map((name) => ({
  name,
  message: 'Storage only through platform/storage.',
}));

/** `window.x`, `globalThis.x` and `self.x` reach the same globals as a bare `x`. */
const globalObjects = ['window', 'globalThis', 'self'];
const restrictedProperties = (/** @type {string[]} */ names, /** @type {string} */ message) =>
  globalObjects.flatMap((object) => names.map((property) => ({ object, property, message })));
const timerProperties = restrictedProperties(
  ['setTimeout', 'setInterval'],
  'Use the Phaser clock.',
);
const storageProperties = restrictedProperties(
  ['localStorage', 'sessionStorage'],
  'Storage only through platform/storage.',
);

/** Dynamic import() bypasses no-restricted-imports, so lower layers may not use it at all. */
const noDynamicImport = {
  selector: 'ImportExpression',
  message: 'Dynamic import() is not allowed in this layer (plan.md §7.3).',
};

/**
 * Relative paths must be canonical (`../x`, not `./../x` or `a/../../x`); otherwise the
 * depth-based escape check below can be sidestepped.
 */
const NON_CANONICAL_RELATIVE = '^\\./\\.\\.(?:/|$)|(?:^|/)(?!\\.\\.(?:/|$))[^/]+/\\.\\.(?:/|$)';

/**
 * Deepest folder level inside a layer that gets an exact relative-escape check. Files nested
 * deeper share the deepest check, so imports that climb more than this many `..` while staying
 * inside the layer are falsely rejected. That fails safe (review M1-T1 n5, deferred).
 */
const MAX_LAYER_DEPTH = 8;

/**
 * plan.md §7.3 boundary for one layer, as an allow-list. Bare specifiers must match `allowed`.
 * A relative path leaves the layer once it climbs as many `..` as the file is deep, so the
 * check is generated per folder depth; a core module that happens to be named `game` or
 * `main` is not a false positive. Layers in `typeOnlyFrom` may be reached, by alias or by a
 * relative path, with `import type` only (ADR 0003).
 */
const layerBoundary = (
  /** @type {{ layer: string, allowed: string[], typeOnlyFrom: string[], message: string }} */ {
    layer,
    allowed,
    typeOnlyFrom,
    message,
  },
) =>
  Array.from({ length: MAX_LAYER_DEPTH }, (_, index) => {
    const depth = index + 1;
    const isDeepest = depth === MAX_LAYER_DEPTH;
    const folders = '*/'.repeat(index);
    const escape = `^(?:\\.\\.(?:/|$)){${String(depth)}}`;
    const bareAllowed = [...allowed, ...typeOnlyFrom.map((dir) => `@${dir}`)].join('|');
    const escapeAllowed = typeOnlyFrom.map((dir) => `${dir}(?:/|$)`).join('|');
    const typeOnlyMessage = `${message} Use \`import type\` (ADR 0003).`;
    return {
      files: [isDeepest ? `src/${layer}/${folders}**/*.ts` : `src/${layer}/${folders}*.ts`],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { regex: `^(?!(?:${bareAllowed})(?:/|$)|\\.{1,2}(?:/|$))`, message },
              { regex: NON_CANONICAL_RELATIVE, message: 'Use a canonical relative path.' },
              { regex: escapeAllowed ? `${escape}(?!${escapeAllowed})` : escape, message },
              ...typeOnlyFrom.flatMap((dir) => [
                { regex: `^@${dir}(?:/|$)`, allowTypeImports: true, message: typeOnlyMessage },
                {
                  regex: `${escape}${dir}(?:/|$)`,
                  allowTypeImports: true,
                  message: typeOnlyMessage,
                },
              ]),
            ],
          },
        ],
      },
    };
  });

export default defineConfig([
  globalIgnores(['dist/', 'coverage/', 'public/', 'assets-src/', 'node_modules/']),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  // Runtime code: Phaser clock only (CLAUDE.md).
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-globals': ['error', ...timerGlobals, ...storageGlobals],
      'no-restricted-properties': ['error', ...timerProperties, ...storageProperties],
      // With verbatimModuleSyntax, `import { type X }` still emits a runtime import; require `import type`.
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },

  // platform/storage is the one place allowed to touch browser storage.
  {
    files: ['src/platform/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...timerGlobals],
      'no-restricted-properties': ['error', ...timerProperties],
    },
  },

  // plan.md §7.1: core is pure TS. No DOM, Node or platform globals.
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...timerGlobals,
        ...[
          ...globalObjects,
          'document',
          'navigator',
          'localStorage',
          'sessionStorage',
          'requestAnimationFrame',
          'performance',
          'process',
          'Buffer',
        ].map((name) => ({
          name,
          message: 'src/core is pure TypeScript: no DOM or platform access (plan.md §7.1).',
        })),
      ],
      'no-restricted-syntax': ['error', noDynamicImport],
    },
  },
  // plan.md §7.3: core imports only itself. Phaser, upper layers, Node and packages are out.
  ...layerBoundary({
    layer: 'core',
    allowed: ['@core'],
    typeOnlyFrom: [],
    message: 'src/core may import only from @core (plan.md §7.3).',
  }),

  // plan.md §7.3 + ADR 0003: data imports only types from core (plus other data modules).
  {
    files: ['src/data/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', noDynamicImport] },
  },
  ...layerBoundary({
    layer: 'data',
    allowed: ['@data'],
    typeOnlyFrom: ['core'],
    message: 'src/data may import only types from @core (plan.md §7.3, ADR 0003).',
  }),

  prettier,
]);
