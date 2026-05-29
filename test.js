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

function buy(pid, ticker, qty, price, commission = 0, date = '2024-01-01') {
  db.prepare('INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total, commission, date) VALUES (?,?,?,?,?,?,?,?)')
    .run(pid, ticker, 'BUY', qty, price, qty * price, commission, date);
}

function sell(pid, ticker, qty, price, commission = 0, date = '2024-01-01') {
  db.prepare('INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total, commission, date) VALUES (?,?,?,?,?,?,?,?)')
    .run(pid, ticker, 'SELL', qty, price, qty * price, commission, date);
}

function drip(pid, ticker, qty, price, date = '2024-01-01') {
  db.prepare('INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total, date) VALUES (?,?,?,?,?,?,?)')
    .run(pid, ticker, 'DIVIDEND_REINVEST', qty, price, qty * price, date);
}

function dividend(pid, ticker, amount, date = '2024-01-01') {
  db.prepare('INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total, date) VALUES (?,?,?,?,?,?,?)')
    .run(pid, ticker, 'DIVIDEND', 0, 0, amount, date);
}

function contribution(pid, amount, date = '2024-01-01') {
  db.prepare('INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total, date) VALUES (?,?,?,?,?,?,?)')
    .run(pid, 'CASH', 'CONTRIBUTION', 0, 0, amount, date);
}

function withdrawal(pid, amount, date = '2024-01-01') {
  db.prepare('INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total, date) VALUES (?,?,?,?,?,?,?)')
    .run(pid, 'CASH', 'WITHDRAWAL', 0, 0, amount, date);
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

// ─── Holdings query (mirrors server.js parameterized statements) ─────────────

const HOLDINGS_SQL = `
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
    LEFT JOIN stock_info s ON s.portfolio_id = t.portfolio_id AND s.ticker = t.ticker`;

const holdingsAllStmt = db.prepare(
  `${HOLDINGS_SQL} GROUP BY t.portfolio_id, t.ticker HAVING shares > 0 ORDER BY p.code, t.ticker`
);
const holdingsByPortfolioStmt = db.prepare(
  `${HOLDINGS_SQL} WHERE t.portfolio_id = ? GROUP BY t.portfolio_id, t.ticker HAVING shares > 0 ORDER BY p.code, t.ticker`
);

function query(portfolioId) {
  return portfolioId ? holdingsByPortfolioStmt.all(portfolioId) : holdingsAllStmt.all();
}

function getHoldings(portfolioId) {
  return computeHoldings(query(portfolioId));
}

// Monthly dividend grouping query (mirrors /api/dividends/monthly)
const dividendMonthlyStmt = db.prepare(`
  SELECT
    p.code AS portfolio_code,
    CAST(strftime('%Y', t.date) AS INTEGER) AS year,
    CAST(strftime('%m', t.date) AS INTEGER) AS month,
    SUM(t.total) AS total
  FROM transactions t
  JOIN portfolios p ON t.portfolio_id = p.id
  WHERE t.type = 'DIVIDEND' AND t.portfolio_id = ?
  GROUP BY p.code, year, month
  ORDER BY year, month
`);

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

function section(title) { const pad = Math.max(2, 50 - title.length); console.log(`\n── ${title} ${'─'.repeat(pad)}`); }

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

  check('shares = 150',                 h.shares,     150);
  check('buy_price = $21.33',          h.buy_price,  21.333, 0.01);
  check('buy_total = $3200',           h.buy_total,  3200);
  check('acb = $3200 (no sells yet)',  h.acb,        3200);
}

// ── 3. Partial sell: shares, ACB, return ──────────────────────────────────────
section('3. Partial Sell');
{
  const pid = makePortfolio('T3');
  buy(pid, 'ENB.TO', 100, 20.00);
  sell(pid, 'ENB.TO',  40, 25.00);

  setInfo(pid, 'ENB.TO', { market_price: 22.00 });
  const [h] = getHoldings(pid);

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
  buy(pid, 'XEI.TO', 100, 20.00);
  drip(pid, 'XEI.TO',   5, 21.00);

  const [h] = getHoldings(pid);

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

  check('dividends_paid = $50',  h.dividends_paid, 50);
  check('return = $250',         h.return,          250);
  check('return% = 12.50%',     h.return_percent,  12.50, 0.01);
}

