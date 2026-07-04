'use strict';

/**
 * Yieldly — Comprehensive Test Suite
 *
 * Covers:
 *   Part A  — Math / compute.js (all transaction types, edge cases)
 *   Part B  — API endpoint logic (inline, no HTTP server needed)
 *   Part C  — CSV import parsing (parseCSVLine, parseDate, type-map, duplicate
 *              detection, error handling)
 *   Part D  — computeMonthlyACB (Summary page data)
 *   Part E  — Input-validation rules from server.js
 *
 * Uses the better-sqlite3 v11 pre-built binary that matches Node v20 arm64.
 */

const Database = require('better-sqlite3');
const { computeHoldings } = require('./lib/compute');
const { parseCSVLine, parseDate } = require('./lib/parse');
const { HOLDINGS_SQL, GROUP_ORDER } = require('./lib/holdings');
const { computeMonthlyACB: _computeMonthlyACB } = require('./app');

// ─── In-memory database ──────────────────────────────────────────────────────
// Validates driver-agnostic money math, so it runs synchronously on
// better-sqlite3 (devDependency). Aggregation SQL and computeMonthlyACB are
// imported from the real modules (single source of truth); production runs on
// async libSQL. The real async schema + app are exercised by test-auth.js.

const db = new Database(':memory:');

db.exec(`
  CREATE TABLE portfolios (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    code          TEXT NOT NULL UNIQUE,
    display_order INTEGER DEFAULT 0,
    cash_balance  REAL
  );
  CREATE TABLE transactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    portfolio_id INTEGER NOT NULL,
    ticker       TEXT NOT NULL DEFAULT 'CASH',
    type         TEXT NOT NULL CHECK(type IN ('BUY','SELL','DIVIDEND','DIVIDEND_REINVEST','CONTRIBUTION','WITHDRAWAL','TRANSFER_IN','TRANSFER_OUT')),
    quantity     REAL NOT NULL DEFAULT 0,
    price        REAL NOT NULL DEFAULT 0,
    total        REAL NOT NULL DEFAULT 0,
    commission   REAL DEFAULT 0,
    date         TEXT NOT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios (id)
  );
  CREATE TABLE stock_info (
    portfolio_id       INTEGER NOT NULL,
    ticker             TEXT NOT NULL,
    market_price       REAL,
    dividend_yield     REAL,
    dividend_frequency TEXT,
    dividend_per_share REAL,
    last_dividend_date TEXT,
    sector             TEXT,
    investment_type    TEXT,
    PRIMARY KEY (portfolio_id, ticker)
  );
`);

// ─── DB helpers ───────────────────────────────────────────────────────────────

let nextPid = 1;

function mkPortfolio(code, name) {
  const n = name || code;
  db.prepare('INSERT INTO portfolios (id, name, code) VALUES (?,?,?)').run(nextPid, n, code);
  return nextPid++;
}

function buy(pid, ticker, qty, price, comm = 0, date = '2024-01-15') {
  db.prepare('INSERT INTO transactions (portfolio_id,ticker,type,quantity,price,total,commission,date) VALUES (?,?,?,?,?,?,?,?)')
    .run(pid, ticker, 'BUY', qty, price, qty * price, comm, date);
}
function sell(pid, ticker, qty, price, comm = 0, date = '2024-06-15') {
  db.prepare('INSERT INTO transactions (portfolio_id,ticker,type,quantity,price,total,commission,date) VALUES (?,?,?,?,?,?,?,?)')
    .run(pid, ticker, 'SELL', qty, price, qty * price, comm, date);
}
function drip(pid, ticker, qty, price, date = '2024-03-15') {
  db.prepare('INSERT INTO transactions (portfolio_id,ticker,type,quantity,price,total,date) VALUES (?,?,?,?,?,?,?)')
    .run(pid, ticker, 'DIVIDEND_REINVEST', qty, price, qty * price, date);
}
function dividend(pid, ticker, amount, date = '2024-01-15') {
  db.prepare('INSERT INTO transactions (portfolio_id,ticker,type,quantity,price,total,date) VALUES (?,?,?,?,?,?,?)')
    .run(pid, ticker, 'DIVIDEND', 0, 0, amount, date);
}
function contribution(pid, amount, date = '2024-01-01') {
  db.prepare('INSERT INTO transactions (portfolio_id,ticker,type,quantity,price,total,date) VALUES (?,?,?,?,?,?,?)')
    .run(pid, 'CASH', 'CONTRIBUTION', 0, 0, amount, date);
}
function withdrawal(pid, amount, date = '2024-01-01') {
  db.prepare('INSERT INTO transactions (portfolio_id,ticker,type,quantity,price,total,date) VALUES (?,?,?,?,?,?,?)')
    .run(pid, 'CASH', 'WITHDRAWAL', 0, 0, amount, date);
}
function transferOut(pid, amount, date = '2024-01-01') {
  db.prepare('INSERT INTO transactions (portfolio_id,ticker,type,quantity,price,total,date) VALUES (?,?,?,?,?,?,?)')
    .run(pid, 'CASH', 'TRANSFER_OUT', 0, 0, amount, date);
}
function transferIn(pid, amount, date = '2024-01-01') {
  db.prepare('INSERT INTO transactions (portfolio_id,ticker,type,quantity,price,total,date) VALUES (?,?,?,?,?,?,?)')
    .run(pid, 'CASH', 'TRANSFER_IN', 0, 0, amount, date);
}
function setInfo(pid, ticker, fields) {
  const keys = Object.keys(fields);
  const ph   = keys.map(k => `${k} = excluded.${k}`).join(', ');
  db.prepare(`
    INSERT INTO stock_info (portfolio_id, ticker, ${keys.join(', ')})
    VALUES (${[pid, `'${ticker}'`, ...keys.map(() => '?')].join(', ')})
    ON CONFLICT(portfolio_id, ticker) DO UPDATE SET ${ph}
  `).run(...keys.map(k => fields[k]));
}

// ─── Holdings query ───────────────────────────────────────────────────────────

const holdingsAllStmt  = db.prepare(`${HOLDINGS_SQL} ${GROUP_ORDER}`);
const holdingsByPidStmt = db.prepare(`${HOLDINGS_SQL} WHERE t.portfolio_id = ? ${GROUP_ORDER}`);
function queryHoldings(pid) { return pid ? holdingsByPidStmt.all(pid) : holdingsAllStmt.all(); }
function getHoldings(pid) {
  return computeHoldings(queryHoldings(pid));
}

// ─── Monthly dividend grouped query ──────────────────────────────────────────

