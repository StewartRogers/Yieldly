'use strict';

/**
 * Yieldly Authentication Test Suite
 *
 * Spins up an Express server on a random port backed by an in-memory
 * SQLite database. Tests auth routes and the auth guard middleware.
 *
 * Usage:  node test-auth.js
 */

const http = require('http');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const SQLiteSessionStore = require('./lib/session-store');

// ─── In-memory database ─────────────────────────────────────────────────────

const db = new Database(':memory:');

db.exec(`
  CREATE TABLE portfolios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    display_order INTEGER DEFAULT 0,
    cash_balance REAL
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
    date TEXT NOT NULL DEFAULT '2024-01-01',
    market TEXT DEFAULT 'TMX'
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
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_expired ON sessions(expired);
`);

// ─── Express app (mirrors server.js auth layer) ─────────────────────────────

const app = express();
app.use(express.json());

app.use(session({
  store: new SQLiteSessionStore(db),
  secret: crypto.randomBytes(16).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 60000 },
}));

function serverError(res, error) {
  console.error(error);
  res.status(500).json({ error: 'An internal error occurred' });
}

// Auth routes
app.get('/api/auth/session', (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) return res.json({ authenticated: false, needsSetup: true });
  if (req.session.userId) {
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.session.userId);
    if (user) return res.json({ authenticated: true, user: { id: user.id, username: user.username } });
  }
  res.json({ authenticated: false, needsSetup: false });
});

app.post('/api/auth/setup', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || typeof username !== 'string' || username.trim().length < 2)
      return res.status(400).json({ error: 'Username must be at least 2 characters' });
    if (!password || typeof password !== 'string' || password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await bcrypt.hash(password, 10);
    const atomicInsert = db.transaction(() => {
      const count = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
      if (count > 0) return null;
      return db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username.trim(), hash);
    });
    const result = atomicInsert();
    if (!result) return res.status(403).json({ error: 'Setup already completed' });
    req.session.regenerate((err) => {
      if (err) return serverError(res, err);
      req.session.userId = result.lastInsertRowid;
      res.json({ success: true, user: { id: result.lastInsertRowid, username: username.trim() } });
    });
  } catch (error) { serverError(res, error); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username.trim());
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Invalid username or password' });
    req.session.regenerate((err) => {
      if (err) return serverError(res, err);
      req.session.userId = user.id;
      res.json({ success: true, user: { id: user.id, username: user.username } });
    });
  } catch (error) { serverError(res, error); }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return serverError(res, err);
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// Auth guard
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  if (!req.session.userId) return res.status(401).json({ error: 'Authentication required' });
  next();
});

app.post('/api/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: 'Current and new password are required' });
    if (typeof newPassword !== 'string' || newPassword.length < 8)
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash)))
      return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);
    const currentSid = req.sessionID;
    db.prepare('DELETE FROM sessions WHERE sid != ?').run(currentSid);
    res.json({ success: true });
  } catch (error) { serverError(res, error); }
});

// A protected route for testing the guard
app.get('/api/portfolios', (req, res) => {
  const portfolios = db.prepare('SELECT * FROM portfolios ORDER BY display_order, id').all();
  res.json(portfolios);
});

app.post('/api/portfolios', (req, res) => {
  const { name, code } = req.body;
  if (!name || !code) return res.status(400).json({ error: 'Name and code are required' });
  const result = db.prepare('INSERT INTO portfolios (name, code) VALUES (?, ?)').run(name, code.toUpperCase());
  res.json({ id: result.lastInsertRowid, name, code: code.toUpperCase() });
});

// ─── HTTP helpers ────────────────────────────────────────────────────────────

let BASE;