// ── 7. Return % uses ACB as denominator, not all-time buy cost ────────────────
section('7. Return % Denominator = ACB');
{
  const pid = makePortfolio('T7');
  buy(pid, 'TD.TO', 100, 50.00);
  sell(pid, 'TD.TO',  30, 60.00);

  setInfo(pid, 'TD.TO', { market_price: 55.00 });
  const [h] = getHoldings(pid);

  check('acb = $3500',           h.acb,            3500);
  check('return = $650',         h.return,          650);
  check('return% = 18.57%',     h.return_percent,  18.571, 0.01);
}

// ── 8. Commission: included in ACB but not in buy_price ───────────────────────
section('8. Commission in ACB, excluded from buy_price');
{
  const pid = makePortfolio('T8');
  buy(pid, 'SU.TO', 100, 40.00, 9.99);

  const [h] = getHoldings(pid);

  check('buy_price = $40.00 (no commission)', h.buy_price, 40.00);
  check('acb = $4009.99 (with commission)',   h.acb,       4009.99);
  check('buy_expense = $9.99',               h.buy_expense, 9.99);
}

// ── 9. Dividend yield-first calculation (TMX path) ────────────────────────────
section('9. Dividend Yield-First (TMX path)');
{
  const pid = makePortfolio('T9');
  buy(pid, 'XEI.TO', 200, 25.00);

  setInfo(pid, 'XEI.TO', {
    market_price: 25.00,
    dividend_yield: 5.0,
    dividend_frequency: 'Monthly'
  });
  const [h] = getHoldings(pid);

  check('annual_payout = $250.00',    h.annual_payout,      250.00);
  check('next_payout = $20.83',       h.next_payout,         20.833, 0.005);
  check('div_per_share = $0.1042',    h.dividend_per_share,  0.10417, 0.0005);
  check('dividend_yield = 5.0%',      h.dividend_yield,      5.0);
}

// ── 10. Dividend per-share fallback (manual entry path, Monthly) ──────────────
section('10. Dividend Per-Share Fallback — Monthly');
{
  const pid = makePortfolio('T10');
  buy(pid, 'GRT.UN', 100, 14.00);

  setInfo(pid, 'GRT.UN', {
    market_price: 14.00,
    dividend_per_share: 0.0667,
    dividend_frequency: 'Monthly'
  });
  const [h] = getHoldings(pid);

  check('next_payout = $6.67',       h.next_payout,        6.67,   0.01);
  check('annual_payout = $80.04',    h.annual_payout,      80.04,  0.05);
  check('yield ≈ 5.72%',            h.dividend_yield,      5.717,  0.01);
}

// ── 11. CASH ticker (contributions) excluded from holdings ────────────────────
section('11. CASH / Contribution Excluded');
{
  const pid = makePortfolio('T11');
  contribution(pid, 5000);
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
  buy(pid, 'CM.TO', 100, 60.00);
  sell(pid, 'CM.TO',  25, 70.00);

  const [h] = getHoldings(pid);

  check('acb = $4500 (cost of 75 shares)',  h.acb,      4500);
  check('buy_total = $6000 (all-time)',      h.buy_total, 6000);
}

// ── 14. WITHDRAWAL excluded from holdings ────────────────────────────────────
section('14. WITHDRAWAL Excluded from Holdings');
{
  const pid = makePortfolio('T14');
  contribution(pid, 10000);
  withdrawal(pid, 3000);
  const holdings = getHoldings(pid);
  checkEq('CASH/WITHDRAWAL excluded from holdings', holdings.length, 0);
}

// ── 15. Sell commission → sale_expense, total_expense, proceeds ───────────────
section('15. Sell Commission → sale_expense / total_expense / proceeds');
{
  const pid = makePortfolio('T15');
  buy(pid, 'MFC.TO', 100, 30.00, 9.99);   // buy commission $9.99
  sell(pid, 'MFC.TO',  50, 35.00, 4.99);  // sell 50 @ $35, commission $4.99

  setInfo(pid, 'MFC.TO', { market_price: 35.00 });
  const [h] = getHoldings(pid);

  // sale_total = 50×35 = 1750
  // proceeds = 1750 - 4.99 = 1745.01
  // buy_expense = 9.99, sale_expense = 4.99, total_expense = 14.98
  check('sale_total = $1750',          h.sale_total,    1750);
  check('sale_expense = $4.99',        h.sale_expense,   4.99);
  check('proceeds = $1745.01',         h.proceeds,      1745.01);
  check('buy_expense = $9.99',         h.buy_expense,    9.99);
  check('total_expense = $14.98',      h.total_expense,  14.98);
  check('sell_count = 1',              h.sell_count,     1);
}

