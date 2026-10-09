import { test, expect } from '@playwright/test'
import crypto from 'crypto'
import { signIn, gotoSettled } from './helpers/app.js'

/**
 * Archiving a portfolio: refused while it still holds anything, then hides it
 * from the tabs and the new-transaction picker while its history stays
 * visible (read-only) on Transactions, and Restore brings it back.
 */
test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('archive an emptied portfolio, keep its history, then restore it', async ({ page }) => {
  // Four page loads plus seeding: ~19 s on Chromium and ~27 s on Firefox on
  // the Pi, and WebKit ran past the default 30 s.
  test.setTimeout(90_000)
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase()
  const name = `Closing ${suffix}`
  const code = `Z${suffix}`
  const ok = async (res) => {
    if (!res.ok()) throw new Error(`seed ${res.url()} -> ${res.status()}: ${await res.text()}`)
    return res
  }
  const { id } = await (await ok(await page.request.post('/api/portfolios', { data: { name, code } }))).json()
  const post = (data) => page.request.post('/api/transactions', { data: { portfolio_id: id, ...data } }).then(ok)
  await post({ type: 'CONTRIBUTION', total: 100, date: '2025-01-02' })
  await post({ ticker: 'XYZ', type: 'BUY', quantity: 1, price: 50, total: 50, date: '2025-01-03' })

  // Still holding XYZ and $50 cash: the dialog shows the server's reason.
  await gotoSettled(page, '/portfolios')
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Archive portfolio' }).click()
  await expect(dialog.getByRole('alert')).toContainText('XYZ')
  await expect(dialog.getByRole('alert')).toContainText('$50.00')
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // Empty it, then archive for real.
  await post({ ticker: 'XYZ', type: 'SELL', quantity: 1, price: 50, total: 50, date: '2025-02-01' })
  await post({ type: 'WITHDRAWAL', total: 100, date: '2025-02-02' })
  await gotoSettled(page, '/portfolios')
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Archive portfolio' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: `Restore ${name}` })).toBeVisible()

  // Transactions: history kept and read-only, not offered for new entries.
  await gotoSettled(page, '/transactions')
  await page.getByRole('button', { name: `${code} · archived` }).click()
  await expect(page.locator('table.tbl tbody tr')).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Delete transaction' })).toHaveCount(0)
  await page.locator('#tx-portfolio').click()
  await expect(page.getByRole('option').first()).toBeVisible()
  await expect(page.getByRole('option', { name: new RegExp(code) })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Restore puts it back in the tabs.
  await gotoSettled(page, '/portfolios')
  await page.getByRole('button', { name: `Restore ${name}` }).click()
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
})