function req(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
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

function extractSid(setCookieHeaders) {
  if (!setCookieHeaders) return null;
  for (const h of setCookieHeaders) {
    const m = h.match(/connect\.sid=([^;]+)/);
    if (m) return `connect.sid=${m[1]}`;
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
  section('2. Auth guard – 401 without session');
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
    checkTruthy('session cookie set', extractSid(r.cookie));
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
  let sessionCookie;
  {
    const r = await req('POST', '/api/auth/login', { username: 'admin', password: 'testpass123' });
    checkEq('status = 200', r.status, 200);
    checkEq('success = true', r.body.success, true);
    checkEq('username = admin', r.body.user.username, 'admin');
    sessionCookie = extractSid(r.cookie);
    checkTruthy('session cookie set', sessionCookie);
  }

  // ── 10. Session check with valid cookie ────────────────────────────────────
  section('10. Session – authenticated with cookie');
  {
    const r = await req('GET', '/api/auth/session', null, sessionCookie);
    checkEq('status = 200', r.status, 200);
    checkEq('authenticated = true', r.body.authenticated, true);
    checkEq('username = admin', r.body.user.username, 'admin');
  }

  // ── 11. Protected route accessible with session ────────────────────────────
  section('11. Auth guard – allows authenticated request');
  {
    const r = await req('GET', '/api/portfolios', null, sessionCookie);
    checkEq('status = 200', r.status, 200);
    checkTruthy('returns array', Array.isArray(r.body));
  }

  // ── 12. Protected POST route with session ──────────────────────────────────
  section('12. Auth guard – POST with session');
  {
    const r = await req('POST', '/api/portfolios', { name: 'Test', code: 'TST' }, sessionCookie);
    checkEq('status = 200', r.status, 200);
    checkEq('portfolio created', r.body.code, 'TST');
  }

  // ── 13. Change password validation ─────────────────────────────────────────
  section('13. Change password – validation');
  {
    const r1 = await req('POST', '/api/change-password', {}, sessionCookie);
    checkEq('missing fields → 400', r1.status, 400);

    const r2 = await req('POST', '/api/change-password',
      { currentPassword: 'testpass123', newPassword: 'short' }, sessionCookie);
    checkEq('short new password → 400', r2.status, 400);

    const r3 = await req('POST', '/api/change-password',
      { currentPassword: 'wrongcurrent', newPassword: 'newpass12345' }, sessionCookie);
    checkEq('wrong current password → 401', r3.status, 401);
  }

  // ── 14. Change password without session ────────────────────────────────────
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
      { currentPassword: 'testpass123', newPassword: 'newpass12345' }, sessionCookie);
    checkEq('status = 200', r.status, 200);
    checkEq('success = true', r.body.success, true);
  }

  // ── 16. Login with new password ────────────────────────────────────────────
  section('16. Login – with changed password');
  {
    const r1 = await req('POST', '/api/auth/login', { username: 'admin', password: 'testpass123' });
    checkEq('old password rejected → 401', r1.status, 401);

    const r2 = await req('POST', '/api/auth/login', { username: 'admin', password: 'newpass12345' });
    checkEq('new password accepted → 200', r2.status, 200);
    sessionCookie = extractSid(r2.cookie);
  }

  // ── 17. Logout ─────────────────────────────────────────────────────────────
  section('17. Logout');
  {
    const r = await req('POST', '/api/auth/logout', null, sessionCookie);
    checkEq('status = 200', r.status, 200);
    checkEq('success = true', r.body.success, true);
  }

  // ── 18. Session invalid after logout ───────────────────────────────────────
  section('18. Session – invalid after logout');
  {
    const r = await req('GET', '/api/auth/session', null, sessionCookie);
    checkEq('authenticated = false', r.body.authenticated, false);
  }

  // ── 19. Protected route rejected after logout ──────────────────────────────
  section('19. Auth guard – 401 after logout');
  {
    const r = await req('GET', '/api/portfolios', null, sessionCookie);
    checkEq('status = 401', r.status, 401);
  }

  // ── 20. Session store – expired sessions pruned ────────────────────────────
  section('20. Session store – expiry');
  {
    const store = new SQLiteSessionStore(db);
    const testSess = { cookie: { maxAge: 1 }, userId: 999 };
    await new Promise(resolve => store.set('expired-sid', testSess, resolve));
    await new Promise(resolve => setTimeout(resolve, 10));
    const result = await new Promise(resolve => store.get('expired-sid', (err, sess) => resolve(sess)));
    checkEq('expired session returns null', result, null);
  }

  // ── 21. Session store – valid session persists ─────────────────────────────
  section('21. Session store – persistence');
  {
    const store = new SQLiteSessionStore(db);
    const testSess = { cookie: { maxAge: 60000 }, userId: 42 };
    await new Promise(resolve => store.set('valid-sid', testSess, resolve));
    const result = await new Promise(resolve => store.get('valid-sid', (err, sess) => resolve(sess)));
    checkEq('valid session userId', result.userId, 42);
  }

  // ── 22. Session store – destroy removes session ────────────────────────────
  section('22. Session store – destroy');
  {
    const store = new SQLiteSessionStore(db);
    await new Promise(resolve => store.set('to-delete', { cookie: { maxAge: 60000 } }, resolve));
    await new Promise(resolve => store.destroy('to-delete', resolve));
    const result = await new Promise(resolve => store.get('to-delete', (err, sess) => resolve(sess)));
    checkEq('destroyed session returns null', result, null);
  }

  // ── 23. Username trimming ──────────────────────────────────────────────────
  section('23. Login – username trimmed');
  {
    const r = await req('POST', '/api/auth/login', { username: '  admin  ', password: 'newpass12345' });
    checkEq('trimmed username accepted → 200', r.status, 200);
    checkEq('returned username trimmed', r.body.user.username, 'admin');
  }
}

// ─── Boot and run ────────────────────────────────────────────────────────────

const server = http.createServer(app);
server.listen(0, async () => {
  const { port } = server.address();
  BASE = `http://127.0.0.1:${port}`;
  console.log(`Auth test server on port ${port}\n`);

  try {
    await run();
  } catch (e) {
    console.error('\nFATAL:', e);
    failed++;
  }

  server.close();

  const total = passed + failed;
  console.log(`\n${'═'.repeat(58)}`);
  console.log(`  ${total} tests   ${passed} passed   ${failed} failed`);
  console.log(`${'═'.repeat(58)}\n`);
  process.exit(failed > 0 ? 1 : 0);
});
