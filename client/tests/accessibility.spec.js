/**
 * Every interactive control must expose an accessible name.
 *
 * The forms in this app labelled their fields with bare <label>Quantity</label>
 * elements — visually correct, but with no `htmlFor` and no wrapping, so
 * nothing associated them with their input. A screen reader announced those
 * fields as unlabelled, and clicking the label did not focus the field.
 *
 * Runs on all three engines because accessible-name computation is the
 * browser's job, not the app's, and the engines do not always agree.
 */
import { test, expect } from '@playwright/test'
import { signIn } from './helpers/app.js'

const PAGES = ['/', '/summary', '/history', '/dividends', '/portfolios', '/transactions', '/import']

/**
 * Reports visible form controls with no accessible name, checking the same
 * sources a browser uses: aria-label, aria-labelledby, a <label for=...>, an
 * ancestor <label>, or (for buttons) the element's own text.
 */
async function unnamedControls(page) {
  return page.evaluate(() => {
    const out = []
    const sel = 'input:not([type=hidden]), select, textarea, button, [role=combobox]'
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      if (r.width < 8 || r.height < 8) continue          // hidden/proxy inputs
      if (getComputedStyle(el).visibility === 'hidden') continue
      if (el.closest('[aria-hidden="true"]')) continue

      const named =
        el.getAttribute('aria-label')?.trim() ||
        el.getAttribute('aria-labelledby')?.trim() ||
        el.getAttribute('title')?.trim() ||
        (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
        el.closest('label') ||
        (el.tagName === 'BUTTON' && el.textContent.trim())

      if (!named) {
        out.push(`<${el.tagName.toLowerCase()}${el.type ? ` type=${el.type}` : ''}${el.id ? ` id=${el.id}` : ''}> "${(el.placeholder || el.textContent || '').trim().slice(0, 30)}"`)
      }
    }
    return out
  })
}

test('every visible form control has an accessible name', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page)
  const failures = []
  for (const path of PAGES) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const unnamed = await unnamedControls(page)
    if (unnamed.length) failures.push(`${path}:\n      ${unnamed.join('\n      ')}`)
  }
  expect(failures.join('\n')).toBe('')
})

test('clicking a form label focuses its field', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page)
  await page.goto('/transactions')

  // The behavioural half of the fix: association, not just an ARIA string.
  await page.getByText('Quantity', { exact: true }).click()
  await expect(page.locator('#tx-quantity')).toBeFocused()

  await page.getByText('Commission', { exact: true }).click()
  await expect(page.locator('#tx-commission')).toBeFocused()
})

test('form fields are reachable by their label text', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page)
  await page.goto('/transactions')

  // getByLabel only resolves once label and control are actually associated,
  // so these locators are themselves the assertion.
  await page.getByLabel('Quantity', { exact: true }).fill('12')
  await page.getByLabel('Price / share', { exact: true }).fill('34.5')
  await expect(page.getByLabel('Total (auto)', { exact: true })).toHaveValue('414.00')

  await expect(page.getByLabel('Portfolio', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Type', { exact: true })).toBeVisible()
})
