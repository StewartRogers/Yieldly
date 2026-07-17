'use strict';

/**
 * Yieldly Authentication Test Suite
 *
 * Drives the REAL Express app (app.js / createApp) against an in-memory libSQL
 * database (database.js / createDb ':memory:'). This is the suite that exercises
 * the real async stack: the libSQL schema/migrations, the route handlers, the
 * auth guard, and stateless JWT cookies. No hand-copied schema or routes.
 *
 * Usage:  node test-auth.js
 */

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createApp } = require('./app');
const { createDb } = require('./database');

const SESSION_SECRET = crypto.randomBytes(16).toString('hex');

// libSQL ':memory:' is per-connection — an interactive transaction can open a
// fresh empty in-memory DB. Back each test app with a unique temp file so all
// connections share one database (mirrors local `file:` / remote Turso, where
// this is a non-issue). Tracked for cleanup on exit.
const tempDbFiles = [];
function tempDbUrl() {
  const file = path.join(os.tmpdir(), `yieldly-test-${crypto.randomBytes(6).toString('hex')}.db`);
  tempDbFiles.push(file);
  return `file:${file}`;
}
function cleanupTempDbs() {
  for (const f of tempDbFiles) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(f + suffix); } catch { /* ignore */ }
    }
  }
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

let BASE;

function req(method, path, body, cookie, base = BASE, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname, headers: { ...extraHeaders } };
    if (body) {
      const payload = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
      opts._body = payload;
    }
    if (cookie) opts.headers['Cookie'] = cookie;

    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, cookie: setCookie });
      });
    });
    r.on('error', reject);
    if (opts._body) r.write(opts._body);
    r.end();
  });
}

// Extract the JWT auth cookie (token=...) from a Set-Cookie header list.
function extractToken(setCookieHeaders) {
  if (!setCookieHeaders) return null;
  for (const h of setCookieHeaders) {
    const m = h.match(/(?:^|\s)token=([^;]+)/);
    if (m && m[1] && m[1] !== '') return `token=${m[1]}`;
  }
  return null;
}

// ─── Assertion helpers (same style as test.js) ───────────────────────────────

let passed = 0, failed = 0;

function check(label, actual, expected, tolerance = 0.005) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) { console.log(`  ✓  ${label}`); passed++; }
  else { console.error(`  ✗  ${label}\n       expected ${expected}, got ${actual}`); failed++; }
}

function checkEq(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { console.log(`  ✓  ${label}`); passed++; }
  else { console.error(`  ✗  ${label}\n       expected "${expected}", got "${actual}"`); failed++; }
}

function checkTruthy(label, actual) {
  if (actual) { console.log(`  ✓  ${label}`); passed++; }
  else { console.error(`  ✗  ${label}\n       expected truthy, got "${actual}"`); failed++; }
}

function section(title) { const pad = Math.max(2, 50 - title.length); console.log(`\n── ${title} ${'─'.repeat(pad)}`); }

// Boot an app+server over a fresh in-memory libSQL DB. Returns { base, close }.
async function bootApp(options = {}) {
  const db = await createDb(tempDbUrl());
  const app = createApp(db, { sessionSecret: SESSION_SECRET, ...options });
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const { port } = server.address();
      resolve({ base: `http://127.0.0.1:${port}`, close: () => server.close(), db });
    });
  });
}

// ─── Test runner ─────────────────────────────────────────────────────────────

