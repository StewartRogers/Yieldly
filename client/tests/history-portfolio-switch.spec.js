import { test, expect } from '@playwright/test'
import crypto from 'crypto'
import { signIn } from './helpers/app.js'

/**
 * Regression coverage for the cross-portfolio write fixed in 6ba18a9.
 *
 * SnapshotCell (History.jsx) used to check its local `editing` state before
 * the `!editable` guard, and cells were keyed by year only — so switching the
 * portfolio pill changed props without remounting the open editor. Typing
 * into that stale input and pressing Enter called `handleSave`, which
 * resolves its target portfolio from the *current* selection: edit
 * portfolio A, click portfolio B's pill, type, Enter — and B's month-end
 * value was silently overwritten with A's typed number.
 *
 * The fix reordered the guard and keyed `ValueMatrix` on the selected
 * portfolio (`key={selected}`), so switching pills unmounts the whole matrix
 * — including any half-finished edit — rather than leaving it open under the
 * new portfolio's data. This spec asserts that mechanism directly: an open,
 * un-submitted editor must not survive a portfolio switch, and neither
 * portfolio's stored value may change as a result.
 */
test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('switching portfolios discards an open, unsaved value edit', async ({ page }) => {
  // Two portfolios, each with a known value for the same past month, so a
  // cross-write would be detectable as portfolio B's value turning into
  // portfolio A's typed number.
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase()
  const rrspName = `HistA ${suffix}`
  const tfsaName = `HistB ${suffix}`

  const rrsp = await page.request.post('/api/portfolios', { data: { name: rrspName, code: `A${suffix}` } })
  const tfsa = await page.request.post('/api/portfolios', { data: { name: tfsaName, code: `B${suffix}` } })
  const { id: rrspId } = await rrsp.json()
  const { id: tfsaId } = await tfsa.json()

  // A whole calendar year back is always within the 6-year matrix span and
  // never "future" (disabled), regardless of what month the suite runs in.
  const year = new Date().getFullYear() - 1
  const date = `${year}-06-30`
  const rrspValue = 111111
  const tfsaValue = 222222

  await page.request.put(`/api/portfolios/${rrspId}/value-snapshots/${date}`, { data: { total_value: rrspValue } })
  await page.request.put(`/api/portfolios/${tfsaId}/value-snapshots/${date}`, { data: { total_value: tfsaValue } })

  await page.goto('/history')

  const cellLocator = async (year) => {
    const headerTexts = await page.locator('table.matrix thead th').allTextContents()
    const colIndex = headerTexts.findIndex(t => t.trim() === String(year))
    expect(colIndex).toBeGreaterThan(-1)
    const row = page.locator('table.matrix tbody tr').filter({ hasText: 'Jun' }).first()
    return row.locator('td').nth(colIndex)
  }

  // Select portfolio A, enter edit mode, open the June cell's editor.
  await page.getByRole('button', { name: rrspName, exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await (await cellLocator(year)).click()

  const editorLabel = `Portfolio value for Jun ${year}`
  const editor = page.getByLabel(editorLabel)
  await expect(editor).toBeVisible()

  // Type a new value but never submit it.
  await editor.fill('999999')

  // Switch to portfolio B without saving.
  await page.getByRole('button', { name: tfsaName, exact: true }).click()

  // The stale editor must be gone entirely, not just visually replaced —
  // this is the ValueMatrix remount that makes the old cross-write
  // impossible. Edit mode also resets, matching the pill's own onClick.
  await expect(page.getByLabel(editorLabel)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0)

  // Portfolio B shows its own untouched value — not the typed 999999, and
  // not portfolio A's value.
  await expect(await cellLocator(year)).toContainText('222,222')

  // Switching back confirms the typed-but-unsubmitted edit was discarded
  // outright, not silently persisted into either portfolio.
  await page.getByRole('button', { name: rrspName, exact: true }).click()
  await expect(await cellLocator(year)).toContainText('111,111')
})