// ── 16. Quarterly dividend frequency (per-share fallback) ────────────────────
section('16. Quarterly Dividend Frequency (per-share fallback)');
{
  const pid = makePortfolio('T16');
  buy(pid, 'RY.TO', 100, 120.00);

  setInfo(pid, 'RY.TO', {
    market_price: 120.00,
    dividend_per_share: 1.38,       // $1.38/quarter
    dividend_frequency: 'Quarterly'
  });
  const [h] = getHoldings(pid);

  // next_payout = 100 × 1.38 = 138
  // annual_payout = 138 × 4 = 552
  // yield = 552 / 12000 × 100 = 4.6%
  check('next_payout = $138',       h.next_payout,    138.00);
  check('annual_payout = $552',     h.annual_payout,  552.00);
  check('yield = 4.6%',            h.dividend_yield,    4.60, 0.01);
}

// ── 17. Semi-Annual dividend frequency (per-share fallback) ──────────────────
section('17. Semi-Annual Dividend Frequency (per-share fallback)');
{
  const pid = makePortfolio('T17');
  buy(pid, 'FTS.TO', 200, 50.00);

  setInfo(pid, 'FTS.TO', {
    market_price: 50.00,
    dividend_per_share: 0.60,       // $0.60 twice a year
    dividend_frequency: 'Semi-Annual'
  });
  const [h] = getHoldings(pid);

  // next_payout = 200 × 0.60 = 120
  // annual_payout = 120 × 2 = 240
  // yield = 240 / 10000 × 100 = 2.4%
  check('next_payout = $120',       h.next_payout,    120.00);
  check('annual_payout = $240',     h.annual_payout,  240.00);
  check('yield = 2.4%',            h.dividend_yield,    2.40, 0.01);
}

// ── 18. Annual dividend frequency (per-share fallback) ───────────────────────
section('18. Annual Dividend Frequency (per-share fallback)');
{
  const pid = makePortfolio('T18');
  buy(pid, 'WN.TO', 50, 80.00);

  setInfo(pid, 'WN.TO', {
    market_price: 80.00,
    dividend_per_share: 1.20,
    dividend_frequency: 'Annual'
  });
  const [h] = getHoldings(pid);

  // next_payout = 50 × 1.20 = 60 (one annual payment)
  // annual_payout = 60 × 1 = 60
  // yield = 60 / 4000 × 100 = 1.5%
  check('next_payout = $60',        h.next_payout,    60.00);
  check('annual_payout = $60',      h.annual_payout,  60.00);
  check('yield = 1.5%',            h.dividend_yield,   1.50, 0.01);
}

// ── 19. Yield-first path: Quarterly ──────────────────────────────────────────
section('19. Yield-First Path — Quarterly (TMX)');
{
  const pid = makePortfolio('T19');
  buy(pid, 'BNS.TO', 100, 60.00);

  setInfo(pid, 'BNS.TO', {
    market_price: 60.00,
    dividend_yield: 6.0,           // 6% from TMX
    dividend_frequency: 'Quarterly'
  });
  const [h] = getHoldings(pid);

  // market_value = 6000
  // annual_payout = 6000 × 6/100 = 360
  // next_payout = 360/4 = 90
  // div_per_share = 90/100 = 0.90
  check('annual_payout = $360',     h.annual_payout,      360.00);
  check('next_payout = $90',        h.next_payout,         90.00);
  check('div_per_share = $0.90',    h.dividend_per_share,   0.90);
  check('yield = 6.0%',            h.dividend_yield,        6.00);
}

// ── 20. No market price: no yield/return calculations ────────────────────────
section('20. No Market Price — Return Uses Only Realized Values');
{
  const pid = makePortfolio('T20');
  buy(pid, 'NEW.TO', 100, 10.00);   // $1000 cost, no market price set
  dividend(pid, 'NEW.TO', 25.00);   // $25 dividends received

  const [h] = getHoldings(pid);

  // market_value = 0 (no price)
  // return = 0 + 0 + 25 - 1000 = -975
  // dividend_yield = 0 (no market value)
  check('market_value = 0',          h.market_value,   0);
  check('dividends_paid = $25',      h.dividends_paid, 25);
  check('return = -$975',            h.return,         -975);
  check('dividend_yield = 0',        h.dividend_yield,  0);
}

