import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@core': fromRoot('./src/core'),
      '@data': fromRoot('./src/data'),
      '@game': fromRoot('./src/game'),
      '@platform': fromRoot('./src/platform'),
    },
  },
  build: {
    target: 'es2022',
    // Phaser is a single large module; it is expected to exceed the default 500 kB warning.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
