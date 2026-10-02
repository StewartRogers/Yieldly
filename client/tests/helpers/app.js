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
  if (await nav.isVisible()) return settle(page)

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
  await settle(page)
}

// The nav renders before Home's data requests finish. Returning then let the
// caller's next page.goto() abort them mid-flight — App logs the aborted
// getPortfolios() as a console error (failing the no-console-errors check),
// and WebKit reports the goto itself as "interrupted by another navigation".
// Which engine hit it varied run to run, so let the page go quiet first.
async function settle(page) {
  await page.waitForLoadState('networkidle')
}

/**
 * Navigates and waits until the app has actually loaded, not just gone quiet.
 *
 * `networkidle` alone is not enough on a slow machine: after the module
 * requests finish, the browser can spend >500 ms executing the dev bundle
 * with no network traffic at all, which counts as idle. The next goto then
 * lands just as App starts its session check + getPortfolios(), aborts them,
 * and App logs the aborted fetch as a console error. The nav only renders
 * once the session check resolves, so wait for it first — by then
 * getPortfolios() is already in flight and networkidle waits it out.
 */
export async function gotoSettled(page, path) {
  await page.goto(path)
  await page.getByRole('link', { name: 'Transactions' }).waitFor({ timeout: 30_000 })
  await settle(page)
}

/**
 * Creates one portfolio with holdings, dividends and a cash balance, via the
 * API rather than the UI — these suites are about layout, not data entry.
 * Returns { id, code }.
 */
export async function seedPortfolio(page, { name = 'E2E Test' } = {}) {
  const code = `X${crypto.randomBytes(2).toString('hex').toUpperCase()}`
  // Every seed request must succeed: a rejected row used to be ignored, which
  // left the DB empty and surfaced minutes later as an unrelated-looking
  // timeout waiting for a table that never rendered.
  const ok = async (res) => {
    if (!res.ok()) throw new Error(`seed ${res.url()} -> ${res.status()}: ${await res.text()}`)
    return res
  }
  const created = await ok(await page.request.post('/api/portfolios', { data: { name, code } }))
  const { id } = await created.json()

  // A BUY is rejected if the account can't afford it, so fund it first. The
  // final balance is set explicitly below.
  await ok(await page.request.put(`/api/portfolios/${id}/cash-balance`, { data: { cash_balance: 100000 } }))

  const tx = [
    { ticker: 'AAPL',      type: 'BUY',      quantity: 120, price: 150.25, date: '2025-02-10', market: 'NASDAQ' },
    { ticker: 'AAPL',      type: 'DIVIDEND', quantity: 120, price: 0.24,   date: '2025-05-12', market: 'NASDAQ' },
    { ticker: 'MSFT',      type: 'BUY',      quantity: 45,  price: 402.80, date: '2025-03-04', market: 'NASDAQ' },
    { ticker: 'MSFT',      type: 'SELL',     quantity: 15,  price: 441.10, date: '2025-09-18', market: 'NASDAQ' },
    { ticker: 'REI-UN.TO', type: 'BUY',      quantity: 500, price: 17.65,  date: '2025-01-22', market: 'TMX' },
    { ticker: 'REI-UN.TO', type: 'DIVIDEND', quantity: 500, price: 0.09,   date: '2025-06-30', market: 'TMX' },
  ]
  for (const t of tx) {
    await ok(await page.request.post('/api/transactions', {
      data: { portfolio_id: id, total: t.quantity * t.price, commission: 4.95, ...t },
    }))
  }

  await ok(await page.request.put(`/api/portfolios/${id}/cash-balance`, { data: { cash_balance: 12450.75 } }))
  return { id, code }
}