// ── 21. Multiple tickers in same portfolio ───────────────────────────────────
section('21. Multiple Tickers in Same Portfolio');
{
  const pid = makePortfolio('T21');
  buy(pid, 'XEI.TO', 100, 25.00);
  buy(pid, 'ZRE.TO',  50, 18.00);

  const holdings = getHoldings(pid);

  checkEq('two tickers returned', holdings.length, 2);
  // sorted by ticker alphabetically (XEI, ZRE)
  check('XEI shares = 100', holdings[0].shares, 100);
  check('ZRE shares = 50',  holdings[1].shares,  50);
  check('XEI buy_total = $2500', holdings[0].buy_total, 2500);
  check('ZRE buy_total = $900',  holdings[1].buy_total,  900);
}

// ── 22. Full sell excluded; other ticker in same portfolio still shown ─────────
section('22. Full Sell Excluded, Remaining Ticker Visible');
{
  const pid = makePortfolio('T22');
  buy(pid, 'RY.TO', 50, 100.00);
  sell(pid, 'RY.TO', 50, 110.00);   // fully sold
  buy(pid, 'TD.TO', 30,  80.00);    // still held

  const holdings = getHoldings(pid);

  checkEq('only one ticker returned (TD.TO)', holdings.length, 1);
  checkEq('returned ticker is TD.TO', holdings[0].ticker, 'TD.TO');
  check('TD.TO shares = 30', holdings[0].shares, 30);
}

// ── 23. All-portfolios query (null portfolioId) ───────────────────────────────
section('23. All-Portfolios Query (null portfolioId)');
{
  const pidA = makePortfolio('A23');
  const pidB = makePortfolio('B23');
  buy(pidA, 'XEI.TO', 100, 25.00);
  buy(pidB, 'ZRE.TO',  50, 18.00);

  const all = getHoldings(null);
  const xei = all.find(h => h.ticker === 'XEI.TO' && h.portfolio_code === 'A23');
  const zre = all.find(h => h.ticker === 'ZRE.TO' && h.portfolio_code === 'B23');

  checkEq('A23 XEI.TO found in all-portfolios query', !!xei, true);
  checkEq('B23 ZRE.TO found in all-portfolios query', !!zre, true);
  check('A23 XEI.TO shares = 100', xei.shares, 100);
  check('B23 ZRE.TO shares = 50',  zre.shares,  50);
}

// ── 24. DRIP + cash dividend combined ────────────────────────────────────────
section('24. DRIP + Cash Dividend Combined');
{
  const pid = makePortfolio('T24');
  buy(pid, 'BCE.TO', 100, 50.00);           // 100 shares @ $50
  drip(pid, 'BCE.TO',   2, 50.00);          // 2 reinvested shares
  dividend(pid, 'BCE.TO', 80.00);           // $80 cash dividends

  setInfo(pid, 'BCE.TO', { market_price: 52.00 });
  const [h] = getHoldings(pid);

  // shares_bought = 100 (buy) + 2 (drip) = 102; shares = 102
  // buy_total = 5000 + 100 = 5100
  // dividends_paid = 80 (DIVIDEND only, not DRIP)
  // market_value = 102 × 52 = 5304
  // return = 5304 + 0 + 80 - 5100 = 284
  check('shares = 102 (buy + drip)',        h.shares,         102);
  check('buy_total = $5100',                h.buy_total,      5100);
  check('dividends_paid = $80 (cash only)', h.dividends_paid, 80);
  check('market_value = $5304',             h.market_value,   5304);
  check('return = $284',                    h.return,          284);
  checkEq('buy_count = 2 (buy + drip)',     h.buy_count,       2);
}

// ── 25. Sale price = weighted average of all sells ───────────────────────────
section('25. Sale Price = Weighted Average of Sells');
{
  const pid = makePortfolio('T25');
  buy(pid, 'CNR.TO', 100, 150.00);
  sell(pid, 'CNR.TO',  20, 160.00);   // $3200
  sell(pid, 'CNR.TO',  30, 170.00);   // $5100

  const [h] = getHoldings(pid);

  // sale_total = 3200 + 5100 = 8300
  // shares_sold = 50
  // sale_price = 8300 / 50 = 166.00
  check('sale_price = $166.00', h.sale_price, 166.00);
  check('sale_total = $8300',   h.sale_total,  8300);
  check('sell_count = 2',       h.sell_count,  2);
  check('shares = 50 remaining', h.shares,     50);
}

