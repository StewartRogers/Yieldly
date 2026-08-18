/**
 * Engine-behaviour suite: things that differ between Chrome, Firefox and
 * Safari and that the layout suite cannot see.
 *
 * Runs under all three projects (see playwright.config.js). WebKit is the
 * stand-in for Safari — the only way to catch Safari-specific breakage
 * without a Mac.
 */
import { test, expect } from '@playwright/test'
import { signIn } from './helpers/app.js'

const PAGES = ['/', '/summary', '/history', '/dividends', '/portfolios', '/transactions', '/import']

test('every page renders without console or page errors', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))

  await signIn(page)
  for (const path of PAGES) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  }
  expect(errors.join('\n')).toBe('')
})

test('wide tables scroll inside their own container', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page)
  await page.goto('/transactions')
  await page.getByRole('table').first().waitFor()

  // The point of .tbl-wrap: the table may be wider than the phone, but that
  // width has to stay inside the wrapper rather than widening the document.
  const geom = await page.evaluate(() => {
    const wrap = document.querySelector('.tbl-wrap')
    return {
      wrapClient: wrap.clientWidth,
      wrapScroll: wrap.scrollWidth,
      docClient: document.documentElement.clientWidth,
      docScroll: document.documentElement.scrollWidth,
    }
  })
  expect(geom.wrapClient).toBeLessThanOrEqual(geom.docClient)
  expect(geom.docScroll).toBeLessThanOrEqual(geom.docClient + 1)

  // And it must actually be scrollable when the content overflows.
  if (geom.wrapScroll > geom.wrapClient) {
    const scrolled = await page.evaluate(() => {
      const wrap = document.querySelector('.tbl-wrap')
      wrap.scrollLeft = 9999
      return wrap.scrollLeft
    })
    expect(scrolled).toBeGreaterThan(0)
  }
})

test('the active nav tab is brought into view on a phone', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page)

  // "Import Data" is the last of seven links, so it starts well off the right
  // edge of the scrolling nav strip.
  await page.getByRole('link', { name: 'Import Data' }).click()
  await expect(page.getByRole('heading', { name: /import/i }).first()).toBeVisible()

  // scrollIntoView({ behavior: 'smooth' }) animates, so poll rather than
  // measuring once — a single read right after navigation catches the strip
  // mid-scroll and fails intermittently (seen on Firefox).
  await expect.poll(
    () => page.evaluate(() => {
      const strip = document.querySelector('.app-nav-links')
      const active = strip?.querySelector('.app-nav-link--active')
      if (!active) return null
      const s = strip.getBoundingClientRect(), a = active.getBoundingClientRect()
      return a.left >= s.left - 1 && a.right <= s.right + 1
    }),
    { message: 'active nav tab should be scrolled into the visible part of the strip', timeout: 10_000 },
  ).toBe(true)
})

test('form controls stay inside their column on a phone', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page)
  await page.goto('/transactions')

  // Located structurally, not by label: the .tc-field labels in these forms
  // are bare <label> elements with no htmlFor, so getByLabel cannot see them.
  // (Worth fixing for screen-reader users, but that is a separate change.)
  const fields = page.locator('form .tc-field input')
  await fields.first().waitFor()

  // Safari sizes date and number inputs from their intrinsic content rather
  // than from the box they are in, so these are exactly the controls that
  // spill out of a narrow column if a width is not forced.
  const overflowing = await fields.evaluateAll(els => els
    .filter(el => {
      const r = el.getBoundingClientRect()
      // Skip the 1px hidden inputs Base UI's <Select> renders to carry the
      // form value — they are not laid-out controls.
      if (r.width < 8) return false
      const p = el.closest('.tc-field').getBoundingClientRect()
      return r.right > p.right + 1 || r.left < p.left - 1
    })
    .map(el => `${el.type}: ${Math.round(el.getBoundingClientRect().width)}px`))

  expect(overflowing.join(', '), 'inputs wider than their .tc-field column').toBe('')
})
