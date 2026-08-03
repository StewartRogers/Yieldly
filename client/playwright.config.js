import { defineConfig } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

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
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:2080',
    trace: 'retain-on-failure',
  },
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