async function run() {

  // ── 1. Session check on fresh DB (needsSetup) ──────────────────────────────
  section('1. Session – fresh DB returns needsSetup');
  {
    const r = await req('GET', '/api/auth/session');
    checkEq('status = 200', r.status, 200);
    checkEq('authenticated = false', r.body.authenticated, false);
    checkEq('needsSetup = true', r.body.needsSetup, true);
  }

  // ── 2. Protected route rejects unauthenticated request ─────────────────────
  section('2. Auth guard – 401 without token');
  {
    const r = await req('GET', '/api/portfolios');
    checkEq('status = 401', r.status, 401);
    checkEq('error message', r.body.error, 'Authentication required');
  }

  // ── 3. Setup validation ────────────────────────────────────────────────────
  section('3. Setup – input validation');
  {
    const r1 = await req('POST', '/api/auth/setup', { username: 'a', password: 'longpassword' });
    checkEq('short username → 400', r1.status, 400);

    const r2 = await req('POST', '/api/auth/setup', { username: 'admin', password: 'short' });
    checkEq('short password → 400', r2.status, 400);

    const r3 = await req('POST', '/api/auth/setup', { password: 'longpassword' });
    checkEq('missing username → 400', r3.status, 400);

    const r4 = await req('POST', '/api/auth/setup', { username: 'admin' });
    checkEq('missing password → 400', r4.status, 400);
  }

  // ── 4. Successful setup ────────────────────────────────────────────────────
  section('4. Setup – create superuser');
  {
    const r = await req('POST', '/api/auth/setup', { username: 'admin', password: 'testpass123' });
    checkEq('status = 200', r.status, 200);
    checkEq('success = true', r.body.success, true);
    checkEq('username returned', r.body.user.username, 'admin');
    checkTruthy('user id returned', r.body.user.id);
    checkTruthy('auth cookie set', extractToken(r.cookie));
  }

  // ── 5. Setup rejects when user already exists ──────────────────────────────
  section('5. Setup – blocked after user exists');
  {
    const r = await req('POST', '/api/auth/setup', { username: 'hacker', password: 'longpassword' });
    checkEq('status = 403', r.status, 403);
    checkEq('error message', r.body.error, 'Setup already completed');
  }

  // ── 6. Session check after setup (needsSetup = false) ──────────────────────
  section('6. Session – needsSetup false after user exists');
  {
    const r = await req('GET', '/api/auth/session');
    checkEq('needsSetup = false', r.body.needsSetup, false);
    checkEq('authenticated = false (no cookie sent)', r.body.authenticated, false);
  }

  // ── 7. Login validation ────────────────────────────────────────────────────
  section('7. Login – input validation');
  {
    const r1 = await req('POST', '/api/auth/login', { username: 'admin' });
    checkEq('missing password → 400', r1.status, 400);

    const r2 = await req('POST', '/api/auth/login', { password: 'testpass123' });
    checkEq('missing username → 400', r2.status, 400);
  }

  // ── 8. Login with wrong credentials ────────────────────────────────────────
  section('8. Login – wrong credentials');
  {
    const r1 = await req('POST', '/api/auth/login', { username: 'admin', password: 'wrongpassword' });
    checkEq('wrong password → 401', r1.status, 401);
    checkEq('error message', r1.body.error, 'Invalid username or password');

    const r2 = await req('POST', '/api/auth/login', { username: 'nobody', password: 'testpass123' });
    checkEq('wrong username → 401', r2.status, 401);
  }

  // ── 9. Successful login ────────────────────────────────────────────────────
  section('9. Login – correct credentials');
  let authCookie;
  {
    const r = await req('POST', '/api/auth/login', { username: 'admin', password: 'testpass123' });
    checkEq('status = 200', r.status, 200);
    checkEq('success = true', r.body.success, true);
    checkEq('username = admin', r.body.user.username, 'admin');
    authCookie = extractToken(r.cookie);
    checkTruthy('auth cookie set', authCookie);
  }

  // ── 10. Session check with valid cookie ────────────────────────────────────
  section('10. Session – authenticated with cookie');
  {
    const r = await req('GET', '/api/auth/session', null, authCookie);
    checkEq('status = 200', r.status, 200);
    checkEq('authenticated = true', r.body.authenticated, true);
    checkEq('username = admin', r.body.user.username, 'admin');
  }

  // ── 11. Protected route accessible with token ──────────────────────────────
  section('11. Auth guard – allows authenticated request');
  {
    const r = await req('GET', '/api/portfolios', null, authCookie);
    checkEq('status = 200', r.status, 200);
    checkTruthy('returns array', Array.isArray(r.body));
  }

  // ── 12. Protected POST route with token ────────────────────────────────────
  section('12. Auth guard – POST with token');
  {
    const r = await req('POST', '/api/portfolios', { name: 'Test', code: 'TST' }, authCookie);
    checkEq('status = 200', r.status, 200);
    checkEq('portfolio created', r.body.code, 'TST');
  }

  // ── 13. Change password validation ─────────────────────────────────────────
  section('13. Change password – validation');
  {
    const r1 = await req('POST', '/api/change-password', {}, authCookie);
    checkEq('missing fields → 400', r1.status, 400);

    const r2 = await req('POST', '/api/change-password',
      { currentPassword: 'testpass123', newPassword: 'short' }, authCookie);
    checkEq('short new password → 400', r2.status, 400);

    const r3 = await req('POST', '/api/change-password',
      { currentPassword: 'wrongcurrent', newPassword: 'newpass12345' }, authCookie);
    checkEq('wrong current password → 401', r3.status, 401);
  }

  // ── 14. Change password without token ──────────────────────────────────────
  section('14. Change password – requires auth');
  {
    const r = await req('POST', '/api/change-password',
      { currentPassword: 'testpass123', newPassword: 'newpass12345' });
    checkEq('no cookie → 401', r.status, 401);
  }

  // ── 15. Successful password change ─────────────────────────────────────────
  section('15. Change password – success');
  {
    const r = await req('POST', '/api/change-password',
      { currentPassword: 'testpass123', newPassword: 'newpass12345' }, authCookie);
    checkEq('status = 200', r.status, 200);
    checkEq('success = true', r.body.success, true);
    authCookie = extractToken(r.cookie) || authCookie; // token re-issued on change
  }

  // ── 16. Login with new password ────────────────────────────────────────────
  section('16. Login – with changed password');
  {
    const r1 = await req('POST', '/api/auth/login', { username: 'admin', password: 'testpass123' });
    checkEq('old password rejected → 401', r1.status, 401);

    const r2 = await req('POST', '/api/auth/login', { username: 'admin', password: 'newpass12345' });
    checkEq('new password accepted → 200', r2.status, 200);
    authCookie = extractToken(r2.cookie);
  }

  // ── 17. Logout ─────────────────────────────────────────────────────────────
  section('17. Logout');
  {
    const r = await req('POST', '/api/auth/logout', null, authCookie);
    checkEq('status = 200', r.status, 200);
    checkEq('success = true', r.body.success, true);
  }

  // ── 18. Token tampering rejected ───────────────────────────────────────────
  section('18. Auth guard – tampered token rejected');
  {
    const tampered = (authCookie || 'token=x') + 'tampered';
    const r = await req('GET', '/api/auth/session', null, tampered);
    checkEq('authenticated = false', r.body.authenticated, false);
  }

  // ── 19. Protected route rejected with tampered token ───────────────────────
  section('19. Auth guard – 401 with tampered token');
  {
    const r = await req('GET', '/api/portfolios', null, 'token=not-a-valid-jwt');
    checkEq('status = 401', r.status, 401);
  }

  // ── 20. Username trimming ──────────────────────────────────────────────────
  section('20. Login – username trimmed');
  {
    const r = await req('POST', '/api/auth/login', { username: '  admin  ', password: 'newpass12345' });
    checkEq('trimmed username accepted → 200', r.status, 200);
    checkEq('returned username trimmed', r.body.user.username, 'admin');
  }

  // ── 21. Portfolio delete cascades to transactions/stock_info ───────────────
  section('21. Portfolio delete – explicit cascade');
  {
    const login = await req('POST', '/api/auth/login', { username: 'admin', password: 'newpass12345' });
    const cookie = extractToken(login.cookie);
    const created = await req('POST', '/api/portfolios', { name: 'Cascade', code: 'CAS' }, cookie);
    const pid = created.body.id;
    await req('POST', '/api/transactions',
      { portfolio_id: pid, ticker: 'RY.TO', type: 'BUY', quantity: 10, price: 100, date: '2024-01-01' }, cookie);
    const del = await req('DELETE', `/api/portfolios/${pid}`, null, cookie);
    checkEq('delete → 200', del.status, 200);
    const txns = await req('GET', `/api/portfolios/${pid}/transactions`, null, cookie);
    checkEq('transactions gone after cascade', Array.isArray(txns.body) ? txns.body.length : -1, 0);
  }

  // ── 22. Rate limiting on login ─────────────────────────────────────────────
  section('22. Login – rate limited after too many attempts');
  {
    const limited = await bootApp({ rateLimit: { windowMs: 60000, max: 3 } });
    try {
      let last;
      for (let i = 0; i < 4; i++) {
        last = await req('POST', '/api/auth/login', { username: 'nobody', password: 'x' }, null, limited.base);
      }
      checkEq('4th attempt → 429', last.status, 429);
      checkEq('rate-limit error message', last.body.error, 'Too many attempts. Please try again later.');
    } finally {
      limited.close();
    }
  }

  // ── 23-26. Full backup (complete export / import) ──────────────────────────
  // Runs against a dedicated app so the destructive replace-all import can't
  // disturb the shared main-suite DB. Sets up a user + portfolio + transactions
  // + stock_info, then exercises export, the auth guard, replace-all import,
  // round-trip fidelity, and payload validation.
  const backup = await bootApp();
  try {
    // 23. Export shape + auth guard
    section('23. Full backup – export shape & auth guard');
    const noauth = await req('GET', '/api/export', null, null, backup.base);
    checkEq('export without token → 401', noauth.status, 401);

    const setup = await req('POST', '/api/auth/setup', { username: 'owner', password: 'backuppass123' }, null, backup.base);
    const cookie = extractToken(setup.cookie);

    const p = await req('POST', '/api/portfolios', { name: 'Registered', code: 'REG' }, cookie, backup.base);
    const pid = p.body.id;
    await req('POST', '/api/transactions',
      { portfolio_id: pid, ticker: 'RY.TO', type: 'BUY', quantity: 10, price: 100, total: 1000, date: '2024-01-02' }, cookie, backup.base);
    await req('POST', '/api/transactions',
      { portfolio_id: pid, ticker: 'RY.TO', type: 'DIVIDEND', quantity: 0, price: 0, total: 12, date: '2024-03-15' }, cookie, backup.base);
    await req('PUT', `/api/portfolios/${pid}/stocks/RY.TO`,
      { sector: 'Financials', investment_type: 'Stock', dividend_per_share: 1.2 }, cookie, backup.base);

    const exp = await req('GET', '/api/export', null, cookie, backup.base);
    checkEq('export → 200', exp.status, 200);
    checkEq('version = 1', exp.body.version, 1);
    checkTruthy('exportedAt present', exp.body.exportedAt);
    checkEq('1 portfolio exported', exp.body.portfolios.length, 1);
    checkEq('2 transactions exported', exp.body.transactions.length, 2);
    checkEq('1 stock_info exported', exp.body.stock_info.length, 1);
    checkEq('stock_info sector carried', exp.body.stock_info[0].sector, 'Financials');
    checkEq('portfolio code carried', exp.body.portfolios[0].code, 'REG');

    // 24. Import auth guard + validation
    section('24. Full backup – import auth guard & validation');
    const impNoAuth = await req('POST', '/api/import', { version: 1, portfolios: [], transactions: [], stock_info: [] }, null, backup.base);
    checkEq('import without token → 401', impNoAuth.status, 401);

    const badVersion = await req('POST', '/api/import', { version: 99, portfolios: [], transactions: [], stock_info: [] }, cookie, backup.base);
    checkEq('wrong version → 400', badVersion.status, 400);

    const missingArrays = await req('POST', '/api/import', { version: 1 }, cookie, backup.base);
    checkEq('missing arrays → 400', missingArrays.status, 400);

    const badType = await req('POST', '/api/import', {
      version: 1,
      portfolios: [{ id: 1, name: 'X', code: 'X' }],
      transactions: [{ id: 1, portfolio_id: 1, ticker: 'X', type: 'FROB', quantity: 1, price: 1, total: 1, date: '2024-01-01' }],
      stock_info: [],
    }, cookie, backup.base);
    checkEq('invalid tx type → 400', badType.status, 400);

    const orphan = await req('POST', '/api/import', {
      version: 1,
      portfolios: [{ id: 1, name: 'X', code: 'X' }],
      transactions: [{ id: 1, portfolio_id: 999, ticker: 'X', type: 'BUY', quantity: 1, price: 1, total: 1, date: '2024-01-01' }],
      stock_info: [],
    }, cookie, backup.base);
    checkEq('orphan portfolio_id → 400', orphan.status, 400);

    const missingTicker = await req('POST', '/api/import', {
      version: 1,
      portfolios: [{ id: 1, name: 'X', code: 'X' }],
      transactions: [{ id: 1, portfolio_id: 1, type: 'BUY', quantity: 1, price: 1, total: 1, date: '2024-01-01' }],
      stock_info: [],
    }, cookie, backup.base);
    checkEq('missing ticker → 400 (not 500)', missingTicker.status, 400);

    const nullTotal = await req('POST', '/api/import', {
      version: 1,
      portfolios: [{ id: 1, name: 'X', code: 'X' }],
      transactions: [{ id: 1, portfolio_id: 1, ticker: 'X', type: 'BUY', quantity: 1, price: 1, total: null, date: '2024-01-01' }],
      stock_info: [],
    }, cookie, backup.base);
    checkEq('null numeric field → 400 (not 500)', nullTotal.status, 400);

    const dupId = await req('POST', '/api/import', {
      version: 1,
      portfolios: [{ id: 1, name: 'A', code: 'A' }, { id: 1, name: 'B', code: 'B' }],
      transactions: [],
      stock_info: [],
    }, cookie, backup.base);
    checkEq('duplicate portfolio id → 400 (not 500)', dupId.status, 400);

    // Failed imports must not have touched the existing data.
    const afterBad = await req('GET', '/api/export', null, cookie, backup.base);
    checkEq('data intact after rejected imports', afterBad.body.portfolios.length, 1);

    // Count endpoint mirrors the export, cheaply.
    const countsNoAuth = await req('GET', '/api/export/counts', null, null, backup.base);
    checkEq('counts without token → 401', countsNoAuth.status, 401);
    const cnt = await req('GET', '/api/export/counts', null, cookie, backup.base);
    checkEq('counts portfolios = 1', cnt.body.portfolios, 1);
    checkEq('counts transactions = 2', cnt.body.transactions, 2);
    checkEq('counts stock_info = 1', cnt.body.stock_info, 1);

    // 25. Round-trip fidelity: export → import same → unchanged
    section('25. Full backup – round-trip preserves data');
    const roundtrip = await req('POST', '/api/import', exp.body, cookie, backup.base);
    checkEq('round-trip import → 200', roundtrip.status, 200);
    checkEq('imported portfolios count', roundtrip.body.imported.portfolios, 1);
    checkEq('imported transactions count', roundtrip.body.imported.transactions, 2);
    const reExp = await req('GET', '/api/export', null, cookie, backup.base);
    checkEq('still 1 portfolio', reExp.body.portfolios.length, 1);
    checkEq('still 2 transactions', reExp.body.transactions.length, 2);
    checkEq('still 1 stock_info', reExp.body.stock_info.length, 1);
    checkEq('portfolio id preserved', reExp.body.portfolios[0].id, exp.body.portfolios[0].id);
    checkEq('stock_info sector preserved', reExp.body.stock_info[0].sector, 'Financials');

    // 26. Replace-all semantics: a different backup wipes prior data
    section('26. Full backup – import replaces all data');
    const replacement = {
      version: 1,
      portfolios: [{ id: 50, name: 'TFSA', code: 'TFSA', display_order: 0, cash_balance: 250 }],
      transactions: [{ id: 70, portfolio_id: 50, ticker: 'ENB.TO', type: 'BUY', quantity: 5, price: 50, total: 250, commission: 0, date: '2025-02-02', market: 'TMX' }],
      stock_info: [{ id: 90, portfolio_id: 50, ticker: 'ENB.TO', sector: 'Energy', investment_type: 'Stock' }],
    };
    const repRes = await req('POST', '/api/import', replacement, cookie, backup.base);
    checkEq('replace import → 200', repRes.status, 200);
    const afterReplace = await req('GET', '/api/export', null, cookie, backup.base);
    checkEq('old REG portfolio gone', afterReplace.body.portfolios.filter(p => p.code === 'REG').length, 0);
    checkEq('new TFSA portfolio present', afterReplace.body.portfolios.filter(p => p.code === 'TFSA').length, 1);
    checkEq('cash_balance carried', afterReplace.body.portfolios[0].cash_balance, 250);
    checkEq('only replacement transactions', afterReplace.body.transactions.length, 1);
    checkEq('user still logged in after import', (await req('GET', '/api/auth/session', null, cookie, backup.base)).body.authenticated, true);
  } finally {
    backup.close();
  }

  // 27. Import keeps the portfolios.json backup hook in step (like other mutations)
  section('27. Full backup – import fires backupPortfolios hook');
  {
    let hookCalls = 0;
    const hooked = await bootApp({ backupPortfolios: async () => { hookCalls += 1; } });
    try {
      const s = await req('POST', '/api/auth/setup', { username: 'owner', password: 'backuppass123' }, null, hooked.base);
      const c = extractToken(s.cookie);
      const before = hookCalls;
      const r = await req('POST', '/api/import', {
        version: 1,
        portfolios: [{ id: 1, name: 'Main', code: 'MAIN', cash_balance: 0 }],
        transactions: [],
        stock_info: [],
      }, c, hooked.base);
      checkEq('import → 200', r.status, 200);
      checkTruthy('backupPortfolios called after import', hookCalls > before);
    } finally {
      hooked.close();
    }
  }

  // ── 28-33. Portfolio value snapshots (cron + manual backfill) ──────────────
  // Runs against a dedicated app with a CRON_SECRET configured so the cron
  // route's bearer-token guard can be exercised without touching the shared
  // main-suite DB. The seeded portfolio has cash only (no transactions), so
  // performRefreshAllPrices() short-circuits with zero holdings and the cron
  // handler never makes a real network call to TMX/Yahoo.
  const CRON_SECRET = 'test-cron-secret';
  const snap = await bootApp({ cronSecret: CRON_SECRET });
  try {
    const setup = await req('POST', '/api/auth/setup', { username: 'owner', password: 'snappass123' }, null, snap.base);
    const cookie = extractToken(setup.cookie);
    const p = await req('POST', '/api/portfolios', { name: 'Snapshot', code: 'SNAP' }, cookie, snap.base);
    const pid = p.body.id;
    await req('PUT', `/api/portfolios/${pid}/cash-balance`, { cash_balance: 500 }, cookie, snap.base);

    section('28. Cron snapshot – bearer token guard');
    const noHeader = await req('GET', '/api/cron/snapshot-values', null, null, snap.base);
    checkEq('no Authorization header → 401', noHeader.status, 401);

    const wrongHeader = await req('GET', '/api/cron/snapshot-values', null, null, snap.base,
      { Authorization: 'Bearer wrong-secret' });
    checkEq('wrong bearer token → 401', wrongHeader.status, 401);

    section('29. Cron snapshot – records a row per portfolio');
    const run1 = await req('GET', '/api/cron/snapshot-values', null, null, snap.base,
      { Authorization: `Bearer ${CRON_SECRET}` });
    checkEq('status = 200', run1.status, 200);
    checkEq('1 portfolio written', run1.body.written, 1);

    const rows1 = await req('GET', '/api/summary/value-snapshots', null, cookie, snap.base);
    checkEq('1 snapshot row', rows1.body.length, 1);
    checkEq('portfolio code', rows1.body[0].portfolio_code, 'SNAP');
    check('total_value = cash balance (no holdings)', rows1.body[0].total_value, 500);
    checkEq('source = cron', rows1.body[0].source, 'cron');

    section('30. Cron snapshot – idempotent same-day re-run');
    await req('PUT', `/api/portfolios/${pid}/cash-balance`, { cash_balance: 750 }, cookie, snap.base);
    const run2 = await req('GET', '/api/cron/snapshot-values', null, null, snap.base,
      { Authorization: `Bearer ${CRON_SECRET}` });
    checkEq('re-run status = 200', run2.status, 200);
    const rows2 = await req('GET', '/api/summary/value-snapshots', null, cookie, snap.base);
    checkEq('still 1 snapshot row (upsert, not duplicate)', rows2.body.length, 1);
    check('total_value updated to new cash balance', rows2.body[0].total_value, 750);

    section('31. Manual value-snapshot – auth guard & validation');
    const noAuth = await req('PUT', `/api/portfolios/${pid}/value-snapshots/2020-01-31`, { total_value: 100 }, null, snap.base);
    checkEq('no cookie → 401', noAuth.status, 401);

    const badDate = await req('PUT', `/api/portfolios/${pid}/value-snapshots/not-a-date`, { total_value: 100 }, cookie, snap.base);
    checkEq('malformed date → 400', badDate.status, 400);

    const badValue = await req('PUT', `/api/portfolios/${pid}/value-snapshots/2020-01-31`, { total_value: 'abc' }, cookie, snap.base);
    checkEq('non-numeric total_value → 400', badValue.status, 400);

    const negValue = await req('PUT', `/api/portfolios/${pid}/value-snapshots/2020-01-31`, { total_value: -5 }, cookie, snap.base);
    checkEq('negative total_value → 400', negValue.status, 400);

    section('32. Manual value-snapshot – backfill a historical value');
    const backfill = await req('PUT', `/api/portfolios/${pid}/value-snapshots/2020-01-31`, { total_value: 12345 }, cookie, snap.base);
    checkEq('backfill → 200', backfill.status, 200);

    const rows3 = await req('GET', '/api/summary/value-snapshots', null, cookie, snap.base);
    const backfilled = rows3.body.find(r => r.date === '2020-01-31');
    checkTruthy('backfilled row present', backfilled);
    check('backfilled total_value', backfilled.total_value, 12345);
    checkEq('backfilled source = manual', backfilled.source, 'manual');
    checkEq('cron row untouched by backfill', rows3.body.length, 2);

    section('33. Manual value-snapshot – delete');
    const del = await req('DELETE', `/api/portfolios/${pid}/value-snapshots/2020-01-31`, null, cookie, snap.base);
    checkEq('delete → 200', del.status, 200);
    const rows4 = await req('GET', '/api/summary/value-snapshots', null, cookie, snap.base);
    checkEq('backfilled row gone', rows4.body.some(r => r.date === '2020-01-31'), false);
  } finally {
    snap.close();
  }

  // ── 34-38. Cash transactions: auto cash_balance + transfers ────────────────
  // Runs against a dedicated app so cash_balance assertions can't be thrown off
  // by transactions the shared main-suite DB accumulates elsewhere.
  const cash = await bootApp();
  try {
    const setup = await req('POST', '/api/auth/setup', { username: 'owner', password: 'cashpass123' }, null, cash.base);
    const cookie = extractToken(setup.cookie);
    const getBalance = async (pid) => {
      const list = await req('GET', '/api/portfolios', null, cookie, cash.base);
      return list.body.find(p => p.id === pid).cash_balance;
    };

    section('34. CONTRIBUTION/WITHDRAWAL auto-adjust cash_balance');
    const p1 = await req('POST', '/api/portfolios', { name: 'Cash A', code: 'CASHA' }, cookie, cash.base);
    const p1id = p1.body.id;
    checkEq('starts untracked (null)', await getBalance(p1id), null);

    const contrib = await req('POST', '/api/transactions',
      { portfolio_id: p1id, type: 'CONTRIBUTION', total: 500, date: '2024-01-01' }, cookie, cash.base);
    checkEq('contribution → 200', contrib.status, 200);
    check('cash_balance starts tracking from 0 (+500)', await getBalance(p1id), 500);

    const withdraw = await req('POST', '/api/transactions',
      { portfolio_id: p1id, type: 'WITHDRAWAL', total: 200, date: '2024-01-05' }, cookie, cash.base);
    checkEq('withdrawal → 200', withdraw.status, 200);
    check('cash_balance = 500 - 200', await getBalance(p1id), 300);

    const delWithdraw = await req('DELETE', `/api/transactions/${withdraw.body.id}`, null, cookie, cash.base);
    checkEq('delete withdrawal → 200', delWithdraw.status, 200);
    check('cash_balance reverts to 500', await getBalance(p1id), 500);

    const delContrib = await req('DELETE', `/api/transactions/${contrib.body.id}`, null, cookie, cash.base);
    checkEq('delete contribution → 200', delContrib.status, 200);
    check('cash_balance reverts to 0', await getBalance(p1id), 0);

    section('35. POST /api/transactions rejects TRANSFER_IN/TRANSFER_OUT directly');
    const directTransfer = await req('POST', '/api/transactions',
      { portfolio_id: p1id, type: 'TRANSFER_IN', total: 100, date: '2024-01-01' }, cookie, cash.base);
    checkEq('direct TRANSFER_IN → 400', directTransfer.status, 400);

    section('36. POST /api/transfers – happy path + validation');
    const p2 = await req('POST', '/api/portfolios', { name: 'Cash B', code: 'CASHB' }, cookie, cash.base);
    const p2id = p2.body.id;

    const badSame = await req('POST', '/api/transfers',
      { from_portfolio_id: p1id, to_portfolio_id: p1id, amount: 100, date: '2024-02-01' }, cookie, cash.base);
    checkEq('same portfolio on both sides → 400', badSame.status, 400);

    const badAmount = await req('POST', '/api/transfers',
      { from_portfolio_id: p1id, to_portfolio_id: p2id, amount: -50, date: '2024-02-01' }, cookie, cash.base);
    checkEq('negative amount → 400', badAmount.status, 400);

    const badPortfolio = await req('POST', '/api/transfers',
      { from_portfolio_id: p1id, to_portfolio_id: 999999, amount: 50, date: '2024-02-01' }, cookie, cash.base);
    checkEq('nonexistent portfolio → 404', badPortfolio.status, 404);

    const xfer = await req('POST', '/api/transfers',
      { from_portfolio_id: p1id, to_portfolio_id: p2id, amount: 300, date: '2024-02-01' }, cookie, cash.base);
    checkEq('transfer → 200', xfer.status, 200);
    checkEq('from leg type', xfer.body.from.type, 'TRANSFER_OUT');
    checkEq('to leg type', xfer.body.to.type, 'TRANSFER_IN');
    check('from cash_balance -= 300', await getBalance(p1id), -300);
    check('to cash_balance += 300', await getBalance(p2id), 300);

    const fromTxns = await req('GET', `/api/portfolios/${p1id}/transactions`, null, cookie, cash.base);
    const outRow = fromTxns.body.find(t => t.id === xfer.body.from.id);
    checkEq('from leg links to CASHB', outRow.transfer_peer_code, 'CASHB');
    const toTxns = await req('GET', `/api/portfolios/${p2id}/transactions`, null, cookie, cash.base);
    const inRow = toTxns.body.find(t => t.id === xfer.body.to.id);
    checkEq('to leg links to CASHA', inRow.transfer_peer_code, 'CASHA');

    section('37. DELETE either leg of a transfer removes both legs and reverses both balances');
    const delLeg = await req('DELETE', `/api/transactions/${xfer.body.from.id}`, null, cookie, cash.base);
    checkEq('delete leg → 200', delLeg.status, 200);
    check('from cash_balance reverts to 0', await getBalance(p1id), 0);
    check('to cash_balance reverts to 0', await getBalance(p2id), 0);
    const toTxnsAfter = await req('GET', `/api/portfolios/${p2id}/transactions`, null, cookie, cash.base);
    checkEq('peer leg also deleted', toTxnsAfter.body.some(t => t.id === xfer.body.to.id), false);

    section('38. GET /api/cashflow/monthly nets contributions/withdrawals/transfers');
    await req('POST', '/api/transactions',
      { portfolio_id: p1id, type: 'CONTRIBUTION', total: 1000, date: '2024-03-10' }, cookie, cash.base);
    await req('POST', '/api/transactions',
      { portfolio_id: p1id, type: 'WITHDRAWAL', total: 200, date: '2024-03-15' }, cookie, cash.base);
    await req('POST', '/api/transfers',
      { from_portfolio_id: p1id, to_portfolio_id: p2id, amount: 300, date: '2024-03-20' }, cookie, cash.base);

    const flow = await req('GET', '/api/cashflow/monthly', null, cookie, cash.base);
    const casha = flow.body.find(r => r.portfolio_code === 'CASHA' && r.year === 2024 && r.month === 3);
    const cashb = flow.body.find(r => r.portfolio_code === 'CASHB' && r.year === 2024 && r.month === 3);
    check('CASHA net = 1000 - 200 - 300', casha.net, 500);
    check('CASHB net = +300 (transfer in)', cashb.net, 300);
    check('combined net = external contributions only (transfer cancels)', casha.net + cashb.net, 800);

    section('39. POST /api/transactions – share-ownership/quantity and duplicate guards');
    const sellNeverOwned = await req('POST', '/api/transactions',
      { portfolio_id: p1id, ticker: 'XYZ', type: 'SELL', quantity: 10, price: 5, date: '2024-04-01' }, cookie, cash.base);
    checkEq('SELL a ticker never bought → 400', sellNeverOwned.status, 400);

    const divNeverOwned = await req('POST', '/api/transactions',
      { portfolio_id: p1id, ticker: 'XYZ', type: 'DIVIDEND', total: 5, date: '2024-04-01' }, cookie, cash.base);
    checkEq('DIVIDEND on a ticker never bought → 400', divNeverOwned.status, 400);

    const buy = await req('POST', '/api/transactions',
      { portfolio_id: p1id, ticker: 'XYZ', type: 'BUY', quantity: 10, price: 5, total: 50, date: '2024-04-01' }, cookie, cash.base);
    checkEq('BUY 10 shares → 200', buy.status, 200);

    const sellTooMany = await req('POST', '/api/transactions',
      { portfolio_id: p1id, ticker: 'XYZ', type: 'SELL', quantity: 11, price: 6, total: 66, date: '2024-04-02' }, cookie, cash.base);
    checkEq('SELL more than held → 400', sellTooMany.status, 400);

    const sellAll = await req('POST', '/api/transactions',
      { portfolio_id: p1id, ticker: 'XYZ', type: 'SELL', quantity: 10, price: 6, total: 60, date: '2024-04-03' }, cookie, cash.base);
    checkEq('SELL exactly what is held → 200', sellAll.status, 200);

    const sellAfterSoldOut = await req('POST', '/api/transactions',
      { portfolio_id: p1id, ticker: 'XYZ', type: 'SELL', quantity: 1, price: 6, date: '2024-04-04' }, cookie, cash.base);
    checkEq('SELL after fully sold out (history shows a past BUY, but 0 held now) → 400', sellAfterSoldOut.status, 400);

    const dupBuy1 = await req('POST', '/api/transactions',
      { portfolio_id: p1id, ticker: 'ABC', type: 'BUY', quantity: 5, price: 10, total: 50, date: '2024-04-05' }, cookie, cash.base);
    checkEq('first BUY → 200', dupBuy1.status, 200);

    const dupBuy2 = await req('POST', '/api/transactions',
      { portfolio_id: p1id, ticker: 'ABC', type: 'BUY', quantity: 5, price: 10, total: 50, date: '2024-04-05' }, cookie, cash.base);
    checkEq('identical BUY same day → 409 (duplicate)', dupBuy2.status, 409);

    const notDupBuy = await req('POST', '/api/transactions',
      { portfolio_id: p1id, ticker: 'ABC', type: 'BUY', quantity: 5, price: 10, total: 50, date: '2024-04-06' }, cookie, cash.base);
    checkEq('same shape but different date → 200 (not a duplicate)', notDupBuy.status, 200);

    section('40. Logging a DIVIDEND re-derives next_dividend_date from payment date + frequency');
    await req('PUT', `/api/portfolios/${p1id}/stocks/ABC`,
      { dividend_frequency: 'Quarterly' }, cookie, cash.base);

    const div1 = await req('POST', '/api/transactions',
      { portfolio_id: p1id, ticker: 'ABC', type: 'DIVIDEND', total: 5, date: '2024-04-10' }, cookie, cash.base);
    checkEq('DIVIDEND logged → 200', div1.status, 200);

    const getAbcNextDate = async () => {
      const summary = await req('GET', `/api/portfolios/${p1id}/summary`, null, cookie, cash.base);
      return summary.body.find(h => h.ticker === 'ABC')?.next_dividend_date;
    };
    checkEq('next_dividend_date = payment date + 3 months (Quarterly)', await getAbcNextDate(), '2024-07-10');

    // A later, earlier-dated dividend re-derives (overwrites) the guess again.
    const div2 = await req('POST', '/api/transactions',
      { portfolio_id: p1id, ticker: 'ABC', type: 'DIVIDEND', total: 5, date: '2024-04-15' }, cookie, cash.base);
    checkEq('second DIVIDEND logged → 200', div2.status, 200);
    checkEq('next_dividend_date overwritten by the latest logged payment', await getAbcNextDate(), '2024-07-15');

    section('41. POST /api/stocks/backfill-frequency — only fills blanks where a yield is already known');
    await req('POST', '/api/transactions',
      { portfolio_id: p1id, ticker: 'GHI', type: 'BUY', quantity: 10, price: 10, total: 100, date: '2024-05-01' }, cookie, cash.base);
    await req('POST', '/api/transactions',
      { portfolio_id: p1id, ticker: 'JKL', type: 'BUY', quantity: 10, price: 10, total: 100, date: '2024-05-01' }, cookie, cash.base);
    // Simulate a prior TMX refresh: GHI has a known yield, JKL doesn't. Neither
    // has dividend_frequency set yet (no HTTP route exposes dividend_yield directly,
    // and a bare BUY doesn't create a stock_info row, so create it via the edit
    // route first, same as a manual sector/market_price edit would).
    await req('PUT', `/api/portfolios/${p1id}/stocks/GHI`, { sector: 'Financials' }, cookie, cash.base);
    await cash.db.run('UPDATE stock_info SET dividend_yield = 3.5 WHERE portfolio_id = ? AND ticker = ?', p1id, 'GHI');

    const backfill = await req('POST', '/api/stocks/backfill-frequency', { frequency: 'Quarterly' }, cookie, cash.base);
    checkEq('backfill → 200', backfill.status, 200);

    const summaryAfterBackfill = await req('GET', `/api/portfolios/${p1id}/summary`, null, cookie, cash.base);
    const ghi = summaryAfterBackfill.body.find(h => h.ticker === 'GHI');
    const jkl = summaryAfterBackfill.body.find(h => h.ticker === 'JKL');
    checkEq('GHI (has yield, no frequency) → backfilled to Quarterly', ghi?.dividend_frequency, 'Quarterly');
    checkEq('JKL (no yield at all) → left blank', jkl?.dividend_frequency, '');
    checkEq('only GHI counted (ABC already had a frequency from section 40)', backfill.body.updated, 1);
  } finally {
    cash.close();
  }
}

// ─── Boot and run ────────────────────────────────────────────────────────────

(async () => {
  const main = await bootApp({ rateLimit: false }); // disabled so the many login attempts below aren't throttled
  BASE = main.base;
  console.log(`Auth test server on ${BASE}\n`);

  try {
    await run();
  } catch (e) {
    console.error('\nFATAL:', e);
    failed++;
  }

  main.close();
  cleanupTempDbs();

  const total = passed + failed;
  console.log(`\n${'═'.repeat(58)}`);
  console.log(`  ${total} tests   ${passed} passed   ${failed} failed`);
  console.log(`${'═'.repeat(58)}\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
