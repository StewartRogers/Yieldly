const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:2080';
const OUT  = path.join(__dirname, 'button-audit-screenshots');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page    = await ctx.newPage();

  // Home — zoom in on the CTA buttons and chat Send button
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const homeCtaBox = await page.locator('text=View Summary').boundingBox();
  if (homeCtaBox) {
    await page.screenshot({ path: path.join(OUT, 'home-cta-zoom.png'), clip: { x: homeCtaBox.x - 40, y: homeCtaBox.y - 20, width: 500, height: 80 } });
  }
  const sendBox = await page.locator('button:has-text("Send")').boundingBox();
  if (sendBox) {
    await page.screenshot({ path: path.join(OUT, 'home-send-zoom.png'), clip: { x: sendBox.x - 60, y: sendBox.y - 20, width: 200, height: 80 } });
  }

  // Summary — zoom on Refresh All Prices button
  await page.goto(BASE + '/summary', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const summaryBtnBox = await page.locator('button:has-text("Refresh All Prices")').first().boundingBox();
  if (summaryBtnBox) {
    await page.screenshot({ path: path.join(OUT, 'summary-btn-zoom.png'), clip: { x: summaryBtnBox.x - 20, y: summaryBtnBox.y - 20, width: 280, height: 80 } });
  }

  // Portfolios — zoom on header buttons
  await page.goto(BASE + '/portfolios', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const pfHeadBox = await page.locator('.page-head').first().boundingBox();
  if (pfHeadBox) {
    await page.screenshot({ path: path.join(OUT, 'portfolios-head-zoom.png'), clip: { x: 0, y: pfHeadBox.y, width: 1440, height: pfHeadBox.height + 20 } });
  }
  // Zoom on a single holding card footer buttons
  const cardFootBox = await page.locator('.hold .foot').first().boundingBox();
  if (cardFootBox) {
    await page.screenshot({ path: path.join(OUT, 'portfolios-card-btns-zoom.png'), clip: { x: cardFootBox.x - 10, y: cardFootBox.y - 10, width: 260, height: 60 } });
  }

  // Transactions — zoom on the form submit button and table delete buttons
  await page.goto(BASE + '/transactions', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const txFormBox = await page.locator('button:has-text("Add transaction")').boundingBox();
  if (txFormBox) {
    await page.screenshot({ path: path.join(OUT, 'transactions-submit-zoom.png'), clip: { x: txFormBox.x - 20, y: txFormBox.y - 10, width: 360, height: 60 } });
  }

  // Import — zoom on all buttons
  await page.goto(BASE + '/import', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const chooseBtnBox = await page.locator('button:has-text("Choose file")').boundingBox();
  if (chooseBtnBox) {
    await page.screenshot({ path: path.join(OUT, 'import-choose-zoom.png'), clip: { x: chooseBtnBox.x - 20, y: chooseBtnBox.y - 20, width: 300, height: 80 } });
  }
  const downloadBtnBox = await page.locator('button:has-text("Download template")').boundingBox();
  if (downloadBtnBox) {
    await page.screenshot({ path: path.join(OUT, 'import-download-zoom.png'), clip: { x: downloadBtnBox.x - 20, y: downloadBtnBox.y - 20, width: 360, height: 80 } });
  }

  await browser.close();
  console.log('Zoom screenshots done');
})();
