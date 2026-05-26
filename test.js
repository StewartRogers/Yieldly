'use strict';

/**
 * Yieldly Math Validation Test Suite
 *
 * Runs entirely against an in-memory SQLite database — no server needed,
 * no data written to yieldly.db. Safe to run at any time.
 *
 * Usage:  node test.js
 */

const Database = require('better-sqlite3');
const { computeHoldings } = require('./lib/compute');

// ─── In-memory database setup ────────────────────────────────────────────────

const db = new Database(':memory:');

db.exec(`
  CREATE TABLE portfolios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    display_order INTEGER DEFAULT 0
  );
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portfolio_id INTEGER NOT NULL,
    ticker TEXT NOT NULL,
    type TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    commission REAL DEFAULT 0,
    date TEXT NOT NULL DEFAULT '2024-01-01'
  );
  CREATE TABLE stock_info (
    portfolio_id INTEGER NOT NULL,
    ticker TEXT NOT NULL,
    market_price REAL,
    dividend_yield REAL,
    dividend_frequency TEXT,
    dividend_per_share REAL,
    last_dividend_date TEXT,
    sector TEXT,
    investment_type TEXT,
    PRIMARY KEY (portfolio_id, ticker)
  );
`);

// ─── Helpers ─────────────────────────────────────────────────────────────────

let nextPortfolioId = 1;

function makePortfolio(code = 'TST') {
  db.prepare('INSERT INTO portfolios (id, name, code) VALUES (?, ?, ?)').run(nextPortfolioId, code, code);
  return nextPortfolioId++;
}

function buy(pid, ticker, qty, price, commission = 0) {
  db.prepare('INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total, commission) VALUES (?,?,?,?,?,?,?)')
    .run(pid, ticker, 'BUY', qty, price, qty * price, commission);
}

function sell(pid, ticker, qty, price, commission = 0) {
  db.prepare('INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total, commission) VALUES (?,?,?,?,?,?,?)')
    .run(pid, ticker, 'SELL', qty, price, qty * price, commission);
}

function drip(pid, ticker, qty, price) {
  db.prepare('INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total) VALUES (?,?,?,?,?,?)')
    .run(pid, ticker, 'DIVIDEND_REINVEST', qty, price, qty * price);
}

function dividend(pid, ticker, amount) {
  db.prepare('INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total) VALUES (?,?,?,?,?,?)')
    .run(pid, ticker, 'DIVIDEND', 0, 0, amount);
}

function setInfo(pid, ticker, fields) {
  const keys = Object.keys(fields);
  const placeholders = keys.map(k => `${k} = excluded.${k}`).join(', ');
  db.prepare(`
    INSERT INTO stock_info (portfolio_id, ticker, ${keys.join(', ')})
    VALUES (${[pid, `'${ticker}'`, ...keys.map(() => '?')].join(', ')})
    ON CONFLICT(portfolio_id, ticker) DO UPDATE SET ${placeholders}
  `).run(...keys.map(k => fields[k]));
}

// ─── Holdings query (mirrors server.js queryHoldings) ────────────────────────