// ── 26. Monthly dividend grouping (Dividends page) ───────────────────────────
section('26. Monthly Dividend Grouping — Dividends Page');
{
  const pid = makePortfolio('T26');
  buy(pid, 'XEI.TO', 100, 25.00);

  // Dividends across different months and years
  dividend(pid, 'XEI.TO', 50.00, '2023-03-15');
  dividend(pid, 'XEI.TO', 55.00, '2023-03-20');  // same month — should sum
  dividend(pid, 'XEI.TO', 60.00, '2023-06-15');
  dividend(pid, 'XEI.TO', 62.00, '2024-01-15');
  dividend(pid, 'XEI.TO', 63.00, '2024-06-15');

  const rows = dividendMonthlyStmt.all(pid);

  // Expect 4 rows: 2023-Mar, 2023-Jun, 2024-Jan, 2024-Jun
  checkEq('4 distinct month/year groups', rows.length, 4);

  const r = (y, m) => rows.find(r => r.year === y && r.month === m);

  check('2023 Mar total = $105 (two dividends summed)', r(2023,3)?.total ?? 0, 105.00);
  check('2023 Jun total = $60',                         r(2023,6)?.total ?? 0,  60.00);
  check('2024 Jan total = $62',                         r(2024,1)?.total ?? 0,  62.00);
  check('2024 Jun total = $63',                         r(2024,6)?.total ?? 0,  63.00);
}

// ── 27. Dividend grouping isolated per portfolio ──────────────────────────────
section('27. Monthly Dividends Isolated Per Portfolio');
{
  const pidA = makePortfolio('D27A');
  const pidB = makePortfolio('D27B');
  buy(pidA, 'XEI.TO', 100, 25.00);
  buy(pidB, 'XEI.TO', 200, 25.00);

  dividend(pidA, 'XEI.TO', 100.00, '2024-03-15');
  dividend(pidB, 'XEI.TO', 200.00, '2024-03-15');

  const rowsA = dividendMonthlyStmt.all(pidA);
  const rowsB = dividendMonthlyStmt.all(pidB);

  checkEq('portfolio A: 1 group', rowsA.length, 1);
  checkEq('portfolio B: 1 group', rowsB.length, 1);
  check('portfolio A March = $100', rowsA[0].total, 100.00);
  check('portfolio B March = $200', rowsB[0].total, 200.00);
}

// ── 28. ACB with commission on a partial sell ─────────────────────────────────
section('28. ACB with Commission After Partial Sell');
{
  const pid = makePortfolio('T28');
  buy(pid, 'ENB.TO', 200, 45.00, 9.99);   // cost = 9000 + 9.99 = 9009.99
  sell(pid, 'ENB.TO', 100, 50.00, 4.99);  // sell half

  const [h] = getHoldings(pid);

  // shares_bought = 200, shares = 100
  // ACB = (9000 + 9.99) × (100/200) = 4504.995
  check('shares = 100',             h.shares,      100);
  check('acb = $4505.00 (rounded)', h.acb,         4504.995, 0.01);
  check('buy_expense = $9.99',      h.buy_expense,    9.99);
  check('sale_expense = $4.99',     h.sale_expense,   4.99);
  check('total_expense = $14.98',   h.total_expense, 14.98);
}

// ── 29. Zero-share edge: DRIP then full sell ──────────────────────────────────
section('29. DRIP Then Full Sell — Position Excluded');
{
  const pid = makePortfolio('T29');
  buy(pid, 'TD.TO', 100, 80.00);
  drip(pid, 'TD.TO',   5, 82.00);
  sell(pid, 'TD.TO', 105, 85.00);  // sell all 105 shares

  const holdings = getHoldings(pid);
  checkEq('fully sold (buy + drip) returns 0 results', holdings.length, 0);
}

// ── 30. Multiple dividends same ticker increase dividends_paid ────────────────
section('30. Multiple Cash Dividends Accumulate');
{
  const pid = makePortfolio('T30');
  buy(pid, 'BCE.TO', 100, 50.00);
  dividend(pid, 'BCE.TO', 45.00, '2024-01-15');
  dividend(pid, 'BCE.TO', 45.00, '2024-04-15');
  dividend(pid, 'BCE.TO', 45.00, '2024-07-15');
  dividend(pid, 'BCE.TO', 45.00, '2024-10-15');

  setInfo(pid, 'BCE.TO', { market_price: 48.00 });
  const [h] = getHoldings(pid);

  // dividends_paid = 4 × 45 = 180
  // market_value = 100 × 48 = 4800
  // return = 4800 + 0 + 180 - 5000 = -20
  check('dividends_paid = $180 (4 payments)', h.dividends_paid, 180.00);
  check('return = -$20',                       h.return,         -20.00);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'═'.repeat(58)}`);
console.log(`  ${total} tests   ${passed} passed   ${failed} failed`);
console.log(`${'═'.repeat(58)}\n`);
process.exit(failed > 0 ? 1 : 0);