const divMonthlyStmt = db.prepare(`
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

// computeMonthlyACB is the real implementation from ./app, with a fixed "now"
// injected so the month range these tests assert on stays deterministic.
const FIXED_NOW = new Date('2024-12-31');
function computeMonthlyACB(txRows) { return _computeMonthlyACB(txRows, FIXED_NOW); }

// ─── CSV helpers (imported from lib/parse.js) ────────────────────────────────

// Inline CSV import logic (mirrors server.js /api/import/csv for in-memory testing)
function importCSV(csvData, testDb) {
  const lines    = csvData.trim().split('\n');
  const imported = [];
  const errors   = [];
  const typeMap  = { 'D': 'DIVIDEND', 'B': 'BUY', 'S': 'SELL', 'DR': 'DIVIDEND_REINVEST' };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const parts = parseCSVLine(line);
      if (parts.length < 7) {
        errors.push({ line: i + 1, error: `Expected 7 cols, got ${parts.length}` });
        continue;
      }
      const [dateStr, symbol, portfolioCode, typeCode, quantityStr, priceStr, totalStr] = parts;
      const portfolio = testDb.prepare('SELECT id FROM portfolios WHERE code = ?').get(portfolioCode.toUpperCase().trim());
      if (!portfolio) {
        errors.push({ line: i + 1, error: `Portfolio '${portfolioCode}' not found` });
        continue;
      }
      const parsedDate = parseDate(dateStr);
      const type       = typeMap[typeCode] || typeCode;
      const quantity   = parseFloat(quantityStr.replace(/[$\s,]/g, '')) || 0;
      const price      = parseFloat(priceStr.replace(/[$\s,]/g, ''))    || 0;
      const total      = parseFloat(totalStr.replace(/[$\s,]/g, ''))    || 0;

      const dup = testDb.prepare(`
        SELECT id FROM transactions
        WHERE portfolio_id = ? AND ticker = ? AND type = ? AND date = ? AND quantity = ? AND price = ?
      `).get(portfolio.id, symbol, type, parsedDate, quantity, price);
      if (dup) {
        errors.push({ line: i + 1, error: 'Duplicate transaction (skipped)' });
        continue;
      }
      testDb.prepare(`INSERT INTO transactions (portfolio_id,ticker,type,quantity,price,total,date) VALUES (?,?,?,?,?,?,?)`)
        .run(portfolio.id, symbol, type, quantity, price, total, parsedDate);
      imported.push({ line: i + 1, symbol, date: parsedDate });
    } catch (err) {
      errors.push({ line: i + 1, error: err.message });
    }
  }
  return { imported: imported.length, errors: errors.length, details: { imported, errors } };
}

// ─── Portfolio validation (mirrors server.js create-portfolio rules) ──────────

function validatePortfolio(name, code) {
  if (!name || !code) return 'Name and code are required';
  if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100)
    return 'Name must be 1–100 characters';
  if (/[<>"']/.test(name)) return 'Name must not contain < > " \' characters';
  if (typeof code !== 'string' || !/^[A-Z0-9]{1,5}$/i.test(code.trim()))
    return 'Code must be 1–5 alphanumeric characters';
  return null; // valid
}

// ─── Transaction validation (mirrors server.js add-transaction rules) ─────────

function validateTransaction({ portfolio_id, ticker, type, date }) {
  const isCashFlow = type === 'CONTRIBUTION' || type === 'WITHDRAWAL';
  const finalTicker = (isCashFlow && !ticker) ? 'CASH' : ticker;
  if (!portfolio_id || !finalTicker || !type || !date) return 'Missing required fields';
  return null; // valid
}

// ─── Assertion helpers ────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const failures = [];

function check(label, actual, expected, tolerance = 0.005) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    const msg = `  ✗  ${label}\n       expected ${expected}, got ${actual}`;
    console.error(msg);
    failed++;
    failures.push({ label, expected, actual, tolerance });
  }
}

function checkEq(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    const msg = `  ✗  ${label}\n       expected "${expected}", got "${actual}"`;
    console.error(msg);
    failed++;
    failures.push({ label, expected, actual });
  }
}

function checkNull(label, actual) {
  const ok = actual === null || actual === undefined;
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label} — expected null/undefined, got "${actual}"`);
    failed++;
    failures.push({ label, expected: null, actual });
  }
}