function query(portfolioId) {
  const where = portfolioId ? `WHERE t.portfolio_id = ${portfolioId}` : '';
  return db.prepare(`
    SELECT
      p.code AS portfolio_code, p.name AS portfolio_name, t.ticker,
      SUM(CASE WHEN t.type IN ('BUY','DIVIDEND_REINVEST') THEN t.quantity
               WHEN t.type = 'SELL' THEN -t.quantity ELSE 0 END) AS shares,
      SUM(CASE WHEN t.type IN ('BUY','DIVIDEND_REINVEST') THEN t.quantity ELSE 0 END) AS shares_bought,
      SUM(CASE WHEN t.type = 'SELL' THEN t.quantity ELSE 0 END) AS shares_sold,
      SUM(CASE WHEN t.type IN ('BUY','DIVIDEND_REINVEST') THEN t.total ELSE 0 END) AS buy_total,
      SUM(CASE WHEN t.type = 'SELL' THEN t.total ELSE 0 END) AS sale_total,
      SUM(CASE WHEN t.type = 'DIVIDEND' THEN t.total ELSE 0 END) AS dividends_paid,
      SUM(CASE WHEN t.type IN ('BUY','DIVIDEND_REINVEST') THEN t.total ELSE 0 END) /
        NULLIF(SUM(CASE WHEN t.type IN ('BUY','DIVIDEND_REINVEST') THEN t.quantity ELSE 0 END), 0) AS buy_price,
      SUM(CASE WHEN t.type = 'SELL' THEN t.total ELSE 0 END) /
        NULLIF(SUM(CASE WHEN t.type = 'SELL' THEN t.quantity ELSE 0 END), 0) AS sale_price,
      COUNT(CASE WHEN t.type IN ('BUY','DIVIDEND_REINVEST') THEN 1 END) AS buy_count,
      COUNT(CASE WHEN t.type = 'SELL' THEN 1 END) AS sell_count,
      SUM(CASE WHEN t.type IN ('BUY','DIVIDEND_REINVEST') THEN COALESCE(t.commission,0) ELSE 0 END) AS buy_expense,
      SUM(CASE WHEN t.type = 'SELL' THEN COALESCE(t.commission,0) ELSE 0 END) AS sale_expense,
      s.market_price, s.dividend_yield, s.dividend_frequency,
      s.dividend_per_share, s.last_dividend_date, s.sector, s.investment_type
    FROM transactions t
    JOIN portfolios p ON t.portfolio_id = p.id
    LEFT JOIN stock_info s ON s.portfolio_id = t.portfolio_id AND s.ticker = t.ticker
    ${where}
    GROUP BY t.portfolio_id, t.ticker
    HAVING shares > 0
    ORDER BY p.code, t.ticker
  `).all();
}

function getHoldings(portfolioId) {
  return computeHoldings(query(portfolioId));
}

// ─── Assertion helpers ────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function check(label, actual, expected, tolerance = 0.005) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       expected ${expected.toFixed(4)}, got ${actual.toFixed(4)}`);
    failed++;
  }
}

