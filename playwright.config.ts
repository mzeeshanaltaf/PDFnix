import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests drive the Electron app (tests/e2e).
 *
 * - `pnpm test:e2e` (project "dev") runs everything against the built app in
 *   out/ (`pnpm build` first), with the engine started from engine/ through uv.
 * - `pnpm test:e2e:packaged` (project "packaged") runs the tests tagged @smoke
 *   against the packaged app in release/win-unpacked (`pnpm dist:dir` first)
 *   and its frozen engine.
 *
 * Each test starts its own app with a throwaway profile; the app is a single
 * instance per profile, so tests run one at a time.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'dev' },
    { name: 'packaged', grep: /@smoke/ },
    // `pnpm test:perf`: the large-file check (writes ~500 MB, takes minutes).
    { name: 'perf', testDir: 'tests/perf' }
  ]
})