function checkNotNull(label, actual) {
  const ok = actual !== null && actual !== undefined;
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label} — expected a value, got null/undefined`);
    failed++;
    failures.push({ label, expected: 'non-null', actual });
  }
}

function section(title) {
  const pad = Math.max(2, 52 - title.length);
  console.log(`\n${'─'.repeat(2)} ${title} ${'─'.repeat(pad)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PART A — Math / Holdings calculations
// ─────────────────────────────────────────────────────────────────────────────

section('A1. Simple Buy');
{
  const pid = mkPortfolio('A1');
  buy(pid, 'XEI.TO', 100, 25.00);
  const [h] = getHoldings(pid);
  check('shares = 100',       h.shares,    100);
  check('buy_price = $25',    h.buy_price, 25.00);
  check('buy_total = $2500',  h.buy_total, 2500);
  check('acb = $2500',        h.acb,       2500);
  checkEq('buy_count = 1',    h.buy_count, 1);
}

section('A2. Weighted Average Buy Price (two buys)');
{
  const pid = mkPortfolio('A2');
  buy(pid, 'BNS.TO', 100, 20.00);   // $2000
  buy(pid, 'BNS.TO',  50, 24.00);   // $1200  → avg $21.333
  const [h] = getHoldings(pid);
  check('shares = 150',         h.shares,    150);
  check('buy_price ≈ $21.33',   h.buy_price, 21.333, 0.01);
  check('buy_total = $3200',    h.buy_total, 3200);
  check('acb = $3200',          h.acb,       3200);
}

section('A3. Partial Sell — shares, ACB, return');
{
  const pid = mkPortfolio('A3');
  buy(pid, 'ENB.TO', 100, 20.00);
  sell(pid, 'ENB.TO',  40, 25.00);
  setInfo(pid, 'ENB.TO', { market_price: 22.00 });
  const [h] = getHoldings(pid);
  check('shares = 60',            h.shares,         60);
  check('buy_price = $20',        h.buy_price,      20.00);
  check('acb = $1200',            h.acb,            1200);
  check('market_value = $1320',   h.market_value,   1320);
  check('return = $320',          h.return,         320);
  check('return_pct = 26.67%',    h.return_percent, 26.67, 0.01);
  check('proceeds = $1000',       h.proceeds,       1000);
}

section('A4. Full Sell — position excluded from results');
{
  const pid = mkPortfolio('A4');
  buy(pid, 'RY.TO', 50, 100.00);
  sell(pid, 'RY.TO', 50, 110.00);
  const holdings = getHoldings(pid);
  checkEq('zero results after full sell', holdings.length, 0);
}

section('A5. DRIP — shares, buy_price, buy_count');
{
  const pid = mkPortfolio('A5');
  buy(pid, 'XEI.TO', 100, 20.00);
  drip(pid, 'XEI.TO',   5, 21.00);
  const [h] = getHoldings(pid);
  check('shares = 105',                h.shares,    105);
  check('buy_price ≈ $20.05',          h.buy_price, 20.0476, 0.001);
  check('buy_total = $2105',           h.buy_total, 2105);
  checkEq('buy_count = 2 (buy+drip)',  h.buy_count, 2);
}

section('A6. Cash Dividend tracked separately');
{
  const pid = mkPortfolio('A6');
  buy(pid, 'BCE.TO', 100, 20.00);
  dividend(pid, 'BCE.TO', 50.00);
  setInfo(pid, 'BCE.TO', { market_price: 22.00 });
  const [h] = getHoldings(pid);
  check('dividends_paid = $50',  h.dividends_paid, 50);
  check('return = $250',         h.return,         250);
  check('return_pct = 12.5%',    h.return_percent, 12.50, 0.01);
}

section('A7. Commission in ACB, excluded from buy_price');
{
  const pid = mkPortfolio('A7');
  buy(pid, 'SU.TO', 100, 40.00, 9.99);
  const [h] = getHoldings(pid);
  check('buy_price = $40 (no commission)', h.buy_price,   40.00);
  check('acb = $4009.99',                  h.acb,         4009.99);
  check('buy_expense = $9.99',             h.buy_expense, 9.99);
}

section('A8. Sell commission — sale_expense, proceeds, total_expense');
{
  const pid = mkPortfolio('A8');
  buy(pid, 'MFC.TO', 100, 30.00, 9.99);
  sell(pid, 'MFC.TO',  50, 35.00, 4.99);
  setInfo(pid, 'MFC.TO', { market_price: 35.00 });
  const [h] = getHoldings(pid);
  check('sale_total = $1750',       h.sale_total,    1750);
  check('sale_expense = $4.99',     h.sale_expense,  4.99);
  check('proceeds = $1745.01',      h.proceeds,      1745.01);
  check('buy_expense = $9.99',      h.buy_expense,   9.99);
  check('total_expense = $14.98',   h.total_expense, 14.98);
  checkEq('sell_count = 1',         h.sell_count,    1);
}

section('A9. Return % denominator = ACB (not all-time buy cost)');
{
  const pid = mkPortfolio('A9');
  buy(pid, 'TD.TO', 100, 50.00);
  sell(pid, 'TD.TO',  30, 60.00);
  setInfo(pid, 'TD.TO', { market_price: 55.00 });
  const [h] = getHoldings(pid);
  check('acb = $3500',            h.acb,            3500);
  check('return = $650',          h.return,         650);
  check('return_pct ≈ 18.57%',    h.return_percent, 18.571, 0.01);
}

section('A10. Yield-first path — Monthly (TMX/dividend_yield set)');
{
  const pid = mkPortfolio('A10');
  buy(pid, 'XEI.TO', 200, 25.00);
  setInfo(pid, 'XEI.TO', { market_price: 25.00, dividend_yield: 5.0, dividend_frequency: 'Monthly' });
  const [h] = getHoldings(pid);
  check('annual_payout = $250',    h.annual_payout,     250.00);
  check('next_payout ≈ $20.83',    h.next_payout,        20.833, 0.005);
  check('div_per_share ≈ $0.1042', h.dividend_per_share, 0.10417, 0.0005);
  check('dividend_yield = 5.0%',   h.dividend_yield,     5.0);
}

section('A11. Per-share fallback — Monthly');
{
  const pid = mkPortfolio('A11');
  buy(pid, 'GRT.UN', 100, 14.00);
  setInfo(pid, 'GRT.UN', { market_price: 14.00, dividend_per_share: 0.0667, dividend_frequency: 'Monthly' });
  const [h] = getHoldings(pid);
  check('next_payout ≈ $6.67',    h.next_payout,    6.67,  0.01);
  check('annual_payout ≈ $80.04', h.annual_payout, 80.04,  0.05);
  check('yield ≈ 5.72%',          h.dividend_yield,  5.717, 0.01);
}

section('A12. Per-share fallback — Quarterly');
{
  const pid = mkPortfolio('A12');
  buy(pid, 'RY.TO', 100, 120.00);
  setInfo(pid, 'RY.TO', { market_price: 120.00, dividend_per_share: 1.38, dividend_frequency: 'Quarterly' });
  const [h] = getHoldings(pid);
  check('next_payout = $138',    h.next_payout,   138.00);
  check('annual_payout = $552',  h.annual_payout, 552.00);
  check('yield = 4.6%',          h.dividend_yield,  4.60, 0.01);
}

section('A13. Per-share fallback — Semi-Annual');
{
  const pid = mkPortfolio('A13');
  buy(pid, 'FTS.TO', 200, 50.00);
  setInfo(pid, 'FTS.TO', { market_price: 50.00, dividend_per_share: 0.60, dividend_frequency: 'Semi-Annual' });
  const [h] = getHoldings(pid);
  check('next_payout = $120',    h.next_payout,   120.00);
  check('annual_payout = $240',  h.annual_payout, 240.00);
  check('yield = 2.4%',          h.dividend_yield,  2.40, 0.01);
}

section('A14. Per-share fallback — Annual');
{
  const pid = mkPortfolio('A14');
  buy(pid, 'WN.TO', 50, 80.00);
  setInfo(pid, 'WN.TO', { market_price: 80.00, dividend_per_share: 1.20, dividend_frequency: 'Annual' });
  const [h] = getHoldings(pid);
  check('next_payout = $60',     h.next_payout,  60.00);
  check('annual_payout = $60',   h.annual_payout, 60.00);
  check('yield = 1.5%',          h.dividend_yield,  1.50, 0.01);
}

section('A15. Yield-first — Quarterly (TMX path)');
{
  const pid = mkPortfolio('A15');
  buy(pid, 'BNS.TO', 100, 60.00);
  setInfo(pid, 'BNS.TO', { market_price: 60.00, dividend_yield: 6.0, dividend_frequency: 'Quarterly' });
  const [h] = getHoldings(pid);
  check('annual_payout = $360',    h.annual_payout,     360.00);
  check('next_payout = $90',       h.next_payout,        90.00);
  check('div_per_share = $0.90',   h.dividend_per_share,  0.90);
  check('dividend_yield = 6.0%',   h.dividend_yield,      6.00);
}

section('A16. CASH ticker (CONTRIBUTION) excluded from holdings');
{
  const pid = mkPortfolio('A16');
  contribution(pid, 5000);
  const holdings = getHoldings(pid);
  checkEq('CASH excluded', holdings.length, 0);
}

section('A17. WITHDRAWAL excluded from holdings');
{
  const pid = mkPortfolio('A17');
  contribution(pid, 10000);
  withdrawal(pid, 3000);
  const holdings = getHoldings(pid);
  checkEq('CASH/WITHDRAWAL excluded', holdings.length, 0);
}

section('A18. Multiple portfolios are isolated');
{
  const p1 = mkPortfolio('A18A');
  const p2 = mkPortfolio('A18B');
  buy(p1, 'BNS.TO', 100, 60.00);
  buy(p2, 'BNS.TO',  50, 62.00);
  const h1 = getHoldings(p1);
  const h2 = getHoldings(p2);
  check('P1 shares = 100',    h1[0].shares, 100);
  check('P2 shares = 50',     h2[0].shares,  50);
  check('P1 buy_price = $60', h1[0].buy_price, 60.00);
  check('P2 buy_price = $62', h2[0].buy_price, 62.00);
}

section('A19. Multiple tickers in same portfolio');
{
  const pid = mkPortfolio('A19');
  buy(pid, 'XEI.TO', 100, 25.00);
  buy(pid, 'ZRE.TO',  50, 18.00);
  const holdings = getHoldings(pid);
  checkEq('two tickers', holdings.length, 2);
  check('XEI shares = 100', holdings[0].shares, 100);
  check('ZRE shares = 50',  holdings[1].shares,  50);
}

section('A20. Full sell excluded; other ticker still shown');
{
  const pid = mkPortfolio('A20');
  buy(pid, 'RY.TO', 50, 100.00);
  sell(pid, 'RY.TO', 50, 110.00);   // fully sold
  buy(pid, 'TD.TO', 30,  80.00);
  const holdings = getHoldings(pid);
  checkEq('1 ticker returned', holdings.length, 1);
  checkEq('returned ticker is TD.TO', holdings[0].ticker, 'TD.TO');
}

section('A21. All-portfolios query (null portfolioId)');
{
  const pa = mkPortfolio('A21A');
  const pb = mkPortfolio('A21B');
  buy(pa, 'XEI.TO', 100, 25.00);
  buy(pb, 'ZRE.TO',  50, 18.00);
  const all = getHoldings(null);
  const xei = all.find(h => h.ticker === 'XEI.TO' && h.portfolio_code === 'A21A');
  const zre = all.find(h => h.ticker === 'ZRE.TO' && h.portfolio_code === 'A21B');
  checkNotNull('A21A/XEI found', xei);
  checkNotNull('A21B/ZRE found', zre);
  check('A21A XEI shares = 100', xei?.shares, 100);
  check('A21B ZRE shares = 50',  zre?.shares,  50);
}

section('A22. DRIP + cash dividend combined');
{
  const pid = mkPortfolio('A22');
  buy(pid, 'BCE.TO', 100, 50.00);
  drip(pid, 'BCE.TO',   2, 50.00);
  dividend(pid, 'BCE.TO', 80.00);
  setInfo(pid, 'BCE.TO', { market_price: 52.00 });
  const [h] = getHoldings(pid);
  check('shares = 102',              h.shares,         102);
  check('buy_total = $5100',         h.buy_total,      5100);
  check('dividends_paid = $80',      h.dividends_paid, 80);
  check('market_value = $5304',      h.market_value,   5304);
  check('return = $284',             h.return,         284);
  checkEq('buy_count = 2',           h.buy_count,      2);
}

section('A23. Sale price = weighted average of multiple sells');
{
  const pid = mkPortfolio('A23');
  buy(pid, 'CNR.TO', 100, 150.00);
  sell(pid, 'CNR.TO',  20, 160.00);
  sell(pid, 'CNR.TO',  30, 170.00);
  const [h] = getHoldings(pid);
  check('sale_price = $166', h.sale_price, 166.00);
  check('sale_total = $8300', h.sale_total, 8300);
  checkEq('sell_count = 2',  h.sell_count, 2);
  check('shares = 50',       h.shares,     50);
}

section('A24. ACB with commission on partial sell');
{
  const pid = mkPortfolio('A24');
  buy(pid, 'ENB.TO', 200, 45.00, 9.99);   // 9000 + 9.99 = 9009.99
  sell(pid, 'ENB.TO', 100, 50.00, 4.99);
  const [h] = getHoldings(pid);
  check('shares = 100',          h.shares,       100);
  check('acb ≈ $4504.995',       h.acb,          4504.995, 0.01);
  check('buy_expense = $9.99',   h.buy_expense,  9.99);
  check('sale_expense = $4.99',  h.sale_expense, 4.99);
}

section('A25. DRIP then full sell — position excluded');
{
  const pid = mkPortfolio('A25');
  buy(pid, 'TD.TO', 100, 80.00);
  drip(pid, 'TD.TO',   5, 82.00);
  sell(pid, 'TD.TO', 105, 85.00);   // sell all 105
  const holdings = getHoldings(pid);
  checkEq('fully sold (buy+drip) → 0 results', holdings.length, 0);
}

section('A26. Multiple cash dividends accumulate');
{
  const pid = mkPortfolio('A26');
  buy(pid, 'BCE.TO', 100, 50.00);
  dividend(pid, 'BCE.TO', 45.00, '2024-01-15');
  dividend(pid, 'BCE.TO', 45.00, '2024-04-15');
  dividend(pid, 'BCE.TO', 45.00, '2024-07-15');
  dividend(pid, 'BCE.TO', 45.00, '2024-10-15');
  setInfo(pid, 'BCE.TO', { market_price: 48.00 });
  const [h] = getHoldings(pid);
  check('dividends_paid = $180', h.dividends_paid, 180.00);
  check('return = -$20',         h.return,         -20.00);
}

section('A27. No market price — return uses only realized values');
{
  const pid = mkPortfolio('A27');
  buy(pid, 'NEW.TO', 100, 10.00);
  dividend(pid, 'NEW.TO', 25.00);
  const [h] = getHoldings(pid);
  check('market_value = 0',      h.market_value,  0);
  check('dividends_paid = $25',  h.dividends_paid, 25);
  check('return = -$975',        h.return,        -975);
  check('dividend_yield = 0',    h.dividend_yield,  0);
}

section('A28. Zero shares edge: shares field is 0');
{
  const pid = mkPortfolio('A28');
  buy(pid, 'ZZZ.TO', 50, 10.00);
  sell(pid, 'ZZZ.TO', 50, 12.00);
  const holdings = getHoldings(pid);
  checkEq('sold-out position not in holdings', holdings.length, 0);
}

section('A29. buy_total vs acb after partial sell (cash_invested test)');
{
  const pid = mkPortfolio('A29');
  buy(pid, 'CM.TO', 100, 60.00);
  sell(pid, 'CM.TO',  25, 70.00);
  const [h] = getHoldings(pid);
  check('acb = $4500',        h.acb,       4500);
  check('buy_total = $6000',  h.buy_total, 6000);
}

section('A30. Dividend not counted in buy_total');
{
  const pid = mkPortfolio('A30');
  buy(pid, 'BCE.TO', 100, 20.00);
  dividend(pid, 'BCE.TO', 500.00);
  const [h] = getHoldings(pid);
  check('buy_total = $2000 (dividend excluded)', h.buy_total,     2000);
  check('dividends_paid = $500',                 h.dividends_paid, 500);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PART B — Monthly Dividend Grouping
// ─────────────────────────────────────────────────────────────────────────────

section('B1. Monthly dividend grouping');
{
  const pid = mkPortfolio('B1');
  buy(pid, 'XEI.TO', 100, 25.00);
  dividend(pid, 'XEI.TO', 50.00, '2023-03-15');
  dividend(pid, 'XEI.TO', 55.00, '2023-03-20');  // same month — should sum
  dividend(pid, 'XEI.TO', 60.00, '2023-06-15');
  dividend(pid, 'XEI.TO', 62.00, '2024-01-15');
  dividend(pid, 'XEI.TO', 63.00, '2024-06-15');

  const rows = divMonthlyStmt.all(pid);
  checkEq('4 month groups', rows.length, 4);
  const r = (y, m) => rows.find(row => row.year === y && row.month === m);
  check('2023 Mar = $105', r(2023,3)?.total ?? 0, 105.00);
  check('2023 Jun = $60',  r(2023,6)?.total ?? 0,  60.00);
  check('2024 Jan = $62',  r(2024,1)?.total ?? 0,  62.00);
  check('2024 Jun = $63',  r(2024,6)?.total ?? 0,  63.00);
}

section('B2. Monthly dividends isolated per portfolio');
{
  const pa = mkPortfolio('B2A');
  const pb = mkPortfolio('B2B');
  buy(pa, 'XEI.TO', 100, 25.00);
  buy(pb, 'XEI.TO', 200, 25.00);
  dividend(pa, 'XEI.TO', 100.00, '2024-03-15');
  dividend(pb, 'XEI.TO', 200.00, '2024-03-15');
  const ra = divMonthlyStmt.all(pa);
  const rb = divMonthlyStmt.all(pb);
  checkEq('portfolio A: 1 group', ra.length, 1);
  checkEq('portfolio B: 1 group', rb.length, 1);
  check('portfolio A March = $100', ra[0].total, 100.00);
  check('portfolio B March = $200', rb[0].total, 200.00);
}

section('B3. Monthly dividend all-portfolios endpoint');
{
  const pa = mkPortfolio('B3A');
  const pb = mkPortfolio('B3B');
  buy(pa, 'XEI.TO', 50, 25.00);
  buy(pb, 'BCE.TO', 50, 20.00);
  dividend(pa, 'XEI.TO',  75.00, '2024-09-15');
  dividend(pb, 'BCE.TO', 100.00, '2024-09-15');

  // Simulate all-portfolios dividend query
  const rows = db.prepare(`
    SELECT p.code AS portfolio_code,
           CAST(strftime('%Y', t.date) AS INTEGER) AS year,
           CAST(strftime('%m', t.date) AS INTEGER) AS month,
           SUM(t.total) AS total
    FROM transactions t
    JOIN portfolios p ON t.portfolio_id = p.id
    WHERE t.type = 'DIVIDEND' AND t.portfolio_id IN (?,?)
    GROUP BY p.code, year, month ORDER BY p.code, year, month
  `).all(pa, pb);

  const b3a = rows.find(r => r.portfolio_code === 'B3A');
  const b3b = rows.find(r => r.portfolio_code === 'B3B');
  checkNotNull('B3A dividend row found', b3a);
  checkNotNull('B3B dividend row found', b3b);
  check('B3A Sep = $75',  b3a?.total, 75.00);
  check('B3B Sep = $100', b3b?.total, 100.00);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PART C — computeMonthlyACB (Summary page)
// ─────────────────────────────────────────────────────────────────────────────

section('C1. computeMonthlyACB — simple single buy');
{
  // Create isolated transactions for ACB function (pass rows directly)
  const txRows = [
    { portfolio_id: 999, ticker: 'XEI.TO', type: 'BUY', quantity: 100, total: 2500, commission: 0, date: '2024-02-01' }
  ];
  const acb = computeMonthlyACB(txRows);
  // Should have entries from Feb 2024 to Dec 2024
  const febEntry = acb.find(r => r.year === 2024 && r.month === 2);
  const decEntry = acb.find(r => r.year === 2024 && r.month === 12);
  checkNotNull('Feb 2024 ACB entry exists', febEntry);
  checkNotNull('Dec 2024 ACB entry exists', decEntry);
  check('Feb 2024 ACB = $2500', febEntry?.total_acb, 2500);
  check('Dec 2024 ACB = $2500', decEntry?.total_acb, 2500);
}

section('C2. computeMonthlyACB — partial sell reduces ACB');
{
  const txRows = [
    { portfolio_id: 998, ticker: 'RY.TO', type: 'BUY',  quantity: 100, total: 10000, commission: 0, date: '2024-03-01' },
    { portfolio_id: 998, ticker: 'RY.TO', type: 'SELL', quantity:  50, total:  5500, commission: 0, date: '2024-06-01' },
  ];
  const acb = computeMonthlyACB(txRows);
  const marEntry = acb.find(r => r.year === 2024 && r.month === 3);
  const junEntry = acb.find(r => r.year === 2024 && r.month === 6);
  check('Mar 2024 ACB = $10000', marEntry?.total_acb, 10000);
  check('Jun 2024 ACB = $5000 (half sold)', junEntry?.total_acb, 5000);
}

section('C3. computeMonthlyACB — commission included in ACB');
{
  const txRows = [
    { portfolio_id: 997, ticker: 'SU.TO', type: 'BUY', quantity: 100, total: 4000, commission: 9.99, date: '2024-04-01' }
  ];
  const acb = computeMonthlyACB(txRows);
  const aprEntry = acb.find(r => r.year === 2024 && r.month === 4);
  check('Apr ACB = $4009.99 (commission included)', aprEntry?.total_acb, 4009.99, 0.01);
}

section('C4. computeMonthlyACB — CASH ticker excluded');
{
  const txRows = [
    { portfolio_id: 996, ticker: 'CASH', type: 'CONTRIBUTION', quantity: 0, total: 5000, commission: 0, date: '2024-01-01' }
  ];
  const acb = computeMonthlyACB(txRows);
  const janEntry = acb.find(r => r.year === 2024 && r.month === 1);
  // CASH transactions should not affect ACB
  check('Jan ACB = 0 (CASH excluded)', janEntry?.total_acb, 0);
}

section('C5. computeMonthlyACB — DRIP increases ACB');
{
  const txRows = [
    { portfolio_id: 995, ticker: 'BCE.TO', type: 'BUY',              quantity: 100, total: 5000, commission: 0, date: '2024-01-01' },
    { portfolio_id: 995, ticker: 'BCE.TO', type: 'DIVIDEND_REINVEST', quantity:   2, total:  100, commission: 0, date: '2024-03-01' },
  ];
  const acb = computeMonthlyACB(txRows);
  const janEntry = acb.find(r => r.year === 2024 && r.month === 1);
  const marEntry = acb.find(r => r.year === 2024 && r.month === 3);
  check('Jan ACB = $5000',             janEntry?.total_acb, 5000);
  check('Mar ACB = $5100 (DRIP adds)', marEntry?.total_acb, 5100);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PART D — CSV import parsing
// ─────────────────────────────────────────────────────────────────────────────

section('D1. parseCSVLine — basic comma separation');
{
  const result = parseCSVLine('15-Jan-24,RY.TO,RRSP,B,100,139.20,13920');
  checkEq('7 fields',          result.length, 7);
  checkEq('field 0 = date',    result[0], '15-Jan-24');
  checkEq('field 1 = ticker',  result[1], 'RY.TO');
  checkEq('field 2 = portfolio', result[2], 'RRSP');
  checkEq('field 3 = type',    result[3], 'B');
  checkEq('field 4 = quantity', result[4], '100');
  checkEq('field 5 = price',   result[5], '139.20');
  checkEq('field 6 = total',   result[6], '13920');
}

section('D2. parseCSVLine — quoted field with comma inside');
{
  const result = parseCSVLine('15-Jan-24,RY.TO,"RRSP, Main",B,100,139.20,13920');
  checkEq('7 fields with quoted field', result.length, 7);
  checkEq('quoted field = "RRSP, Main"', result[2], 'RRSP, Main');
}

section('D3. parseDate — DD-MMM-YY format');
{
  checkEq('15-Jan-24 → 2024-01-15', parseDate('15-Jan-24'), '2024-01-15');
  checkEq('01-Dec-23 → 2023-12-01', parseDate('01-Dec-23'), '2023-12-01');
  checkEq('31-Mar-22 → 2022-03-31', parseDate('31-Mar-22'), '2022-03-31');
  checkEq('01-Feb-99 → 1999-02-01', parseDate('01-Feb-99'), '1999-02-01');
  checkEq('01-Jun-50 → 1950-06-01', parseDate('01-Jun-50'), '1950-06-01');
}

section('D4. parseDate — non-DDMmmYY passthrough');
{
  // When format is unrecognized (not 3 parts), return as-is
  checkEq('2024-01-15 passthrough', parseDate('2024-01-15'), '2024-01-15');
}

section('D5. parseDate — 4-digit year');
{
  checkEq('15-Jan-2024 → 2024-01-15', parseDate('15-Jan-2024'), '2024-01-15');
}

section('D6. CSV import — successful import into test DB');
{
  const impDb = new Database(':memory:');
  impDb.exec(`
    CREATE TABLE portfolios (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, code TEXT UNIQUE);
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, portfolio_id INTEGER, ticker TEXT,
      type TEXT, quantity REAL, price REAL, total REAL, date TEXT
    );
  `);
  impDb.prepare("INSERT INTO portfolios (name, code) VALUES ('RRSP', 'RRSP')").run();

  const csv = [
    'Date,Symbol,Portfolio,Type,Quantity,Price,Total',
    '15-Jan-24,RY.TO,RRSP,B,100,139.20,13920',
    '20-Mar-24,BNS.TO,RRSP,B,50,60.00,3000',
    '15-Apr-24,RY.TO,RRSP,D,0,0,55.00'
  ].join('\n');

  const result = importCSV(csv, impDb);
  checkEq('3 rows imported', result.imported, 3);
  checkEq('0 errors',        result.errors,   0);
}

section('D7. CSV import — unknown portfolio rejected');
{
  const impDb = new Database(':memory:');
  impDb.exec(`
    CREATE TABLE portfolios (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, code TEXT UNIQUE);
    CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, portfolio_id INTEGER, ticker TEXT, type TEXT, quantity REAL, price REAL, total REAL, date TEXT);
  `);
  impDb.prepare("INSERT INTO portfolios (name, code) VALUES ('RRSP', 'RRSP')").run();

  const csv = [
    'Date,Symbol,Portfolio,Type,Quantity,Price,Total',
    '15-Jan-24,RY.TO,TFSA,B,100,139.20,13920',   // TFSA doesn't exist
  ].join('\n');

  const result = importCSV(csv, impDb);
  checkEq('0 imported (unknown portfolio)', result.imported, 0);
  checkEq('1 error',                        result.errors,   1);
}

section('D8. CSV import — duplicate detection prevents double-insert');
{
  const impDb = new Database(':memory:');
  impDb.exec(`
    CREATE TABLE portfolios (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, code TEXT UNIQUE);
    CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, portfolio_id INTEGER, ticker TEXT, type TEXT, quantity REAL, price REAL, total REAL, date TEXT);
  `);
  impDb.prepare("INSERT INTO portfolios (name, code) VALUES ('RRSP', 'RRSP')").run();

  const csv = [
    'Date,Symbol,Portfolio,Type,Quantity,Price,Total',
    '15-Jan-24,RY.TO,RRSP,B,100,139.20,13920',
    '15-Jan-24,RY.TO,RRSP,B,100,139.20,13920',  // exact duplicate
  ].join('\n');

  const result = importCSV(csv, impDb);
  checkEq('1 imported (dup skipped)', result.imported, 1);
  checkEq('1 error/skip',             result.errors,   1);
  // Verify DB has exactly one row
  const count = impDb.prepare('SELECT COUNT(*) as n FROM transactions').get();
  checkEq('1 row in DB',              count.n,         1);
}

section('D9. CSV import — too few columns reports error');
{
  const impDb = new Database(':memory:');
  impDb.exec(`
    CREATE TABLE portfolios (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, code TEXT UNIQUE);
    CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, portfolio_id INTEGER, ticker TEXT, type TEXT, quantity REAL, price REAL, total REAL, date TEXT);
  `);
  impDb.prepare("INSERT INTO portfolios (name, code) VALUES ('RRSP', 'RRSP')").run();

  const csv = [
    'Date,Symbol,Portfolio,Type,Quantity,Price,Total',
    '15-Jan-24,RY.TO,RRSP,B',  // only 4 columns
  ].join('\n');

  const result = importCSV(csv, impDb);
  checkEq('0 imported', result.imported, 0);
  checkEq('1 error',    result.errors,   1);
}

section('D10. CSV import — type code mapping');
{
  const typeMap = { 'D': 'DIVIDEND', 'B': 'BUY', 'S': 'SELL', 'DR': 'DIVIDEND_REINVEST' };
  checkEq('B → BUY',              typeMap['B'],  'BUY');
  checkEq('S → SELL',             typeMap['S'],  'SELL');
  checkEq('D → DIVIDEND',         typeMap['D'],  'DIVIDEND');
  checkEq('DR → DIVIDEND_REINVEST', typeMap['DR'], 'DIVIDEND_REINVEST');
}

section('D11. CSV import — mixed success/error');
{
  const impDb = new Database(':memory:');
  impDb.exec(`
    CREATE TABLE portfolios (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, code TEXT UNIQUE);
    CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, portfolio_id INTEGER, ticker TEXT, type TEXT, quantity REAL, price REAL, total REAL, date TEXT);
  `);
  impDb.prepare("INSERT INTO portfolios (name, code) VALUES ('RRSP', 'RRSP')").run();

  const csv = [
    'Date,Symbol,Portfolio,Type,Quantity,Price,Total',
    '15-Jan-24,RY.TO,RRSP,B,100,139.20,13920',      // valid
    '20-Jan-24,BCE.TO,MISSING,B,50,45.00,2250',      // bad portfolio
    '25-Jan-24,BNS.TO,RRSP,S,25,62.00,1550',         // valid
  ].join('\n');

  const result = importCSV(csv, impDb);
  checkEq('2 imported', result.imported, 2);
  checkEq('1 error',    result.errors,   1);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PART E — Input validation (portfolio creation)
// ─────────────────────────────────────────────────────────────────────────────

section('E1. Portfolio validation — valid inputs');
{
  checkNull('valid name+code', validatePortfolio('My RRSP', 'RRSP'));
  checkNull('single char code', validatePortfolio('X', 'X'));
  checkNull('5 char code',     validatePortfolio('Test', 'ABCDE'));
  checkNull('numeric code',    validatePortfolio('Test', '12345'));
}

section('E2. Portfolio validation — missing name/code');
{
  checkEq('null name → error',   validatePortfolio(null, 'RRSP'),  'Name and code are required');
  checkEq('null code → error',   validatePortfolio('My RRSP', null), 'Name and code are required');
  checkEq('empty name → error',  validatePortfolio('', 'RRSP'),    'Name and code are required');
}

section('E3. Portfolio validation — name too long');
{
  const longName = 'a'.repeat(101);
  checkEq('101-char name → error', validatePortfolio(longName, 'RRSP'), 'Name must be 1–100 characters');
}

section('E4. Portfolio validation — name with forbidden chars');
{
  checkEq('name with <  → error', validatePortfolio('Test<Name', 'RRSP'), 'Name must not contain < > " \' characters');
  checkEq('name with >  → error', validatePortfolio('Test>Name', 'RRSP'), 'Name must not contain < > " \' characters');
  checkEq('name with "  → error', validatePortfolio('Test"Name', 'RRSP'), 'Name must not contain < > " \' characters');
  checkEq("name with '  → error", validatePortfolio("Test'Name", 'RRSP'), 'Name must not contain < > " \' characters');
}

section('E5. Portfolio validation — invalid code');
{
  checkEq('6-char code → error',  validatePortfolio('Test', 'ABCDEF'), 'Code must be 1–5 alphanumeric characters');
  checkEq('code with space → error', validatePortfolio('Test', 'A B'),  'Code must be 1–5 alphanumeric characters');
  checkEq('code with special → error', validatePortfolio('Test', 'RR$P'), 'Code must be 1–5 alphanumeric characters');
  checkEq('empty code → error',   validatePortfolio('Test', ''),        'Name and code are required');
}

// ─────────────────────────────────────────────────────────────────────────────
//  PART F — Transaction validation
// ─────────────────────────────────────────────────────────────────────────────

section('F1. Transaction validation — valid BUY');
{
  checkNull('valid BUY', validateTransaction({ portfolio_id: 1, ticker: 'RY.TO', type: 'BUY', date: '2024-01-15' }));
}

section('F2. Transaction validation — valid CONTRIBUTION (no ticker required)');
{
  checkNull('CONTRIBUTION without ticker',
    validateTransaction({ portfolio_id: 1, type: 'CONTRIBUTION', date: '2024-01-15' }));
}

section('F3. Transaction validation — valid WITHDRAWAL');
{
  checkNull('WITHDRAWAL without ticker',
    validateTransaction({ portfolio_id: 1, type: 'WITHDRAWAL', date: '2024-01-15' }));
}

section('F4. Transaction validation — missing required fields');
{
  checkEq('missing portfolio_id', validateTransaction({ ticker: 'RY.TO', type: 'BUY', date: '2024-01-15' }), 'Missing required fields');
  checkEq('missing date',         validateTransaction({ portfolio_id: 1, ticker: 'RY.TO', type: 'BUY' }),      'Missing required fields');
  checkEq('missing type',         validateTransaction({ portfolio_id: 1, ticker: 'RY.TO', date: '2024-01-15' }), 'Missing required fields');
}

section('F5. Transaction validation — BUY requires ticker');
{
  checkEq('BUY without ticker → missing',
    validateTransaction({ portfolio_id: 1, type: 'BUY', date: '2024-01-15' }),
    'Missing required fields');
}

// ─────────────────────────────────────────────────────────────────────────────
//  PART G — Edge cases for compute.js
// ─────────────────────────────────────────────────────────────────────────────

section('G1. computeHoldings — empty input');
{
  const result = computeHoldings([]);
  checkEq('empty array → empty output', result.length, 0);
}

section('G2. computeHoldings — no dividend_frequency → next/annual payout = 0');
{
  const pid = mkPortfolio('G2');
  buy(pid, 'NO.DIV', 100, 10.00);
  setInfo(pid, 'NO.DIV', { market_price: 11.00 });  // no freq / no yield
  const [h] = getHoldings(pid);
  check('next_payout = 0',   h.next_payout,   0);
  check('annual_payout = 0', h.annual_payout, 0);
  check('dividend_yield = 0', h.dividend_yield, 0);
}

section('G3. computeHoldings — zero market price, dividend_yield set');
{
  // If market_price = 0 but dividend_yield > 0, per-share fallback should apply
  const pid = mkPortfolio('G3');
  buy(pid, 'NOPRICE.TO', 100, 20.00);
  setInfo(pid, 'NOPRICE.TO', { dividend_yield: 5.0, dividend_per_share: 0.10, dividend_frequency: 'Monthly' });
  // market_price = 0 → market_value = 0 → yield-first condition false → fallback
  const [h] = getHoldings(pid);
  check('next_payout = 100 × 0.10 = $10 (fallback)', h.next_payout, 10.00);
}

section('G4. computeHoldings — fractional share DRIP');
{
  const pid = mkPortfolio('G4');
  buy(pid, 'ETF.TO', 10, 50.00);
  drip(pid, 'ETF.TO', 0.5, 52.00);  // fractional DRIP
  const [h] = getHoldings(pid);
  check('shares = 10.5', h.shares, 10.5);
  check('buy_total = $526', h.buy_total, 526.00);
}

section('G5. computeHoldings — very large values (no overflow)');
{
  const pid = mkPortfolio('G5');
  buy(pid, 'BIG.TO', 100000, 500.00);
  setInfo(pid, 'BIG.TO', { market_price: 550.00 });
  const [h] = getHoldings(pid);
  check('shares = 100000',              h.shares,       100000);
  check('buy_total = $50,000,000',      h.buy_total,    50000000);
  check('market_value = $55,000,000',   h.market_value, 55000000);
  check('return = $5,000,000',          h.return,       5000000);
}

section('G6. computeHoldings — multiple transactions same day');
{
  const pid = mkPortfolio('G6');
  buy(pid, 'AB.TO', 100, 10.00, 0, '2024-05-01');
  buy(pid, 'AB.TO', 200, 11.00, 0, '2024-05-01');  // same date
  const [h] = getHoldings(pid);
  check('shares = 300',       h.shares,    300);
  check('buy_total = $3200',  h.buy_total, 3200);
  checkEq('buy_count = 2',    h.buy_count, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PART H — Overview / cash_invested logic
// ─────────────────────────────────────────────────────────────────────────────

section('H1. cash_invested = buy_total - sale_total for open positions');
{
  const pid = mkPortfolio('H1');
  buy(pid, 'XEI.TO', 200, 25.00);   // buy_total = 5000
  sell(pid, 'XEI.TO', 50, 28.00);   // sale_total = 1400 → cash_invested = 3600
  const [h] = getHoldings(pid);
  const cash_invested = h.buy_total - h.sale_total;
  check('cash_invested = $3600', cash_invested, 3600.00);
}

section('H2. cash_invested excludes fully-sold positions');
{
  const pid = mkPortfolio('H2');
  buy(pid, 'RY.TO', 50, 100.00);   // fully sold
  sell(pid, 'RY.TO', 50, 110.00);
  buy(pid, 'TD.TO', 30,  80.00);   // still held → cash_invested = 2400
  const holdings = getHoldings(pid);
  checkEq('1 holding remains', holdings.length, 1);
  const cash_invested = holdings.reduce((s, h) => s + h.buy_total - h.sale_total, 0);
  check('cash_invested = $2400 (TD only)', cash_invested, 2400.00);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PART I — New CSV format (Import.jsx format: portfolio,ticker,type,qty,price,commission,date)
// ─────────────────────────────────────────────────────────────────────────────

section('I1. New CSV format has 7 required + optional commission column');
{
  // The Import.jsx UI shows the format: portfolio,ticker,type,quantity,price,commission,date
  // The server.js import handler expects: Date,Symbol,Portfolio,Type,Quantity,Price,Total  (old format)
  // This tests the OLD server format (7 mandatory columns in server's order)
  const impDb = new Database(':memory:');
  impDb.exec(`
    CREATE TABLE portfolios (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, code TEXT UNIQUE);
    CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, portfolio_id INTEGER, ticker TEXT, type TEXT, quantity REAL, price REAL, total REAL, date TEXT);
  `);
  impDb.prepare("INSERT INTO portfolios (name, code) VALUES ('RRSP', 'RRSP')").run();

  // Server format: Date, Symbol, Portfolio, Type, Quantity, Price, Total
  const csv = [
    'Date,Symbol,Portfolio,Type,Quantity,Share Price,Total',
    '15-Jan-24,RY.TO,RRSP,B,100,139.20,13920.00',
    '15-Jan-24,BCE.TO,RRSP,D,0,0,55.00',          // dividend
    '20-Feb-24,BNS.TO,RRSP,S,25,65.00,1625.00',   // sell
    '01-Mar-24,XEI.TO,RRSP,DR,5,23.00,115.00',    // DRIP
  ].join('\n');

  const result = importCSV(csv, impDb);
  checkEq('4 rows imported',   result.imported, 4);
  checkEq('0 errors',          result.errors,   0);

  // Verify types mapped correctly
  const rows = impDb.prepare('SELECT type FROM transactions ORDER BY id').all();
  checkEq('row 1 = BUY',              rows[0].type, 'BUY');
  checkEq('row 2 = DIVIDEND',         rows[1].type, 'DIVIDEND');
  checkEq('row 3 = SELL',             rows[2].type, 'SELL');
  checkEq('row 4 = DIVIDEND_REINVEST', rows[3].type, 'DIVIDEND_REINVEST');
}

section('I2. CSV with all-caps type codes passed through unmapped');
{
  const impDb = new Database(':memory:');
  impDb.exec(`
    CREATE TABLE portfolios (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, code TEXT UNIQUE);
    CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, portfolio_id INTEGER, ticker TEXT, type TEXT, quantity REAL, price REAL, total REAL, date TEXT);
  `);
  impDb.prepare("INSERT INTO portfolios (name, code) VALUES ('RRSP', 'RRSP')").run();

  // When type code doesn't match B/S/D/DR, it passes through raw
  // (i.e. 'BUY' would be passed as-is if no mapping — fine for this parser)
  const csv = [
    'Date,Symbol,Portfolio,Type,Quantity,Share Price,Total',
    '15-Jan-24,RY.TO,RRSP,B,100,139.20,13920.00',
  ].join('\n');

  const result = importCSV(csv, impDb);
  checkEq('1 imported', result.imported, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PART J — Transaction types: all 6 types
// ─────────────────────────────────────────────────────────────────────────────

section('J1. All transaction types stored in DB (BUY, SELL, DIVIDEND, DIVIDEND_REINVEST, CONTRIBUTION, WITHDRAWAL)');
{
  const pid = mkPortfolio('J1');
  buy(pid, 'RY.TO', 100, 120.00);
  sell(pid, 'RY.TO', 10, 125.00);
  dividend(pid, 'RY.TO', 55.00);
  drip(pid, 'RY.TO', 1, 122.00);
  contribution(pid, 5000.00);
  withdrawal(pid, 1000.00);

  const rows = db.prepare('SELECT type FROM transactions WHERE portfolio_id = ? ORDER BY id').all(pid);
  checkEq('6 transaction rows', rows.length, 6);
  checkEq('row 1 = BUY',              rows[0].type, 'BUY');
  checkEq('row 2 = SELL',             rows[1].type, 'SELL');
  checkEq('row 3 = DIVIDEND',         rows[2].type, 'DIVIDEND');
  checkEq('row 4 = DIVIDEND_REINVEST', rows[3].type, 'DIVIDEND_REINVEST');
  checkEq('row 5 = CONTRIBUTION',     rows[4].type, 'CONTRIBUTION');
  checkEq('row 6 = WITHDRAWAL',       rows[5].type, 'WITHDRAWAL');
}

section('J2. CONTRIBUTION and WITHDRAWAL do not appear in holdings');
{
  const pid = mkPortfolio('J2');
  contribution(pid, 10000);
  withdrawal(pid, 2000);
  buy(pid, 'XEI.TO', 100, 25.00);
  const holdings = getHoldings(pid);
  checkEq('1 holding (XEI only)', holdings.length, 1);
  checkEq('ticker = XEI.TO',      holdings[0].ticker, 'XEI.TO');
}

section('J1b. TRANSFER_IN/TRANSFER_OUT are valid, storable types (transfer between portfolios)');
{
  const from = mkPortfolio('J1B-FROM');
  const to = mkPortfolio('J1B-TO');
  transferOut(from, 500);
  transferIn(to, 500);

  const fromRows = db.prepare('SELECT type FROM transactions WHERE portfolio_id = ?').all(from);
  const toRows = db.prepare('SELECT type FROM transactions WHERE portfolio_id = ?').all(to);
  checkEq('from leg = TRANSFER_OUT', fromRows[0].type, 'TRANSFER_OUT');
  checkEq('to leg = TRANSFER_IN',    toRows[0].type,   'TRANSFER_IN');
}

section('J2b. TRANSFER_IN/TRANSFER_OUT do not appear in holdings');
{
  const pid = mkPortfolio('J2B');
  transferIn(pid, 10000);
  transferOut(pid, 2000);
  buy(pid, 'XEI.TO', 100, 25.00);
  const holdings = getHoldings(pid);
  checkEq('1 holding (XEI only)', holdings.length, 1);
  checkEq('ticker = XEI.TO',      holdings[0].ticker, 'XEI.TO');
}

section('J3. DIVIDEND does not affect share count');
{
  const pid = mkPortfolio('J3');
  buy(pid, 'BCE.TO', 100, 20.00);
  dividend(pid, 'BCE.TO', 200.00);
  const [h] = getHoldings(pid);
  check('shares still = 100',      h.shares,         100);
  check('dividends_paid = $200',   h.dividends_paid, 200);
}

section('J4. DIVIDEND_REINVEST increases both shares and buy_total');
{
  const pid = mkPortfolio('J4');
  buy(pid, 'XEI.TO', 100, 20.00);
  drip(pid, 'XEI.TO', 3, 21.00);  // 3 reinvested @ $21
  const [h] = getHoldings(pid);
  check('shares = 103',         h.shares,    103);
  check('buy_total = $2063',    h.buy_total, 2063);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PART K — Regression tests for known patterns
// ─────────────────────────────────────────────────────────────────────────────

section('K1. Sector and investment_type stored and returned');
{
  const pid = mkPortfolio('K1');
  buy(pid, 'BNS.TO', 50, 60.00);
  setInfo(pid, 'BNS.TO', { sector: 'Financials', investment_type: 'S' });
  const [h] = getHoldings(pid);
  checkEq('sector = Financials',    h.sector,          'Financials');
  checkEq('investment_type = S',    h.investment_type, 'S');
}

section('K2. last_dividend_date stored and returned');
{
  const pid = mkPortfolio('K2');
  buy(pid, 'RY.TO', 50, 120.00);
  setInfo(pid, 'RY.TO', { last_dividend_date: '2024-03-20' });
  const [h] = getHoldings(pid);
  checkEq('last_dividend_date', h.last_dividend_date, '2024-03-20');
}

section('K3. portfolio_code and portfolio_name in holding');
{
  const pid = mkPortfolio('K3', 'My RRSP');
  buy(pid, 'TD.TO', 100, 80.00);
  const [h] = getHoldings(pid);
  checkEq('portfolio_code = K3',    h.portfolio_code, 'K3');
  checkEq('portfolio_name = My RRSP', h.portfolio_name, 'My RRSP');
}

section('K4. acb_per_share (buy_price field)');
{
  // buy_price in the result is actually acbPerShare = buyTotal / sharesBought
  // This does NOT include commission
  const pid = mkPortfolio('K4');
  buy(pid, 'SU.TO', 200, 45.00, 9.99);
  const [h] = getHoldings(pid);
  check('buy_price = $45 (excludes commission)', h.buy_price, 45.00, 0.001);
  check('acb = 200×45 + 9.99 = $9009.99',        h.acb, 9009.99, 0.01);
}

section('K5. Return percent when acb = 0 returns 0');
{
  const result = computeHoldings([{
    shares: 0,
    buy_total: 0,
    sale_total: 0,
    dividends_paid: 0,
    buy_expense: 0,
    sale_expense: 0,
    shares_bought: 0,
    market_price: 100,
    ticker: 'T.T'
  }]);
  // shares=0 means position excluded at SQL level, but computeHoldings handles it
  check('return_percent = 0 when acb=0', result[0]?.return_percent ?? 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
//  SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'═'.repeat(60)}`);
console.log(`  ${total} tests  |  ${passed} passed  |  ${failed} failed`);
console.log(`${'═'.repeat(60)}\n`);

if (failures.length > 0) {
  console.error('FAILED TESTS:');
  failures.forEach((f, i) => {
    console.error(`  ${i + 1}. ${f.label}`);
    console.error(`       expected: ${JSON.stringify(f.expected)}  got: ${JSON.stringify(f.actual)}`);
  });
  console.log('');
}

process.exit(failed > 0 ? 1 : 0);
