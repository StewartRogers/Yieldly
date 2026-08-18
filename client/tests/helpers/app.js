/**
 * Shared setup for the browser suites.
 *
 * All specs run against one server + one libSQL file for the whole run (see
 * playwright.config.js), and now across three engine projects, so anything
 * seeded here has to be idempotent-ish: `signIn` copes with both the
 * first-run "Create your account" screen and the ordinary sign-in form, and
 * `seedPortfolio` mints a unique portfolio code per call so repeat runs
 * never collide on the `portfolios.code` unique constraint.
 */
import crypto from 'crypto'

export const USERNAME = 'e2euser'
export const PASSWORD = 'e2epassword123'

/** Signs in, creating the superuser if this is the first spec of the run. */
export async function signIn(page) {
  await page.goto('/')

  // App.jsx renders a "Loading..." screen while it checks the session, so we
  // cannot test for either outcome until that resolves. Wait for whichever
  // lands: the nav (already authenticated via the saved storageState) or the
  // login form (the `setup` project, which starts cold).
  const nav = page.getByRole('link', { name: 'Transactions' })
  const username = page.getByLabel('Username', { exact: true })
  await nav.or(username).first().waitFor({ state: 'visible', timeout: 30_000 })
  if (await nav.isVisible()) return

  await username.fill(USERNAME)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)

  const confirmField = page.getByLabel('Confirm password', { exact: true })
  if (await confirmField.isVisible().catch(() => false)) {
    await confirmField.fill(PASSWORD)
    await page.getByRole('button', { name: 'Create Account' }).click()
  } else {
    await page.getByRole('button', { name: 'Sign In' }).click()
  }
  await page.getByRole('link', { name: 'Transactions' }).waitFor({ timeout: 30_000 })
}

/**
 * Creates one portfolio with holdings, dividends and a cash balance, via the
 * API rather than the UI — these suites are about layout, not data entry.
 * Returns { id, code }.
 */
export async function seedPortfolio(page, { name = 'E2E Test' } = {}) {
  const code = `X${crypto.randomBytes(2).toString('hex').toUpperCase()}`
  const created = await page.request.post('/api/portfolios', { data: { name, code } })
  const { id } = await created.json()

  const tx = [
    { ticker: 'AAPL',      type: 'BUY',      quantity: 120, price: 150.25, date: '2025-02-10', market: 'NASDAQ' },
    { ticker: 'AAPL',      type: 'DIVIDEND', quantity: 120, price: 0.24,   date: '2025-05-12', market: 'NASDAQ' },
    { ticker: 'MSFT',      type: 'BUY',      quantity: 45,  price: 402.80, date: '2025-03-04', market: 'NASDAQ' },
    { ticker: 'MSFT',      type: 'SELL',     quantity: 15,  price: 441.10, date: '2025-09-18', market: 'NASDAQ' },
    { ticker: 'REI-UN.TO', type: 'BUY',      quantity: 500, price: 17.65,  date: '2025-01-22', market: 'TSX' },
    { ticker: 'REI-UN.TO', type: 'DIVIDEND', quantity: 500, price: 0.09,   date: '2025-06-30', market: 'TSX' },
  ]
  for (const t of tx) {
    await page.request.post('/api/transactions', {
      data: { portfolio_id: id, total: t.quantity * t.price, commission: 4.95, ...t },
    })
  }

  await page.request.put(`/api/portfolios/${id}/cash-balance`, { data: { cash_balance: 12450.75 } })
  return { id, code }
}
