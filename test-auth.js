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

function req(method, path, body, cookie, base = BASE) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname, headers: {} };
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
      resolve({ base: `http://127.0.0.1:${port}`, close: () => server.close() });
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
