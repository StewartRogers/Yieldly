import { defineConfig, devices } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const configDir = path.dirname(fileURLToPath(import.meta.url))
const storageState = path.join(configDir, 'tests', '.auth', 'state.json')

// Isolated per-run libSQL file so E2E tests never touch the developer's real
// yieldly.db. libSQL's Windows backend needs the file to already exist
// before it can open it (createDb() will apply migrations to it on boot).
const dbPath = path
  .join(os.tmpdir(), `yieldly-e2e-${crypto.randomBytes(6).toString('hex')}.db`)
  .split(path.sep).join('/')
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, '')

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  // One worker, not one per project. Every spec shares a single server and a
  // single libSQL file, so parallel projects raced each other through the
  // first-run "Create your account" flow — two workers both POSTed
  // /api/auth/setup, one got an error and hung waiting for a nav link.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:2080',
    trace: 'retain-on-failure',
  },
  // Every suite runs against all three engines. WebKit is the only way to
  // catch Safari-specific layout bugs without a Mac — several of the fixes
  // in style.css (sticky cells under border-collapse, dvh units) exist
  // solely because this project surfaced them.
  //
  // Viewport widths are set inside the specs (page.setViewportSize) rather
  // than via Playwright's `devices` presets: the mobile presets set
  // `isMobile`/`hasTouch`, which Firefox does not support and which would
  // make the Firefox project fail to start.
  //
  // The `setup` project logs in once and saves the JWT cookie; the engine
  // projects depend on it and start authenticated. Without this, ~20
  // sign-ins across three engines tripped the app's own login rate limit
  // (10 per 15 min) and everything after the tenth failed.
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'],  storageState }, dependencies: ['setup'] },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'], storageState }, dependencies: ['setup'] },
    { name: 'webkit',   use: { ...devices['Desktop Safari'],  storageState }, dependencies: ['setup'] },
  ],
  // Boots the real server + client against the isolated DB above. If ports
  // 2080/2085 are already in use (e.g. your own `npm run dev` is running
  // against the real DB), stop that first — this always starts a fresh
  // instance rather than reusing whatever is already listening, so a test
  // run can never attach to your real dev server by accident.
  webServer: {
    command: 'npm run dev',
    cwd: '..',
    url: 'http://localhost:2080',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      TURSO_DATABASE_URL: `file:${dbPath}`,
      SESSION_SECRET: 'playwright-e2e-secret-do-not-use-in-prod',
      // Without this, server.js falls back to the real portfolios.json —
      // restoring real portfolio names into this throwaway DB and then
      // overwriting the real backup file with this run's test data.
      PORTFOLIOS_BACKUP_PATH: `${dbPath}.portfolios-backup.json`,
    },
  },
})
