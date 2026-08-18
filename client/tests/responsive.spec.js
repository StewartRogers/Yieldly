/**
 * Layout suite: every page must fit its viewport at phone, tablet and desktop
 * widths, on all three engines (see `projects` in playwright.config.js).
 *
 * The single assertion that matters is "the document never scrolls
 * horizontally". A page wider than the phone it is on is the failure mode
 * this app actually had: wide financial tables pushed <body> out, so every
 * page — nav included — slid sideways and the right-hand columns of every
 * table were unreachable. Wide content is allowed, but it has to scroll
 * inside its own container, which is exactly what this check enforces.
 */
import { test, expect } from '@playwright/test'
import { signIn } from './helpers/app.js'

const VIEWPORTS = [
  { name: 'phone',   width: 390,  height: 844 },
  { name: 'tablet',  width: 768,  height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]

const PAGES = [
  { path: '/',             ready: 'Track every share' },
  { path: '/summary',      ready: 'Portfolio overview' },
  { path: '/history',      ready: 'History' },
  { path: '/dividends',    ready: 'Dividend' },
  { path: '/portfolios',   ready: 'Portfolios' },
  { path: '/transactions', ready: 'Transaction' },
  { path: '/import',       ready: 'Import' },
]

/**
 * Returns the elements sticking out past the right edge of the viewport,
 * ignoring anything that lives inside a horizontally scrollable container
 * (a wide table in a `.tbl-wrap` is fine — that is the intended design) and
 * anything explicitly clipped by an `overflow: hidden` ancestor.
 */
async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth
    const scrolls = (el) => {
      const s = getComputedStyle(el)
      return /auto|scroll|hidden/.test(s.overflowX)
    }
    const offenders = []
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right <= docWidth + 1) continue
      // Ignore descendants of a scroll/clip container — their overflow is
      // handled by that container, not by the page.
      let p = el.parentElement, contained = false
      while (p && p !== document.body) {
        if (scrolls(p)) { contained = true; break }
        p = p.parentElement
      }
      if (contained) continue
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
        right: Math.round(r.right),
        width: Math.round(r.width),
      })
    }
    return {
      docWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: offenders.slice(0, 12),
    }
  })
}

test.describe('responsive layout', () => {
  // WebKit on Windows is markedly slower to first paint than the other two.
  test.setTimeout(90_000)

  for (const vp of VIEWPORTS) {
    test(`no horizontal page scroll at ${vp.name} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await signIn(page)

      const failures = []
      for (const p of PAGES) {
        await page.goto(p.path)
        await page.getByText(p.ready, { exact: false }).first().waitFor({ timeout: 10_000 })
        // Let fonts/late layout settle before measuring.
        await page.waitForTimeout(150)

        const { docWidth, scrollWidth, offenders } = await horizontalOverflow(page)
        if (scrollWidth > docWidth + 1) {
          failures.push(
            `${p.path}: document scrolls to ${scrollWidth}px in a ${docWidth}px viewport\n` +
            offenders.map(o => `      ${o.tag}.${o.cls} (w=${o.width}, right=${o.right})`).join('\n')
          )
        }
      }
      expect(failures.join('\n'), `Pages overflowing at ${vp.width}px`).toBe('')
    })
  }

  test('primary navigation is reachable on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    for (const name of ['Summary', 'Portfolios', 'Transactions', 'Import Data']) {
      const link = page.getByRole('link', { name, exact: true })
      await link.scrollIntoViewIfNeeded()
      await expect(link).toBeVisible()
    }
  })
})
