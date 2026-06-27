'use strict';

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

const { computeHoldings } = require('./lib/compute');
const { parseCSVLine, parseDate } = require('./lib/parse');
const { prepareHoldings } = require('./lib/holdings');
const { TOKEN_COOKIE, signToken, verifyToken, setAuthCookie, clearAuthCookie } = require('./lib/auth');

const noop = async () => {};

// ─── Validation helpers ──────────────────────────────────────────────────────

const TRANSACTION_TYPES = new Set([
  'BUY', 'SELL', 'DIVIDEND', 'DIVIDEND_REINVEST', 'CONTRIBUTION', 'WITHDRAWAL',
]);

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
// Accepts numbers or numeric strings; rejects NaN/Infinity/garbage.
const toFiniteNumber = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
};

// ─── Full backup (complete export/import) ────────────────────────────────────
// Distinct from the CSV *transaction* import: this is a whole-portfolio
// snapshot (portfolios + transactions + stock_info) for moving a deployment
// server-to-server. The `users` table is intentionally excluded — credentials
// are managed per-server (npm run user:create) and never travel in a backup.
// IDs are preserved on import so the portfolio_id references stay intact.
const EXPORT_VERSION = 1;

// Column lists are read from the live schema (PRAGMA) rather than hardcoded, so
// export/import automatically pick up any column a future migration adds and
// never silently drop data. `table` is always a trusted internal literal.
async function tableColumns(db, table) {
  const rows = await db.all(`PRAGMA table_info(${table})`);
  return rows.map((r) => r.name);
}