function checkEq(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       expected "${expected}", got "${actual}"`);
    failed++;
  }
}

function section(title) { console.log(`\n── ${title} ${'─'.repeat(50 - title.length)}`); }

// ─── Test scenarios ───────────────────────────────────────────────────────────

// ── 1. Simple buy ─────────────────────────────────────────────────────────────
section('1. Simple Buy');
{
  const pid = makePortfolio('T1');
  buy(pid, 'XEI.TO', 100, 25.00);
  const [h] = getHoldings(pid);

  check('shares = 100',         h.shares,      100);
  check('buy_price = $25.00',   h.buy_price,   25.00);
  check('buy_total = $2500',    h.buy_total,   2500);
  checkEq('buy_count = 1',      h.buy_count,   1);
  check('acb = $2500',          h.acb,         2500);
}

// ── 2. Weighted average buy price (two buys at different prices) ───────────────
section('2. Weighted Average Buy Price');
{
  const pid = makePortfolio('T2');
  buy(pid, 'BNS.TO', 100, 20.00);   // $2000
  buy(pid, 'BNS.TO',  50, 24.00);   // $1200
  const [h] = getHoldings(pid);

  // buy_price = (2000+1200) / (100+50) = 3200/150 = 21.3333
  check('shares = 150',                 h.shares,     150);
  check('buy_price = $21.33',          h.buy_price,  21.333, 0.01);
  check('buy_total = $3200',           h.buy_total,  3200);
  check('acb = $3200 (no sells yet)',  h.acb,        3200);
}

// ── 3. Partial sell: shares, ACB, return ──────────────────────────────────────
section('3. Partial Sell');
{
  const pid = makePortfolio('T3');
  buy(pid, 'ENB.TO', 100, 20.00);    // $2000 total cost
  sell(pid, 'ENB.TO',  40, 25.00);   // $1000 proceeds

  setInfo(pid, 'ENB.TO', { market_price: 22.00 });
  const [h] = getHoldings(pid);

  // shares = 60, buy_price = 2000/100 = 20.00
  // ACB = 2000 × (60/100) = 1200
  // market_value = 60 × 22 = 1320
  // return = 1320 + 1000 + 0 - 2000 = 320
  // return% = 320 / 1200 × 100 = 26.67
  check('shares = 60',               h.shares,         60);
  check('buy_price = $20.00',        h.buy_price,      20.00);
  check('acb = $1200',               h.acb,            1200);
  check('market_value = $1320',      h.market_value,   1320);
  check('return = $320',             h.return,         320);
  check('return% = 26.67%',         h.return_percent, 26.67, 0.01);
  check('proceeds = $1000',          h.proceeds,       1000);
}

// ── 4. Full sell: position excluded from results ───────────────────────────────
section('4. Full Sell Excluded');
{
  const pid = makePortfolio('T4');
  buy(pid, 'RY.TO', 50, 100.00);
  sell(pid, 'RY.TO', 50, 110.00);
  const holdings = getHoldings(pid);

  checkEq('fully sold position returns 0 results', holdings.length, 0);
}

// ── 5. Dividend Reinvestment (DRIP) ───────────────────────────────────────────
section('5. DRIP — buy_price includes reinvested shares');
{
  const pid = makePortfolio('T5');
  buy(pid, 'XEI.TO', 100, 20.00);    // $2000
  drip(pid, 'XEI.TO',   5, 21.00);   // $105

  const [h] = getHoldings(pid);

  // buy_price = (2000+105)/(100+5) = 2105/105 = 20.0476
  check('shares = 105',                h.shares,    105);
  check('buy_price = $20.05',         h.buy_price, 20.0476, 0.001);
  check('buy_total = $2105',          h.buy_total, 2105);
  checkEq('buy_count = 2 (buy+drip)', h.buy_count, 2);
}

// ── 6. Cash dividend tracked separately ───────────────────────────────────────
section('6. Cash Dividend');
{
  const pid = makePortfolio('T6');
  buy(pid, 'BCE.TO', 100, 20.00);
  dividend(pid, 'BCE.TO', 50.00);

  setInfo(pid, 'BCE.TO', { market_price: 22.00 });
  const [h] = getHoldings(pid);

  // market_value=2200, return=2200+0+50-2000=250
  check('dividends_paid = $50',  h.dividends_paid, 50);
  check('return = $250',         h.return,          250);
  // return% = 250/2000×100 = 12.5 (ACB=2000, no sells)
  check('return% = 12.50%',     h.return_percent,  12.50, 0.01);
}

// ── 7. Return % uses ACB as denominator, not all-time buy cost ────────────────
section('7. Return % Denominator = ACB');
{
  const pid = makePortfolio('T7');
  buy(pid, 'TD.TO', 100, 50.00);     // $5000
  sell(pid, 'TD.TO',  30, 60.00);    // $1800 proceeds

  setInfo(pid, 'TD.TO', { market_price: 55.00 });
  const [h] = getHoldings(pid);

  // shares=70, ACB=5000×(70/100)=3500
  // market_value=70×55=3850
  // return=3850+1800+0-5000=650
  // return% = 650/3500×100 = 18.57 (NOT 650/5000=13.0)
  check('acb = $3500',           h.acb,            3500);
  check('return = $650',         h.return,          650);
  check('return% = 18.57%',     h.return_percent,  18.571, 0.01);
}

// ── 8. Commission: included in ACB but not in buy_price ───────────────────────
section('8. Commission in ACB, excluded from buy_price');
{
  const pid = makePortfolio('T8');
  buy(pid, 'SU.TO', 100, 40.00, 9.99);  // $4000 + $9.99 commission

  const [h] = getHoldings(pid);

  // buy_price = 4000/100 = $40.00 (no commission)
  // acb = (4000+9.99) × (100/100) = $4009.99
  check('buy_price = $40.00 (no commission)', h.buy_price, 40.00);
  check('acb = $4009.99 (with commission)',   h.acb,       4009.99);
  check('buy_expense = $9.99',               h.buy_expense, 9.99);
}

// ── 9. Dividend yield-first calculation ───────────────────────────────────────
section('9. Dividend Yield-First (TMX path)');
{
  const pid = makePortfolio('T9');
  buy(pid, 'XEI.TO', 200, 25.00);

  setInfo(pid, 'XEI.TO', {
    market_price: 25.00,
    dividend_yield: 5.0,        // 5% from TMX
    dividend_frequency: 'Monthly'
  });
  const [h] = getHoldings(pid);

  // market_value = 200×25 = 5000
  // annual_payout = 5000 × 5/100 = 250
  // next_payout = 250/12 = 20.833
  // div_per_share = 20.833/200 = 0.10417
  check('annual_payout = $250.00',    h.annual_payout,      250.00);
  check('next_payout = $20.83',       h.next_payout,         20.833, 0.005);
  check('div_per_share = $0.1042',    h.dividend_per_share,  0.10417, 0.0005);
  check('dividend_yield = 5.0%',      h.dividend_yield,      5.0);
}

// ── 10. Dividend per-share fallback (manual entry path) ───────────────────────
section('10. Dividend Per-Share Fallback (manual path)');
{
  const pid = makePortfolio('T10');
  buy(pid, 'GRT.UN', 100, 14.00);

  setInfo(pid, 'GRT.UN', {
    market_price: 14.00,
    dividend_per_share: 0.0667,   // ~$0.0667/month manually entered
    dividend_frequency: 'Monthly'
  });
  const [h] = getHoldings(pid);

  // next_payout = 100 × 0.0667 = 6.67
  // annual_payout = 6.67 × 12 = 80.04
  // yield = 80.04/1400×100 = 5.717%
  check('next_payout = $6.67',       h.next_payout,        6.67,   0.01);
  check('annual_payout = $80.04',    h.annual_payout,      80.04,  0.05);
  check('yield ≈ 5.72%',            h.dividend_yield,      5.717,  0.01);
}

// ── 11. CASH ticker (contributions) excluded from holdings ────────────────────
section('11. CASH / Contribution Excluded');
{
  const pid = makePortfolio('T11');
  // Simulate a contribution (ticker='CASH', quantity=0)
  db.prepare('INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total) VALUES (?,?,?,?,?,?)')
    .run(pid, 'CASH', 'CONTRIBUTION', 0, 0, 5000);

  const holdings = getHoldings(pid);
  checkEq('CASH ticker excluded from holdings', holdings.length, 0);
}

// ── 12. Multiple portfolios are isolated ──────────────────────────────────────
section('12. Portfolio Isolation');
{
  const pid1 = makePortfolio('P12A');
  const pid2 = makePortfolio('P12B');
  buy(pid1, 'BNS.TO', 100, 60.00);
  buy(pid2, 'BNS.TO',  50, 62.00);

  const h1 = getHoldings(pid1);
  const h2 = getHoldings(pid2);

  check('portfolio A: shares=100', h1[0].shares, 100);
  check('portfolio B: shares=50',  h2[0].shares,  50);
  check('portfolio A: buy_price=$60', h1[0].buy_price, 60.00);
  check('portfolio B: buy_price=$62', h2[0].buy_price, 62.00);
}

// ── 13. Cash Invested for overview = ACB (not all-time buy_total) ─────────────
section('13. Cash Invested = ACB of Open Position');
{
  const pid = makePortfolio('T13');
  buy(pid, 'CM.TO', 100, 60.00);    // $6000
  sell(pid, 'CM.TO',  25, 70.00);   // sell 25 @ $70 = $1750

  const [h] = getHoldings(pid);

  // ACB = 6000 × (75/100) = 4500   (cost of the 75 shares still held)
  // buy_total = 6000 (still the all-time total)
  check('acb = $4500 (cost of 75 shares)',  h.acb,      4500);
  check('buy_total = $6000 (all-time)',      h.buy_total, 6000);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'═'.repeat(58)}`);
console.log(`  ${total} tests   ${passed} passed   ${failed} failed`);
console.log(`${'═'.repeat(58)}\n`);
process.exit(failed > 0 ? 1 : 0);
