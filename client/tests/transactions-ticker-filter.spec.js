import { test, expect } from '@playwright/test'
import crypto from 'crypto'

// All tests in this file share one server + DB for the whole run (see
// playwright.config.js), so only the first test's beforeEach sees the
// first-run "Create your account" screen — later ones see a normal Sign In.
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Username', { exact: true }).fill('e2euser')
  await page.getByLabel('Password', { exact: true }).fill('e2epassword123')

  const confirmField = page.getByLabel('Confirm password', { exact: true })
  if (await confirmField.isVisible().catch(() => false)) {
    await confirmField.fill('e2epassword123')
    await page.getByRole('button', { name: 'Create Account' }).click()
  } else {
    await page.getByRole('button', { name: 'Sign In' }).click()
  }
  await expect(page.getByRole('link', { name: 'Transactions' })).toBeVisible()

  // Seed a portfolio (unique code per test, since tests share one DB for the
  // run) + transactions across tickers via the API — the subject under test
  // is the filter, not transaction entry (already covered by test-auth.js),
  // so API seeding keeps this test focused and fast.
  // Codes are capped at 5 alphanumeric chars (server-side validation).
  const code = `X${crypto.randomBytes(2).toString('hex').toUpperCase()}`
  const created = await page.request.post('/api/portfolios', { data: { name: 'E2E Test', code } })
  const { id: portfolioId } = await created.json()

  const seed = [
    { ticker: 'AAPL', quantity: 10, price: 150 },
    { ticker: 'AAPL', quantity: 2, price: 160 },
    { ticker: 'MSFT', quantity: 5, price: 300 },
    { ticker: 'GOOG', quantity: 3, price: 120 },
  ]
  for (const s of seed) {
    await page.request.post('/api/transactions', {
      data: {
        portfolio_id: portfolioId, ticker: s.ticker, type: 'BUY',
        quantity: s.quantity, price: s.price, total: s.quantity * s.price,
        date: '2026-01-15', market: 'NASDAQ',
      },
    })
  }

  await page.goto('/transactions')
  // Scope the history table to just this test's portfolio, since other
  // tests' seeded portfolios persist in the shared DB for the run.
  await page.getByRole('button', { name: code }).click()
})

test('filters transaction history by ticker', async ({ page }) => {
  const rows = page.getByRole('table').locator('tbody tr')
  await expect(rows).toHaveCount(4)
  await expect(page.getByText('4 records')).toBeVisible()

  await page.getByLabel('Filter by ticker').fill('AAPL')
  await expect(rows).toHaveCount(2)
  await expect(page.getByText('2 records')).toBeVisible()
  for (const row of await rows.all()) {
    await expect(row.locator('td').first()).toContainText('AAPL')
  }

  await page.getByRole('button', { name: 'Clear ticker filter' }).click()
  await expect(rows).toHaveCount(4)
  await expect(page.getByText('4 records')).toBeVisible()
})

test('ticker filter is case-insensitive and matches partial tickers', async ({ page }) => {
  const rows = page.getByRole('table').locator('tbody tr')

  await page.getByLabel('Filter by ticker').fill('aa')
  await expect(rows).toHaveCount(2)

  await page.getByLabel('Filter by ticker').fill('ZZZ')
  await expect(rows).toHaveCount(0)
  await expect(page.getByText('No transactions yet.')).toBeVisible()
})
