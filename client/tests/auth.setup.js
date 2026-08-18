/**
 * One-time authentication for the whole run.
 *
 * The app rate-limits /api/auth/login to 10 attempts per 15 minutes — a real
 * security control, and not one worth weakening for tests. Signing in inside
 * every spec across three engine projects blew straight through it and every
 * test after the tenth failed waiting for a nav link that never rendered.
 *
 * So log in exactly once here, save the JWT cookie, and let every project
 * start already authenticated via `storageState`.
 */
import { test as setup } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'
import { signIn, seedPortfolio } from './helpers/app.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))
export const STATE_FILE = path.join(dirname, '.auth', 'state.json')

setup('authenticate and seed', async ({ page }) => {
  setup.setTimeout(120_000)
  await signIn(page)
  // Shared fixture data for the layout suite: one account with holdings in
  // three tickers, dividends, a sale and a cash balance, so the tables and
  // KPI tiles have realistic content to lay out.
  await seedPortfolio(page, { name: 'Layout RRSP' })
  await page.context().storageState({ path: STATE_FILE })
})
