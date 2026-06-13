const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:2080';
const OUT  = path.join(__dirname, 'button-audit-screenshots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

const pages = [
  { name: 'home',         url: '/'             },
  { name: 'summary',      url: '/summary'      },
  { name: 'dividends',    url: '/dividends'    },
  { name: 'portfolios',   url: '/portfolios'   },
  { name: 'transactions', url: '/transactions' },
  { name: 'import',       url: '/import'       },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page    = await ctx.newPage();

  for (const { name, url } of pages) {
    await page.goto(BASE + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    console.log(`✓ ${name}`);

    // Log any buttons whose scroll width exceeds client width (text overflow)
    const overflowing = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, [role="button"], a.tc-btn'));
      return btns
        .filter(b => b.scrollWidth > b.clientWidth + 2)
        .map(b => ({
          text:        b.innerText.trim().slice(0, 80),
          scrollWidth: b.scrollWidth,
          clientWidth: b.clientWidth,
        }));
    });
    if (overflowing.length) {
      console.log(`  ⚠️  Overflowing buttons on /${name}:`);
      overflowing.forEach(b => console.log(`     "${b.text}" — clientW=${b.clientWidth} scrollW=${b.scrollWidth}`));
    }
  }

  await browser.close();
  console.log('\nScreenshots saved to:', OUT);
})();
