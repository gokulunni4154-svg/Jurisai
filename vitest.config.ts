import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Root Vitest configuration.
 *
 * WHY THIS EXISTS: package.json (File 1) already defines `test` /
 * `test:watch` / `test:coverage` scripts and has every Vitest-related
 * devDependency installed — but Vitest has no config file telling it
 * where test files live, which DOM environment to run them in, or how to
 * resolve the project's `@/` → `src/` path alias. Without this file,
 * `pnpm test` falls back to Vitest's defaults, which don't match this
 * project's conventions and would silently fail to resolve `@/` imports
 * in every test file (including File 41's, and this project's stated
 * convention throughout).
 *
 * ENVIRONMENT: 'jsdom' is set globally, not per-file. File 41's tests are
 * pure logic (Zod schemas) and don't need a DOM — but @testing-library/react
 * and @testing-library/jest-dom are already installed devDependencies,
 * signaling component tests are coming. Setting jsdom globally means
 * future component tests work without each one needing a per-file
 * `// @vitest-environment jsdom` pragma. TRADEOFF, stated honestly: this
 * adds jsdom's setup overhead to every test file, including pure-logic
 * ones like File 41's, which don't need it. For a test suite of this
 * project's current size that overhead is negligible; if the suite grows
 * large enough for it to matter, per-file environment pragmas on the
 * logic-only tests (reverting to 'node' for those) is the documented
 * escape hatch — not done preemptively here, per KISS.
 *
 * PATH ALIAS: mirrors the `@/` → `src/` alias established in tsconfig.json
 * (File 2) and used throughout every module so far. Resolved directly via
 * Vite's `resolve.alias`, independent of tsconfig — Vitest does not read
 * tsconfig path mappings automatically without an additional plugin
 * (e.g. vite-tsconfig-paths), and adding a whole plugin dependency for a
 * single, stable, one-entry alias is unnecessary; a direct alias here is
 * simpler and has one less moving part to break.
 *
 * TEST FILE MATCHING: only `*.test.ts(x)` / `*.spec.ts(x)` under `src/`,
 * consistent with File 41's naming (`auth.schemas.test.ts`) and colocated
 * next to the source it tests rather than in a separate top-level test
 * tree — keeping a schema and its test file adjacent makes drift between
 * them easier to notice during review.
 *
 * PLAYWRIGHT EXCLUSION: `e2e/**` and any `*.e2e.ts` files are excluded.
 * Playwright (`test:e2e` in File 1) has its own runner and its own future
 * `playwright.config.ts` — Vitest must never attempt to execute Playwright
 * spec files, which use an incompatible test API.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      '**/e2e/**',
      '**/*.e2e.{ts,tsx}',
    ],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/core/supabase/database.types.ts',
        'src/app/**/layout.tsx',
        'src/app/**/page.tsx',
        '**/*.d.ts',
      ],
      // Deliberately modest starting thresholds, not a placeholder — this
      // is a real, enforced floor, just a low one given the codebase's
      // current size (Files 1–42, one test file so far). Ratcheting these
      // up as coverage genuinely grows is expected; setting them
      // aspirationally high now would just make `pnpm validate` (File 1)
      // fail immediately and get bypassed or disabled out of frustration,
      // which is worse than an honest, currently-low bar.
      thresholds: {
        statements: 30,
        branches: 30,
        functions: 30,
        lines: 30,
      },
    },
  },
});