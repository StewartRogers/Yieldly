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