const insertSQL = (table, cols) =>
  `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
const rowArgs = (obj, cols) => cols.map((c) => (obj[c] === undefined ? null : obj[c]));

/**
 * Validate a parsed backup payload before any DB writes. Returns an array of
 * human-readable error strings (empty === valid). Checks version, table shape,
 * transaction-type whitelist, finite numeric fields, and that every
 * transaction/stock_info row points at a portfolio present in the same file.
 */
function validateBackupPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['Backup must be a JSON object'];
  }
  if (payload.version !== EXPORT_VERSION) {
    errors.push(`Unsupported backup version (expected ${EXPORT_VERSION}, got ${payload.version ?? 'none'})`);
  }
  for (const table of ['portfolios', 'transactions', 'stock_info']) {
    if (!Array.isArray(payload[table])) errors.push(`"${table}" must be an array`);
  }
  if (errors.length) return errors; // shape is wrong; deeper checks would be noise

  const portfolioIds = new Set();
  payload.portfolios.forEach((p, i) => {
    if (p == null || typeof p !== 'object') return errors.push(`portfolios[${i}] is not an object`);
    if (p.id == null) return errors.push(`portfolios[${i}] is missing id`);
    if (portfolioIds.has(p.id)) errors.push(`portfolios[${i}] has duplicate id ${p.id}`);
    if (!p.name || !p.code) errors.push(`portfolios[${i}] is missing name/code`);
    portfolioIds.add(p.id);
  });
  payload.transactions.forEach((t, i) => {
    if (t == null || typeof t !== 'object') return errors.push(`transactions[${i}] is not an object`);
    if (!TRANSACTION_TYPES.has(t.type)) errors.push(`transactions[${i}] has invalid type "${t.type}"`);
    if (!portfolioIds.has(t.portfolio_id)) errors.push(`transactions[${i}] references unknown portfolio_id ${t.portfolio_id}`);
    if (!t.ticker) errors.push(`transactions[${i}] is missing ticker`);
    for (const f of ['quantity', 'price', 'total']) {
      // toFiniteNumber returns null for missing/null/'' — reject those too, not
      // just NaN, so a null lands as a 400 here rather than a NOT NULL 500 at insert.
      const n = toFiniteNumber(t[f]);
      if (n === null || Number.isNaN(n)) errors.push(`transactions[${i}].${f} must be a number`);
    }
    if (!t.date) errors.push(`transactions[${i}] is missing date`);
  });
  payload.stock_info.forEach((s, i) => {
    if (s == null || typeof s !== 'object') return errors.push(`stock_info[${i}] is not an object`);
    if (!portfolioIds.has(s.portfolio_id)) errors.push(`stock_info[${i}] references unknown portfolio_id ${s.portfolio_id}`);
    if (!s.ticker) errors.push(`stock_info[${i}] is missing ticker`);
  });
  return errors;
}

/**
 * Build the Express application around an already-open database wrapper
 * (see database.js / createDb). All data access is async (libSQL). No
 * module-load side effects, no `listen` — so tests drive it directly against
 * an in-memory libSQL database.
 *
 * options:
 *   sessionSecret   {string}   secret used to sign JWT auth tokens (required in prod)
 *   secureCookies   {boolean}  set the Secure flag on the auth cookie
 *   trustProxy      {boolean}  trust the first proxy hop (HTTPS proxy / Vercel)
 *   backupPortfolios{function} async hook called after portfolio mutations (default no-op)
 *   serveClient     {'production'|'development'|false} static asset strategy
 *   rateLimit       {{windowMs,max}|false} auth rate-limit config (false disables)
 *   verbose         {boolean}  emit per-row CSV import logs (default false)
 */
function createApp(db, options = {}) {
  const {
    sessionSecret = crypto.randomBytes(32).toString('hex'),
    secureCookies = false,
    trustProxy = false,
    backupPortfolios = noop,
    serveClient = false,
    rateLimit: rateLimitOpts,
    verbose = false,
  } = options;

  const holdings = prepareHoldings(db);
  const queryHoldings = (portfolioId) => holdings.query(portfolioId);

  const app = express();

  function serverError(res, error) {
    console.error(error);
    res.status(500).json({ error: 'An internal error occurred' });
  }

  // ── Middleware ──────────────────────────────────────────────────────────────
  if (trustProxy) app.set('trust proxy', 1);

  // Security headers. CSP is left to the deployment platform (it must be tuned
  // to the built client's asset hashes); helmet's default CSP would block the SPA.
  app.use(helmet({ contentSecurityPolicy: false }));

  // A full backup can be larger than any normal request body. Give the import
  // route a higher cap (registered first, so the global parser below sees the
  // body already parsed and skips it) — otherwise an export that succeeds could
  // exceed the 10mb limit and fail to re-import with a 413.
  app.use('/api/import', express.json({ limit: '50mb' }));
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  // Throttle credential endpoints to blunt brute-force attempts.
  const authLimiter = rateLimitOpts === false
    ? (req, res, next) => next()
    : rateLimit({
        windowMs: rateLimitOpts?.windowMs ?? 15 * 60 * 1000,
        max: rateLimitOpts?.max ?? 10,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many attempts. Please try again later.' },
      });

  // Serve client assets (registered before API routes; SPA fallback comes last)
  if (serveClient === 'production') {
    app.use(express.static(path.join(__dirname, 'client', 'dist')));
  } else if (serveClient === 'development') {
    app.use(express.static('public'));
  }

  // ===== AUTHENTICATION (stateless JWT) =====

  app.get('/api/auth/session', async (req, res) => {
    try {
      const userCount = Number((await db.get('SELECT COUNT(*) as count FROM users')).count);
      if (userCount === 0) {
        return res.json({ authenticated: false, needsSetup: true });
      }
      const payload = verifyToken(sessionSecret, req.cookies[TOKEN_COOKIE]);
      if (payload) {
        const user = await db.get('SELECT id, username FROM users WHERE id = ?', payload.userId);
        if (user) return res.json({ authenticated: true, user: { id: user.id, username: user.username } });
      }
      res.json({ authenticated: false, needsSetup: false });
    } catch (error) {
      serverError(res, error);
    }
  });

  app.post('/api/auth/setup', authLimiter, async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || typeof username !== 'string' || username.trim().length < 2) {
        return res.status(400).json({ error: 'Username must be at least 2 characters' });
      }
      if (!password || typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      const hash = await bcrypt.hash(password, 10);

      // Atomic "first user wins": count + insert inside one write transaction.
      let userId;
      const tx = await db.transaction('write');
      let committed = false;
      try {
        const count = Number((await tx.execute('SELECT COUNT(*) as count FROM users')).rows[0].count);
        if (count > 0) {
          await tx.rollback();
          return res.status(403).json({ error: 'Setup already completed' });
        }
        const result = await tx.execute({
          sql: 'INSERT INTO users (username, password_hash) VALUES (?, ?)',
          args: [username.trim(), hash],
        });
        await tx.commit();
        committed = true;
        userId = Number(result.lastInsertRowid);
      } catch (e) {
        // Only roll back if commit didn't already finalize the tx — calling
        // rollback on a committed tx throws and would mask the real error.
        if (!committed) await tx.rollback();
        throw e;
      }

      const token = signToken(sessionSecret, { userId, username: username.trim() });
      setAuthCookie(res, token, secureCookies);
      res.json({ success: true, user: { id: userId, username: username.trim() } });
    } catch (error) {
      serverError(res, error);
    }
  });

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }
      const user = await db.get('SELECT id, username, password_hash FROM users WHERE username = ?', username.trim());
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      const token = signToken(sessionSecret, { userId: user.id, username: user.username });
      setAuthCookie(res, token, secureCookies);
      res.json({ success: true, user: { id: user.id, username: user.username } });
    } catch (error) {
      serverError(res, error);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    clearAuthCookie(res);
    res.json({ success: true });
  });

  // Auth guard — all routes below this require a valid token
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth/')) return next();
    const payload = verifyToken(sessionSecret, req.cookies[TOKEN_COOKIE]);
    if (!payload) return res.status(401).json({ error: 'Authentication required' });
    req.userId = payload.userId;
    next();
  });

  app.post('/api/change-password', async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new password are required' });
      }
      if (typeof newPassword !== 'string' || newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      }
      const user = await db.get('SELECT password_hash FROM users WHERE id = ?', req.userId);
      if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      const hash = await bcrypt.hash(newPassword, 10);
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, req.userId);
      // Re-issue this client's token; other outstanding tokens expire naturally
      // (stateless — see lib/auth.js).
      const fresh = await db.get('SELECT id, username FROM users WHERE id = ?', req.userId);
      setAuthCookie(res, signToken(sessionSecret, { userId: fresh.id, username: fresh.username }), secureCookies);
      res.json({ success: true });
    } catch (error) {
      serverError(res, error);
    }
  });

  // ===== PORTFOLIO MANAGEMENT =====

  app.get('/api/portfolios', async (req, res) => {
    try {
      res.json(await db.all('SELECT * FROM portfolios ORDER BY display_order, id'));
    } catch (error) {
      serverError(res, error);
    }
  });

  app.post('/api/portfolios', async (req, res) => {
    try {
      const { name, code } = req.body;

      if (!name || !code) {
        return res.status(400).json({ error: 'Name and code are required' });
      }
      if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100) {
        return res.status(400).json({ error: 'Name must be 1–100 characters' });
      }
      if (typeof code !== 'string' || !/^[A-Z0-9]{1,5}$/i.test(code.trim())) {
        return res.status(400).json({ error: 'Code must be 1–5 alphanumeric characters' });
      }

      const result = await db.run('INSERT INTO portfolios (name, code) VALUES (?, ?)', name, code.toUpperCase());

      await backupPortfolios();
      res.json({ id: result.lastInsertRowid, name, code: code.toUpperCase() });
    } catch (error) {
      if (error.message.includes('UNIQUE constraint')) {
        res.status(400).json({ error: 'Portfolio code already exists' });
      } else {
        serverError(res, error);
      }
    }
  });

  app.put('/api/portfolios/:id/order', async (req, res) => {
    try {
      const { display_order } = req.body;
      if (!Number.isInteger(display_order)) {
        return res.status(400).json({ error: 'display_order must be an integer' });
      }
      const result = await db.run('UPDATE portfolios SET display_order = ? WHERE id = ?', display_order, req.params.id);
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Portfolio not found' });
      }
      await backupPortfolios();
      res.json({ message: 'Portfolio order updated' });
    } catch (error) {
      serverError(res, error);
    }
  });

  app.put('/api/portfolios/:id/cash-balance', async (req, res) => {
    try {
      const { cash_balance } = req.body;
      const value = cash_balance === null || cash_balance === '' ? null : toFiniteNumber(cash_balance);
      if (Number.isNaN(value)) {
        return res.status(400).json({ error: 'cash_balance must be a number' });
      }
      const result = await db.run('UPDATE portfolios SET cash_balance = ? WHERE id = ?', value, req.params.id);
      if (result.changes === 0) return res.status(404).json({ error: 'Portfolio not found' });
      res.json({ message: 'Cash balance updated', cash_balance: value });
    } catch (error) {
      serverError(res, error);
    }
  });

  app.put('/api/portfolios/:id', async (req, res) => {
    try {
      const { name, code } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
      if (!code || !code.trim()) return res.status(400).json({ error: 'Code is required' });
      const upperCode = code.trim().toUpperCase();
      const existing = await db.get('SELECT id FROM portfolios WHERE code = ? AND id != ?', upperCode, req.params.id);
      if (existing) return res.status(409).json({ error: `Code "${upperCode}" is already in use` });
      const result = await db.run('UPDATE portfolios SET name = ?, code = ? WHERE id = ?', name.trim(), upperCode, req.params.id);
      if (result.changes === 0) return res.status(404).json({ error: 'Portfolio not found' });
      await backupPortfolios();
      res.json({ message: 'Portfolio updated', id: Number(req.params.id), name: name.trim(), code: upperCode });
    } catch (error) {
      serverError(res, error);
    }
  });

  app.delete('/api/portfolios/:id', async (req, res) => {
    try {
      // Explicit cascade: don't rely on the foreign_keys pragma being on for
      // every connection (notably on serverless / Turso).
      const id = req.params.id;
      const exists = await db.get('SELECT id FROM portfolios WHERE id = ?', id);
      if (!exists) return res.status(404).json({ error: 'Portfolio not found' });

      const tx = await db.transaction('write');
      let committed = false;
      try {
        await tx.execute({ sql: 'DELETE FROM stock_info WHERE portfolio_id = ?', args: [id] });
        await tx.execute({ sql: 'DELETE FROM transactions WHERE portfolio_id = ?', args: [id] });
        await tx.execute({ sql: 'DELETE FROM portfolios WHERE id = ?', args: [id] });
        await tx.commit();
        committed = true;
      } catch (e) {
        if (!committed) await tx.rollback();
        throw e;
      }

      await backupPortfolios();
      res.json({ message: 'Portfolio deleted' });
    } catch (error) {
      serverError(res, error);
    }
  });

  // ===== STOCK INFO MANAGEMENT =====

  app.put('/api/portfolios/:portfolioId/stocks/:ticker', async (req, res) => {
    try {
      const { portfolioId, ticker } = req.params;
      const { market_price, dividend_frequency, dividend_per_share, last_dividend_date, sector, investment_type } = req.body;

      for (const [field, value] of [['market_price', market_price], ['dividend_per_share', dividend_per_share]]) {
        if (value !== undefined && value !== null && Number.isNaN(toFiniteNumber(value))) {
          return res.status(400).json({ error: `${field} must be a number` });
        }
      }

      await db.run(`
        INSERT INTO stock_info (portfolio_id, ticker, market_price, dividend_frequency, dividend_per_share, last_dividend_date, sector, investment_type, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(portfolio_id, ticker) DO UPDATE SET
          market_price        = COALESCE(?, market_price),
          dividend_frequency  = COALESCE(?, dividend_frequency),
          dividend_per_share  = COALESCE(?, dividend_per_share),
          last_dividend_date  = COALESCE(?, last_dividend_date),
          sector              = COALESCE(?, sector),
          investment_type     = COALESCE(?, investment_type),
          updated_at          = CURRENT_TIMESTAMP
      `,
        portfolioId, ticker.toUpperCase(),
        market_price ?? null, dividend_frequency ?? null, dividend_per_share ?? null, last_dividend_date ?? null, sector ?? null, investment_type ?? null,
        market_price ?? null, dividend_frequency ?? null, dividend_per_share ?? null, last_dividend_date ?? null, sector ?? null, investment_type ?? null
      );

      res.json({ message: 'Stock info updated' });
    } catch (error) {
      serverError(res, error);
    }
  });

  // ===== MARKET DATA =====

  async function upsertStockInfo(portfolioId, ticker, marketPrice, dividendYield, payDate) {
    await db.run(`
      INSERT INTO stock_info (portfolio_id, ticker, market_price, dividend_yield, last_dividend_date, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(portfolio_id, ticker) DO UPDATE SET
        market_price    = COALESCE(?, market_price),
        dividend_yield  = COALESCE(?, dividend_yield),
        last_dividend_date = COALESCE(?, last_dividend_date),
        updated_at      = CURRENT_TIMESTAMP
    `, portfolioId, ticker, marketPrice ?? null, dividendYield ?? null, payDate ?? null,
       marketPrice ?? null, dividendYield ?? null, payDate ?? null);
  }

  app.post('/api/portfolios/:portfolioId/refresh-prices', async (req, res) => {
    try {
      const portfolioId = req.params.portfolioId;
      const holdingRows = await db.all(`
        SELECT ticker,
          (SELECT market FROM transactions t2
           WHERE t2.portfolio_id = t.portfolio_id AND t2.ticker = t.ticker AND t2.market IS NOT NULL
           ORDER BY t2.id DESC LIMIT 1) AS market
        FROM transactions t
        WHERE portfolio_id = ? AND ticker != 'CASH'
        GROUP BY ticker
        HAVING SUM(CASE WHEN type IN ('BUY','DIVIDEND_REINVEST') THEN quantity
                        WHEN type = 'SELL' THEN -quantity ELSE 0 END) > 0
      `, portfolioId);

      if (!holdingRows.length) return res.json({ message: 'No holdings to update', updated: 0 });

      const wait = ms => new Promise(r => setTimeout(r, ms));
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let updated = 0; const errors = [];

      for (let i = 0; i < holdingRows.length; i++) {
        const { ticker, market } = holdingRows[i];
        const isUS = market === 'NYSE' || market === 'NASDAQ';
        try {
          if (isUS) {
            const q = await fetchYahooQuote(ticker);
            await upsertStockInfo(portfolioId, ticker, q.price, q.dividendYield, null);
            console.log(`${ticker} (${market} via Yahoo): $${q.price?.toFixed(2)} yield=${q.dividendYield}%`);
          } else {
            const q = await fetchTMXQuote(ticker);
            if (!q) { errors.push({ ticker, error: 'No data from TMX' }); continue; }
            const price    = q.price         != null ? parseFloat(q.price)         : null;
            const divYield = q.dividendYield != null ? parseFloat(q.dividendYield) : null;
            const payDate  = q.dividendPayDate && new Date(q.dividendPayDate) > today ? q.dividendPayDate : null;
            await upsertStockInfo(portfolioId, ticker, price, divYield, payDate);
            console.log(`${ticker} (TMX): $${price?.toFixed(2)} yield=${divYield}%`);
          }
          updated++;
        } catch (e) { errors.push({ ticker, error: e.message }); }
        if (i < holdingRows.length - 1) await wait(300);
      }

      res.json({ message: `Updated ${updated} of ${holdingRows.length} stocks`, updated,
                 total: holdingRows.length, errors: errors.length ? errors : undefined });
    } catch (error) {
      serverError(res, error);
    }
  });

  app.post('/api/refresh-all-prices', async (req, res) => {
    try {
      const holdingRows = await db.all(`
        SELECT DISTINCT portfolio_id, ticker,
          (SELECT market FROM transactions t2
           WHERE t2.portfolio_id = t.portfolio_id AND t2.ticker = t.ticker AND t2.market IS NOT NULL
           ORDER BY t2.id DESC LIMIT 1) AS market
        FROM transactions t
        WHERE ticker != 'CASH'
        GROUP BY portfolio_id, ticker
        HAVING SUM(CASE WHEN type IN ('BUY','DIVIDEND_REINVEST') THEN quantity
                        WHEN type = 'SELL' THEN -quantity ELSE 0 END) > 0
      `);

      if (!holdingRows.length) return res.json({ message: 'No holdings to update', updated: 0 });

      const wait = ms => new Promise(r => setTimeout(r, ms));
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const errors = [];

      // Dedup the network fetch per (ticker, market): the same ticker can be
      // held on different exchanges across portfolios and must be quoted from
      // the matching source (TMX vs Yahoo) with the matching response shape, so
      // the market is part of the cache key, not just the ticker.
      const quoteKey = (ticker, market) => `${ticker}|${market ?? ''}`;
      const uniqueHoldings = [];
      const seen = new Set();
      for (const h of holdingRows) {
        const k = quoteKey(h.ticker, h.market);
        if (!seen.has(k)) { seen.add(k); uniqueHoldings.push(h); }
      }

      const quotes = {};
      for (let i = 0; i < uniqueHoldings.length; i++) {
        const { ticker, market } = uniqueHoldings[i];
        const isUS = market === 'NYSE' || market === 'NASDAQ';
        const key = quoteKey(ticker, market);
        try {
          if (isUS) {
            quotes[key] = await fetchYahooQuote(ticker);
            console.log(`${ticker} (${market} via Yahoo): $${quotes[key]?.price?.toFixed(2)}`);
          } else {
            quotes[key] = await fetchTMXQuote(ticker);
            console.log(`${ticker} (TMX): $${quotes[key]?.price?.toFixed(2)}`);
          }
        } catch (e) {
          errors.push({ ticker, error: e.message });
          quotes[key] = null;
        }
        if (i < uniqueHoldings.length - 1) await wait(300);
      }

      let updated = 0;
      for (const { portfolio_id, ticker, market } of holdingRows) {
        const q = quotes[quoteKey(ticker, market)];
        if (!q) continue;
        const isUS = market === 'NYSE' || market === 'NASDAQ';
        if (isUS) {
          await upsertStockInfo(portfolio_id, ticker, q.price, q.dividendYield, null);
        } else {
          const price    = q.price         != null ? parseFloat(q.price)         : null;
          const divYield = q.dividendYield != null ? parseFloat(q.dividendYield) : null;
          const payDate  = q.dividendPayDate && new Date(q.dividendPayDate) > today ? q.dividendPayDate : null;
          await upsertStockInfo(portfolio_id, ticker, price, divYield, payDate);
        }
        updated++;
      }

      res.json({ message: `Updated ${updated} stock-portfolio entries (${uniqueHoldings.length} unique quotes)`,
                 updated, total: holdingRows.length, errors: errors.length ? errors : undefined });
    } catch (error) {
      serverError(res, error);
    }
  });

  // ===== DIVIDEND INCOME =====

  app.get('/api/summary/monthly-acb', async (req, res) => {
    try {
      const rows = await db.all(`
        SELECT portfolio_id, ticker, type, quantity, total,
               COALESCE(commission, 0) AS commission, date
        FROM transactions
        WHERE type IN ('BUY', 'DIVIDEND_REINVEST', 'SELL')
        ORDER BY date ASC, id ASC
      `);
      res.json(computeMonthlyACB(rows));
    } catch (error) {
      serverError(res, error);
    }
  });

  app.get('/api/dividends/monthly', async (req, res) => {
    try {
      const rows = await db.all(`
        SELECT
          p.code  AS portfolio_code,
          CAST(strftime('%Y', t.date) AS INTEGER) AS year,
          CAST(strftime('%m', t.date) AS INTEGER) AS month,
          SUM(t.total) AS total
        FROM transactions t
        JOIN portfolios p ON t.portfolio_id = p.id
        WHERE t.type = 'DIVIDEND'
        GROUP BY p.code, year, month
        ORDER BY p.code, year, month
      `);
      res.json(rows);
    } catch (error) {
      serverError(res, error);
    }
  });

  // ===== TRANSACTION MANAGEMENT =====

  app.get('/api/portfolios/:portfolioId/transactions/ticker/:ticker', async (req, res) => {
    try {
      const transactions = await db.all(`
        SELECT id, ticker, type, quantity, price, total, commission, date
        FROM transactions
        WHERE portfolio_id = ? AND ticker = ?
        ORDER BY date ASC, created_at ASC
      `, req.params.portfolioId, req.params.ticker.toUpperCase());
      res.json(transactions);
    } catch (error) {
      serverError(res, error);
    }
  });

  app.get('/api/portfolios/:portfolioId/transactions', async (req, res) => {
    try {
      const transactions = await db.all(`
        SELECT t.*, p.code as portfolio_code, p.name as portfolio_name
        FROM transactions t
        JOIN portfolios p ON t.portfolio_id = p.id
        WHERE t.portfolio_id = ?
        ORDER BY t.date DESC, t.created_at DESC
      `, req.params.portfolioId);
      res.json(transactions);
    } catch (error) {
      serverError(res, error);
    }
  });

  app.get('/api/overview', async (req, res) => {
    try {
      const portfolios = await db.all('SELECT * FROM portfolios ORDER BY display_order, id');

      const allHoldings = computeHoldings(await queryHoldings(null));
      const mktValById   = {};
      const investedById = {};
      const buyTotalById = {};
      const saleTotalById = {};
      const pidByCode    = {};
      portfolios.forEach(p => { pidByCode[p.code] = p.id; });
      allHoldings.forEach(h => {
        const pid = pidByCode[h.portfolio_code];
        if (pid) {
          mktValById[pid]    = (mktValById[pid]    || 0) + h.market_value;
          buyTotalById[pid]  = (buyTotalById[pid]  || 0) + h.buy_total;
          saleTotalById[pid] = (saleTotalById[pid] || 0) + h.sale_total;
          if (h.shares > 0) {
            investedById[pid] = (investedById[pid] || 0) + h.buy_price * h.shares;
          }
        }
      });

      res.json(portfolios.map(p => ({
        id:             p.id,
        code:           p.code,
        name:           p.name,
        cash:           p.cash_balance ?? null,
        cash_invested:  investedById[p.id]  || 0,
        buy_total:      buyTotalById[p.id]  || 0,
        sale_total:     saleTotalById[p.id] || 0,
        market_value:   mktValById[p.id]    || 0
      })));
    } catch (error) {
      serverError(res, error);
    }
  });

  app.post('/api/transactions', async (req, res) => {
    try {
      const { portfolio_id, ticker, type, quantity, price, total, date, commission, market } = req.body;

      const normalizedType = typeof type === 'string' ? type.toUpperCase() : type;
      const isCashFlow = normalizedType === 'CONTRIBUTION' || normalizedType === 'WITHDRAWAL';
      const finalTicker = (isCashFlow && !ticker) ? 'CASH' : ticker;

      if (!portfolio_id || !finalTicker || !type || !date) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      if (!TRANSACTION_TYPES.has(normalizedType)) {
        return res.status(400).json({ error: 'Invalid transaction type' });
      }

      // Numeric fields must parse to finite, non-negative numbers when present.
      // A negative quantity is especially dangerous: HOLDINGS_SQL nets SELL as
      // -quantity, so a negative SELL would ADD shares and corrupt ACB/returns.
      const numericFields = { quantity, price, total, commission };
      for (const [field, value] of Object.entries(numericFields)) {
        if (value === undefined) continue;
        const n = toFiniteNumber(value);
        if (Number.isNaN(n)) {
          return res.status(400).json({ error: `${field} must be a number` });
        }
        if (n < 0) {
          return res.status(400).json({ error: `${field} cannot be negative` });
        }
      }

      const finalQuantity = quantity !== undefined ? Number(quantity) : 0;
      const finalPrice = price !== undefined ? Number(price) : 0;
      const finalTotal = total !== undefined ? Number(total) : (finalQuantity * finalPrice);
      if (!isFiniteNumber(finalTotal)) {
        return res.status(400).json({ error: 'total could not be computed' });
      }

      const result = await db.run(`
        INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total, commission, date, market)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, portfolio_id, finalTicker.toUpperCase(), normalizedType, finalQuantity, finalPrice, finalTotal,
         commission ? Number(commission) : 0, date, market || 'TMX');

      res.json({
        id: result.lastInsertRowid,
        portfolio_id,
        ticker: finalTicker.toUpperCase(),
        type: normalizedType,
        quantity: finalQuantity,
        price: finalPrice,
        total: finalTotal,
        commission: commission ? Number(commission) : 0,
        date
      });
    } catch (error) {
      serverError(res, error);
    }
  });

  app.get('/api/portfolios/:portfolioId/summary', async (req, res) => {
    try {
      res.json(computeHoldings(await queryHoldings(req.params.portfolioId)));
    } catch (error) {
      serverError(res, error);
    }
  });

  app.get('/api/summary', async (req, res) => {
    try {
      res.json(computeHoldings(await queryHoldings(null)));
    } catch (error) {
      serverError(res, error);
    }
  });

  app.delete('/api/transactions/:id', async (req, res) => {
    try {
      const result = await db.run('DELETE FROM transactions WHERE id = ?', req.params.id);
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Transaction not found' });
      }
      res.json({ message: 'Transaction deleted' });
    } catch (error) {
      serverError(res, error);
    }
  });

  // ===== CSV IMPORT =====

  app.post('/api/import/csv', async (req, res) => {
    try {
      const { csvData } = req.body;
      if (!csvData) {
        return res.status(400).json({ error: 'CSV data required' });
      }

      const lines = csvData.trim().split('\n');
      const imported = [];
      const errors = [];

      if (verbose) console.log(`Processing ${lines.length} lines from CSV`);

      const typeMap = { 'D': 'DIVIDEND', 'B': 'BUY', 'S': 'SELL', 'DR': 'DIVIDEND_REINVEST' };

      // Preload portfolios once (keyed by upper-cased code) instead of querying
      // the DB for every CSV row — a per-row lookup is one remote round-trip per
      // line, which is the dominant cost on a large import against Turso.
      const portfoliosByCode = new Map(
        (await db.all('SELECT id, code FROM portfolios')).map(p => [p.code.toUpperCase(), p])
      );

      // Skip header row
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
          // Date, Symbol, Portfolio, Type, Quantity, Share Price, Total (+ optional trailing columns)
          const parts = parseCSVLine(line);
          if (parts.length < 7) {
            errors.push({ line: i + 1, error: `Invalid CSV format - expected at least 7 columns, got ${parts.length}`, data: line });
            continue;
          }

          const [dateStr, symbol, portfolioCode, typeCode, quantityStr, priceStr, totalStr] = parts;

          // Uppercase the ticker to match every other write path (POST
          // /transactions, PUT .../stocks). The holdings GROUP BY t.ticker is
          // case-sensitive, so a lowercase import would split one position into
          // two case-variant holdings.
          const cleanTicker = symbol.trim().toUpperCase();
          const cleanPortfolioCode = portfolioCode.toUpperCase().trim();
          const portfolio = portfoliosByCode.get(cleanPortfolioCode);
          if (!portfolio) {
            const available = [...portfoliosByCode.values()].map(p => p.code).join(', ');
            errors.push({ line: i + 1, error: `Portfolio '${cleanPortfolioCode}' not found. Available portfolios: ${available}`, data: line });
            continue;
          }

          const parsedDate = parseDate(dateStr);
          const type = typeMap[typeCode] || typeCode;

          const quantity = parseFloat(quantityStr.replace(/[$\s,]/g, '')) || 0;
          const price = parseFloat(priceStr.replace(/[$\s,]/g, '')) || 0;
          const total = parseFloat(totalStr.replace(/[$\s,]/g, '')) || 0;

          // Guard against negatives — a negative SELL quantity would add shares
          // in the holdings aggregation and corrupt ACB/returns.
          if (quantity < 0 || price < 0 || total < 0) {
            errors.push({ line: i + 1, error: 'Negative quantity, price, or total is not allowed', data: line });
            continue;
          }

          const duplicate = await db.get(`
            SELECT id FROM transactions
            WHERE portfolio_id = ? AND ticker = ? AND type = ? AND date = ? AND quantity = ? AND price = ? AND total = ?
          `, portfolio.id, cleanTicker, type, parsedDate, quantity, price, total);

          if (duplicate) {
            errors.push({ line: i + 1, error: 'Duplicate transaction (skipped)', data: line });
            continue;
          }

          await db.run(`
            INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total, date)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, portfolio.id, cleanTicker, type, quantity, price, total, parsedDate);
          imported.push({ line: i + 1, symbol, portfolio: portfolioCode, date: parsedDate });
        } catch (error) {
          errors.push({ line: i + 1, error: error.message, data: line });
        }
      }

      if (verbose) console.log(`Import complete: ${imported.length} imported, ${errors.length} errors`);

      res.json({
        success: true,
        imported: imported.length,
        errors: errors.length,
        details: { imported, errors }
      });
    } catch (error) {
      serverError(res, error);
    }
  });

  // ===== FULL BACKUP (complete export / import) =====
  // A whole-portfolio snapshot for moving a deployment server-to-server.
  // NOT the CSV transaction import above — this carries portfolios (incl.
  // cash balances + ordering) and stock_info (dividends/sector/type) too.

  app.get('/api/export', async (req, res) => {
    try {
      // SELECT * so the export inherently includes every column the schema has.
      const [portfolios, transactions, stock_info] = await Promise.all([
        db.all('SELECT * FROM portfolios ORDER BY id'),
        db.all('SELECT * FROM transactions ORDER BY id'),
        db.all('SELECT * FROM stock_info ORDER BY id'),
      ]);
      res.json({
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        portfolios,
        transactions,
        stock_info,
      });
    } catch (error) {
      serverError(res, error);
    }
  });

  // Lightweight row counts for the restore confirmation, so the client doesn't
  // have to download the whole dataset just to show "what will be deleted".
  app.get('/api/export/counts', async (req, res) => {
    try {
      const [p, t, s] = await Promise.all([
        db.get('SELECT COUNT(*) AS c FROM portfolios'),
        db.get('SELECT COUNT(*) AS c FROM transactions'),
        db.get('SELECT COUNT(*) AS c FROM stock_info'),
      ]);
      res.json({ portfolios: Number(p.c), transactions: Number(t.c), stock_info: Number(s.c) });
    } catch (error) {
      serverError(res, error);
    }
  });

  app.post('/api/import', async (req, res) => {
    try {
      const payload = req.body;
      const errors = validateBackupPayload(payload);
      if (errors.length) {
        return res.status(400).json({ error: 'Invalid backup file', details: errors.slice(0, 20) });
      }

      // Insert columns are read from the live schema so they never drift from
      // the table definitions (a future migration column flows through here).
      const [pCols, tCols, sCols] = await Promise.all([
        tableColumns(db, 'portfolios'),
        tableColumns(db, 'transactions'),
        tableColumns(db, 'stock_info'),
      ]);

      // Replace-all semantics, atomic: a bad row aborts the whole import so the
      // DB is never left half-migrated. Children deleted before parents; parents
      // inserted before children. `users` is left untouched (caller stays logged in).
      const tx = await db.transaction('write');
      let committed = false;
      try {
        await tx.execute('DELETE FROM stock_info');
        await tx.execute('DELETE FROM transactions');
        await tx.execute('DELETE FROM portfolios');
        for (const p of payload.portfolios) {
          await tx.execute({ sql: insertSQL('portfolios', pCols), args: rowArgs(p, pCols) });
        }
        for (const t of payload.transactions) {
          await tx.execute({ sql: insertSQL('transactions', tCols), args: rowArgs(t, tCols) });
        }
        for (const s of payload.stock_info) {
          await tx.execute({ sql: insertSQL('stock_info', sCols), args: rowArgs(s, sCols) });
        }
        await tx.commit();
        committed = true;
      } catch (e) {
        if (!committed) await tx.rollback();
        throw e;
      }

      // Keep the local portfolios.json snapshot in step, like every other
      // portfolio-mutating route (no-op on serverless).
      await backupPortfolios();

      res.json({
        success: true,
        imported: {
          portfolios: payload.portfolios.length,
          transactions: payload.transactions.length,
          stock_info: payload.stock_info.length,
        },
      });
    } catch (error) {
      serverError(res, error);
    }
  });

  // SPA fallback — must come after all API routes
  if (serveClient === 'production') {
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
    });
  }

  return app;
}

// ─── Market data (no DB dependency) ──────────────────────────────────────────

function normalizeTicker(ticker) {
  return ticker.replace(/\.TO$/i, '').replace(/-/g, '.');
}

async function fetchTMXQuote(ticker) {
  const symbol = normalizeTicker(ticker);
  if (!/^[A-Z0-9.]{1,12}$/.test(symbol)) throw new Error(`Invalid ticker: ${symbol}`);
  const query = `{
    getQuoteBySymbol(symbol: "${symbol}", locale: "en") {
      price
      dividendYield
      dividendPayDate
    }
  }`;
  const response = await fetch('https://app-money.tmx.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://money.tmx.com',
      'Referer': 'https://money.tmx.com/'
    },
    body: JSON.stringify({ query })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.errors) throw new Error(data.errors[0]?.message || 'GraphQL error');
  return data?.data?.getQuoteBySymbol ?? null;
}

// Yahoo Finance session (cookie + crumb) — cached in memory, refreshed on 401
let _yahooSession = null;

async function getYahooSession() {
  if (_yahooSession) return _yahooSession;

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  const cookieRes = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });
  // Use getSetCookie() so each cookie stays a discrete string — splitting the
  // combined header on ',' would break on an Expires date's comma (e.g.
  // "expires=Wed, 21-Oct-2026 …") and produce a malformed Cookie header.
  const setCookies = typeof cookieRes.headers.getSetCookie === 'function'
    ? cookieRes.headers.getSetCookie()
    : [cookieRes.headers.get('set-cookie') || ''];
  const cookie = setCookies.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');

  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookie },
  });
  if (!crumbRes.ok) throw new Error(`Yahoo Finance crumb fetch failed: HTTP ${crumbRes.status}`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes('<')) throw new Error('Yahoo Finance returned invalid crumb (possibly geo-blocked)');

  _yahooSession = { cookie, crumb, UA };
  return _yahooSession;
}

async function fetchYahooQuote(ticker, retry = true) {
  const { cookie, crumb, UA } = await getYahooSession();
  const headers = { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json' };

  const chartRes = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d&crumb=${encodeURIComponent(crumb)}`,
    { headers }
  );
  if ((chartRes.status === 401 || chartRes.status === 403) && retry) {
    _yahooSession = null;
    return fetchYahooQuote(ticker, false);
  }
  if (!chartRes.ok) throw new Error(`Yahoo Finance HTTP ${chartRes.status} for ${ticker}`);
  const chartData = await chartRes.json();
  const price = chartData?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
  if (price === null) throw new Error(`No price data for ${ticker} from Yahoo Finance`);

  let dividendYield = null;
  try {
    const summaryRes = await fetch(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail&crumb=${encodeURIComponent(crumb)}`,
      { headers }
    );
    if (summaryRes.ok) {
      const summaryData = await summaryRes.json();
      const raw = summaryData?.quoteSummary?.result?.[0]?.summaryDetail?.dividendYield?.raw;
      if (raw != null) dividendYield = raw * 100;
    }
  } catch { /* yield is optional */ }

  return { price, dividendYield };
}

// ─── Monthly ACB (pure; no DB dependency) ────────────────────────────────────

function computeMonthlyACB(txRows, now = new Date()) {
  if (!txRows.length) return [];

  const state = new Map();

  function getState(portfolioId, ticker) {
    const key = `${portfolioId}:${ticker}`;
    if (!state.has(key)) state.set(key, { sharesBought: 0, buyTotal: 0, buyExpense: 0, sharesSold: 0 });
    return state.get(key);
  }

  function totalACB() {
    let sum = 0;
    for (const s of state.values()) {
      const shares = s.sharesBought - s.sharesSold;
      if (shares > 0 && s.sharesBought > 0) {
        sum += (s.buyTotal + s.buyExpense) * (shares / s.sharesBought);
      }
    }
    return Math.round(sum * 100) / 100;
  }

  const byMonth = new Map();
  for (const tx of txRows) {
    const key = tx.date.substring(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(tx);
  }

  const firstMonth = txRows[0].date.substring(0, 7);
  const lastMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const results = [];
  let [y, m] = firstMonth.split('-').map(Number);
  const [ey, em] = lastMonth.split('-').map(Number);

  while (y < ey || (y === ey && m <= em)) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    for (const tx of (byMonth.get(key) || [])) {
      if (tx.ticker === 'CASH') continue;
      const s = getState(tx.portfolio_id, tx.ticker);
      if (tx.type === 'BUY' || tx.type === 'DIVIDEND_REINVEST') {
        s.sharesBought += tx.quantity || 0;
        s.buyTotal     += tx.total    || 0;
        s.buyExpense   += tx.commission || 0;
      } else if (tx.type === 'SELL') {
        s.sharesSold += tx.quantity || 0;
      }
    }
    results.push({ year: y, month: m, total_acb: totalACB() });
    if (++m > 12) { m = 1; y++; }
  }

  return results;
}

module.exports = { createApp, computeMonthlyACB, fetchTMXQuote, fetchYahooQuote, normalizeTicker };
