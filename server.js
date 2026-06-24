require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const { computeHoldings } = require('./lib/compute');
const { parseCSVLine, parseDate } = require('./lib/parse');
const SQLiteSessionStore = require('./lib/session-store');

const PORTFOLIOS_BACKUP = path.join(__dirname, 'portfolios.json');

function backupPortfolios() {
  try {
    const portfolios = db.prepare('SELECT name, code, display_order FROM portfolios ORDER BY display_order, id').all();
    fs.writeFileSync(PORTFOLIOS_BACKUP, JSON.stringify(portfolios, null, 2));
  } catch (e) {
    console.error('Failed to backup portfolios:', e.message);
  }
}

function serverError(res, error) {
  console.error(error);
  res.status(500).json({ error: 'An internal error occurred' });
}

const app = express();
const PORT = 2085;
const ALPHA_KEY = process.env.ALPHA_KEY;

const HOLDINGS_SQL = `
    SELECT
      p.code  AS portfolio_code,
      p.name  AS portfolio_name,
      t.ticker,
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
      s.market_price,
      s.dividend_yield,
      s.dividend_frequency,
      s.dividend_per_share,
      s.last_dividend_date,
      s.sector,
      s.investment_type
    FROM transactions t
    JOIN portfolios p ON t.portfolio_id = p.id
    LEFT JOIN stock_info s ON s.portfolio_id = t.portfolio_id AND s.ticker = t.ticker`;

const holdingsAllStmt       = db.prepare(`${HOLDINGS_SQL} GROUP BY t.portfolio_id, t.ticker HAVING shares > 0 ORDER BY p.display_order, p.code, t.ticker`);
const holdingsByPortfolioStmt = db.prepare(`${HOLDINGS_SQL} WHERE t.portfolio_id = ? GROUP BY t.portfolio_id, t.ticker HAVING shares > 0 ORDER BY p.display_order, p.code, t.ticker`);

function queryHoldings(portfolioId) {
  return portfolioId ? holdingsByPortfolioStmt.all(portfolioId) : holdingsAllStmt.all();
}


// Middleware
app.use(express.json({ limit: '10mb' }));

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET not set — sessions will not persist across server restarts. Set SESSION_SECRET in .env for production.');
}

app.use(session({
  store: new SQLiteSessionStore(db),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY === '1',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

// Serve React build in production, vanilla app in development
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client', 'dist')));
} else {
  app.use(express.static('public'));
}

// ===== AUTHENTICATION =====

app.get('/api/auth/session', (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    return res.json({ authenticated: false, needsSetup: true });
  }
  if (req.session.userId) {
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.session.userId);
    if (user) return res.json({ authenticated: true, user: { id: user.id, username: user.username } });
  }
  res.json({ authenticated: false, needsSetup: false });
});

app.post('/api/auth/setup', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || typeof username !== 'string' || username.trim().length < 2) {
      return res.status(400).json({ error: 'Username must be at least 2 characters' });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
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
  } catch (error) {
    serverError(res, error);
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username.trim());
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    req.session.regenerate((err) => {
      if (err) return serverError(res, err);
      req.session.userId = user.id;
      res.json({ success: true, user: { id: user.id, username: user.username } });
    });
  } catch (error) {
    serverError(res, error);
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return serverError(res, err);
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// Auth guard — all routes below this require authentication
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  if (!req.session.userId) return res.status(401).json({ error: 'Authentication required' });
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
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);
    const currentSid = req.sessionID;
    db.prepare('DELETE FROM sessions WHERE sid != ?').run(currentSid);
    res.json({ success: true });
  } catch (error) {
    serverError(res, error);
  }
});

// API Routes

// ===== PORTFOLIO MANAGEMENT =====

// Get all portfolios
app.get('/api/portfolios', (req, res) => {
  try {
    const portfolios = db.prepare('SELECT * FROM portfolios ORDER BY display_order, id').all();
    res.json(portfolios);
  } catch (error) {
    serverError(res, error);
  }
});

// Create a new portfolio
app.post('/api/portfolios', (req, res) => {
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

    const stmt = db.prepare('INSERT INTO portfolios (name, code) VALUES (?, ?)');
    const result = stmt.run(name, code.toUpperCase());

    backupPortfolios();
    res.json({
      id: result.lastInsertRowid,
      name,
      code: code.toUpperCase()
    });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      res.status(400).json({ error: 'Portfolio code already exists' });
    } else {
      serverError(res, error);
    }
  }
});

// Update portfolio order
app.put('/api/portfolios/:id/order', (req, res) => {
  try {
    const { display_order } = req.body;
    const stmt = db.prepare('UPDATE portfolios SET display_order = ? WHERE id = ?');
    const result = stmt.run(display_order, req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    backupPortfolios();
    res.json({ message: 'Portfolio order updated' });
  } catch (error) {
    serverError(res, error);
  }
});

// Set (or clear) manual cash balance for a portfolio
app.put('/api/portfolios/:id/cash-balance', (req, res) => {
  try {
    const { cash_balance } = req.body;
    const value = cash_balance === null || cash_balance === '' ? null : parseFloat(cash_balance);
    const result = db.prepare('UPDATE portfolios SET cash_balance = ? WHERE id = ?')
                     .run(value, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Portfolio not found' });
    res.json({ message: 'Cash balance updated', cash_balance: value });
  } catch (error) {
    serverError(res, error);
  }
});

// Update portfolio name and/or code
app.put('/api/portfolios/:id', (req, res) => {
  try {
    const { name, code } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    if (!code || !code.trim()) return res.status(400).json({ error: 'Code is required' });
    const upperCode = code.trim().toUpperCase();
    const existing = db.prepare('SELECT id FROM portfolios WHERE code = ? AND id != ?').get(upperCode, req.params.id);
    if (existing) return res.status(409).json({ error: `Code "${upperCode}" is already in use` });
    const result = db.prepare('UPDATE portfolios SET name = ?, code = ? WHERE id = ?').run(name.trim(), upperCode, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Portfolio not found' });
    backupPortfolios();
    res.json({ message: 'Portfolio updated', id: Number(req.params.id), name: name.trim(), code: upperCode });
  } catch (error) {
    serverError(res, error);
  }
});

// Delete a portfolio
app.delete('/api/portfolios/:id', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM portfolios WHERE id = ?');
    const result = stmt.run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    backupPortfolios();
    res.json({ message: 'Portfolio deleted' });
  } catch (error) {
    serverError(res, error);
  }
});

// ===== STOCK INFO MANAGEMENT =====

// Update stock info (market price and dividend data)
app.put('/api/portfolios/:portfolioId/stocks/:ticker', (req, res) => {
  try {
    const { portfolioId, ticker } = req.params;
    const { market_price, dividend_frequency, dividend_per_share, last_dividend_date, sector, investment_type } = req.body;

    const stmt = db.prepare(`
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
    `);

    stmt.run(
      portfolioId, ticker.toUpperCase(),
      market_price, dividend_frequency, dividend_per_share, last_dividend_date, sector, investment_type,
      market_price, dividend_frequency, dividend_per_share, last_dividend_date, sector, investment_type
    );

    res.json({ message: 'Stock info updated' });
  } catch (error) {
    serverError(res, error);
  }
});

// ===== MARKET DATA HELPERS =====

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

  // Step 1: hit fc.yahoo.com to get a session cookie
  const cookieRes = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });
  const rawCookie = cookieRes.headers.get('set-cookie') || '';
  // Extract the A1 (or first) cookie value
  const cookie = rawCookie.split(',').map(s => s.trim().split(';')[0]).filter(Boolean).join('; ');

  // Step 2: fetch the crumb using that cookie
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
  // Session expired — clear and retry once
  if ((chartRes.status === 401 || chartRes.status === 403) && retry) {
    _yahooSession = null;
    return fetchYahooQuote(ticker, false);
  }
  if (!chartRes.ok) throw new Error(`Yahoo Finance HTTP ${chartRes.status} for ${ticker}`);
  const chartData = await chartRes.json();
  const price = chartData?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
  if (price === null) throw new Error(`No price data for ${ticker} from Yahoo Finance`);

  // Attempt dividend yield from summaryDetail — optional, best-effort
  let dividendYield = null;
  try {
    const summaryRes = await fetch(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail&crumb=${encodeURIComponent(crumb)}`,
      { headers }
    );
    if (summaryRes.ok) {
      const summaryData = await summaryRes.json();
      const raw = summaryData?.quoteSummary?.result?.[0]?.summaryDetail?.dividendYield?.raw;
      if (raw != null) dividendYield = raw * 100; // Yahoo decimal (0.023) → percent (2.3) to match TMX scale
    }
  } catch { /* yield is optional */ }

  return { price, dividendYield };
}

function upsertStockInfo(portfolioId, ticker, marketPrice, dividendYield, payDate) {
  db.prepare(`
    INSERT INTO stock_info (portfolio_id, ticker, market_price, dividend_yield, last_dividend_date, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(portfolio_id, ticker) DO UPDATE SET
      market_price    = COALESCE(?, market_price),
      dividend_yield  = COALESCE(?, dividend_yield),
      last_dividend_date = COALESCE(?, last_dividend_date),
      updated_at      = CURRENT_TIMESTAMP
  `).run(portfolioId, ticker, marketPrice, dividendYield, payDate,
         marketPrice, dividendYield, payDate);
}

// Refresh prices for one portfolio, routing TMX vs US stocks to the correct source
app.post('/api/portfolios/:portfolioId/refresh-prices', async (req, res) => {
  try {
    const portfolioId = req.params.portfolioId;
    const holdings = db.prepare(`
      SELECT ticker,
        (SELECT market FROM transactions t2
         WHERE t2.portfolio_id = t.portfolio_id AND t2.ticker = t.ticker AND t2.market IS NOT NULL
         ORDER BY t2.id DESC LIMIT 1) AS market
      FROM transactions t
      WHERE portfolio_id = ? AND ticker != 'CASH'
      GROUP BY ticker
      HAVING SUM(CASE WHEN type IN ('BUY','DIVIDEND_REINVEST') THEN quantity
                      WHEN type = 'SELL' THEN -quantity ELSE 0 END) > 0
    `).all(portfolioId);

    if (!holdings.length) return res.json({ message: 'No holdings to update', updated: 0 });

    const wait = ms => new Promise(r => setTimeout(r, ms));
    const today = new Date(); today.setHours(0,0,0,0);
    let updated = 0; const errors = [];

    for (let i = 0; i < holdings.length; i++) {
      const { ticker, market } = holdings[i];
      const isUS = market === 'NYSE' || market === 'NASDAQ';
      try {
        if (isUS) {
          const q = await fetchYahooQuote(ticker);
          upsertStockInfo(portfolioId, ticker, q.price, q.dividendYield, null);
          console.log(`${ticker} (${market} via Yahoo): $${q.price?.toFixed(2)} yield=${q.dividendYield}%`);
        } else {
          const q = await fetchTMXQuote(ticker);
          if (!q) { errors.push({ ticker, error: 'No data from TMX' }); continue; }
          const price    = q.price         != null ? parseFloat(q.price)         : null;
          const divYield = q.dividendYield != null ? parseFloat(q.dividendYield) : null;
          const payDate  = q.dividendPayDate && new Date(q.dividendPayDate) > today ? q.dividendPayDate : null;
          upsertStockInfo(portfolioId, ticker, price, divYield, payDate);
          console.log(`${ticker} (TMX): $${price?.toFixed(2)} yield=${divYield}%`);
        }
        updated++;
      } catch (e) { errors.push({ ticker, error: e.message }); }
      if (i < holdings.length - 1) await wait(300);
    }

    res.json({ message: `Updated ${updated} of ${holdings.length} stocks`, updated,
               total: holdings.length, errors: errors.length ? errors : undefined });
  } catch (error) {
    serverError(res, error);
  }
});

// Refresh prices for ALL portfolios, routing TMX vs US stocks to the correct source
app.post('/api/refresh-all-prices', async (req, res) => {
  try {
    const holdings = db.prepare(`
      SELECT DISTINCT portfolio_id, ticker,
        (SELECT market FROM transactions t2
         WHERE t2.portfolio_id = t.portfolio_id AND t2.ticker = t.ticker AND t2.market IS NOT NULL
         ORDER BY t2.id DESC LIMIT 1) AS market
      FROM transactions t
      WHERE ticker != 'CASH'
      GROUP BY portfolio_id, ticker
      HAVING SUM(CASE WHEN type IN ('BUY','DIVIDEND_REINVEST') THEN quantity
                      WHEN type = 'SELL' THEN -quantity ELSE 0 END) > 0
    `).all();

    if (!holdings.length) return res.json({ message: 'No holdings to update', updated: 0 });

    const wait = ms => new Promise(r => setTimeout(r, ms));
    const today = new Date(); today.setHours(0,0,0,0);
    const errors = [];

    // Fetch each unique ticker once, routed by market
    const uniqueHoldings = [];
    const seen = new Set();
    for (const h of holdings) {
      if (!seen.has(h.ticker)) { seen.add(h.ticker); uniqueHoldings.push(h); }
    }

    const quotes = {};
    for (let i = 0; i < uniqueHoldings.length; i++) {
      const { ticker, market } = uniqueHoldings[i];
      const isUS = market === 'NYSE' || market === 'NASDAQ';
      try {
        if (isUS) {
          quotes[ticker] = await fetchYahooQuote(ticker);
          console.log(`${ticker} (${market} via Yahoo): $${quotes[ticker]?.price?.toFixed(2)}`);
        } else {
          quotes[ticker] = await fetchTMXQuote(ticker);
          console.log(`${ticker} (TMX): $${quotes[ticker]?.price?.toFixed(2)}`);
        }
      } catch (e) {
        errors.push({ ticker, error: e.message });
        quotes[ticker] = null;
      }
      if (i < uniqueHoldings.length - 1) await wait(300);
    }

    // Write to every portfolio that holds each ticker
    let updated = 0;
    for (const { portfolio_id, ticker, market } of holdings) {
      const q = quotes[ticker];
      if (!q) continue;
      const isUS = market === 'NYSE' || market === 'NASDAQ';
      if (isUS) {
        upsertStockInfo(portfolio_id, ticker, q.price, q.dividendYield, null);
      } else {
        const price    = q.price         != null ? parseFloat(q.price)         : null;
        const divYield = q.dividendYield != null ? parseFloat(q.dividendYield) : null;
        const payDate  = q.dividendPayDate && new Date(q.dividendPayDate) > today ? q.dividendPayDate : null;
        upsertStockInfo(portfolio_id, ticker, price, divYield, payDate);
      }
      updated++;
    }

    res.json({ message: `Updated ${updated} stock-portfolio entries (${uniqueHoldings.length} unique tickers)`,
               updated, total: holdings.length, errors: errors.length ? errors : undefined });
  } catch (error) {
    serverError(res, error);
  }
});

// ===== DIVIDEND INCOME =====

// Monthly dividend totals grouped by portfolio, year, month
function computeMonthlyACB(txRows) {
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
  const now = new Date();
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

app.get('/api/summary/monthly-acb', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT portfolio_id, ticker, type, quantity, total,
             COALESCE(commission, 0) AS commission, date
      FROM transactions
      WHERE type IN ('BUY', 'DIVIDEND_REINVEST', 'SELL')
      ORDER BY date ASC, id ASC
    `).all();
    res.json(computeMonthlyACB(rows));
  } catch (error) {
    serverError(res, error);
  }
});

app.get('/api/dividends/monthly', (req, res) => {
  try {
    const rows = db.prepare(`
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
    `).all();
    res.json(rows);
  } catch (error) {
    serverError(res, error);
  }
});

// ===== TRANSACTION MANAGEMENT =====

// Get transactions for a specific ticker within a portfolio
app.get('/api/portfolios/:portfolioId/transactions/ticker/:ticker', (req, res) => {
  try {
    const transactions = db.prepare(`
      SELECT id, ticker, type, quantity, price, total, commission, date
      FROM transactions
      WHERE portfolio_id = ? AND ticker = ?
      ORDER BY date ASC, created_at ASC
    `).all(req.params.portfolioId, req.params.ticker.toUpperCase());
    res.json(transactions);
  } catch (error) {
    serverError(res, error);
  }
});

// Get all transactions for a portfolio
app.get('/api/portfolios/:portfolioId/transactions', (req, res) => {
  try {
    const transactions = db.prepare(`
      SELECT t.*, p.code as portfolio_code, p.name as portfolio_name
      FROM transactions t
      JOIN portfolios p ON t.portfolio_id = p.id
      WHERE t.portfolio_id = ?
      ORDER BY t.date DESC, t.created_at DESC
    `).all(req.params.portfolioId);
    res.json(transactions);
  } catch (error) {
    serverError(res, error);
  }
});

// All portfolios cash/invested/market-value overview
app.get('/api/overview', (req, res) => {
  try {
    const portfolios = db.prepare('SELECT * FROM portfolios ORDER BY display_order, id').all();

    const allHoldings = computeHoldings(queryHoldings(null));
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
        // Cash invested: cost basis of currently-held shares (avg buy price × shares held)
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

// Add a new transaction
app.post('/api/transactions', (req, res) => {
  try {
    const { portfolio_id, ticker, type, quantity, price, total, date, commission, market } = req.body;

    const isCashFlow = type === 'CONTRIBUTION' || type === 'WITHDRAWAL';
    const finalTicker = (isCashFlow && !ticker) ? 'CASH' : ticker;

    if (!portfolio_id || !finalTicker || !type || !date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // For dividends, total is provided; for others, calculate from quantity * price
    const finalTotal = total !== undefined ? total : (quantity * price);
    const finalQuantity = quantity !== undefined ? quantity : 0;
    const finalPrice = price !== undefined ? price : 0;

    const stmt = db.prepare(`
      INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total, commission, date, market)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(portfolio_id, finalTicker.toUpperCase(), type.toUpperCase(), finalQuantity, finalPrice, finalTotal, commission || 0, date, market || 'TMX');

    res.json({
      id: result.lastInsertRowid,
      portfolio_id,
      ticker,
      type,
      quantity: finalQuantity,
      price: finalPrice,
      total: finalTotal,
      commission: commission || 0,
      date
    });
  } catch (error) {
    serverError(res, error);
  }
});

// Get portfolio summary (aggregated holdings)
app.get('/api/portfolios/:portfolioId/summary', (req, res) => {
  try {
    const rows = queryHoldings(req.params.portfolioId);
    res.json(computeHoldings(rows));
  } catch (error) {
    serverError(res, error);
  }
});

// All portfolios combined summary
app.get('/api/summary', (req, res) => {
  try {
    const rows = queryHoldings(null);
    res.json(computeHoldings(rows));
  } catch (error) {
    serverError(res, error);
  }
});

// Delete a transaction
app.delete('/api/transactions/:id', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM transactions WHERE id = ?');
    const result = stmt.run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({ message: 'Transaction deleted' });
  } catch (error) {
    serverError(res, error);
  }
});

// ===== CSV IMPORT =====

app.post('/api/import/csv', (req, res) => {
  try {
    const { csvData } = req.body;

    if (!csvData) {
      return res.status(400).json({ error: 'CSV data required' });
    }

    const lines = csvData.trim().split('\n');
    const imported = [];
    const errors = [];

    console.log(`Processing ${lines.length} lines from CSV`);
    console.log('First line (header):', lines[0]);

    // Skip header row
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        // Parse CSV line: Date, Symbol, Portfolio, Type, Quantity, Share Price, Total (+ optional trailing columns)
        const parts = parseCSVLine(line);

        console.log(`Line ${i + 1}: ${parts.length} parts:`, parts);

        if (parts.length < 7) {
          errors.push({ line: i + 1, error: `Invalid CSV format - expected at least 7 columns, got ${parts.length}`, data: line });
          continue;
        }

        // Col 0: Date, 1: Symbol, 2: Portfolio, 3: Type, 4: Quantity, 5: Share Price, 6: Total
        const [dateStr, symbol, portfolioCode, typeCode, quantityStr, priceStr, totalStr] = parts;

        // Find portfolio by code
        const cleanPortfolioCode = portfolioCode.toUpperCase().trim();
        console.log(`Looking for portfolio with code: '${cleanPortfolioCode}' (original: '${portfolioCode}')`);

        const portfolio = db.prepare('SELECT id, code FROM portfolios WHERE code = ?').get(cleanPortfolioCode);
        if (!portfolio) {
          const allPortfolios = db.prepare('SELECT code FROM portfolios').all();
          console.log(`Available portfolios:`, allPortfolios.map(p => p.code));
          errors.push({ line: i + 1, error: `Portfolio '${cleanPortfolioCode}' not found. Available portfolios: ${allPortfolios.map(p => p.code).join(', ')}`, data: line });
          continue;
        }

        // Parse date (DD-MMM-YY format to YYYY-MM-DD)
        const parsedDate = parseDate(dateStr);
        console.log(`Parsed date '${dateStr}' to '${parsedDate}'`);

        // Parse type code
        const typeMap = {
          'D': 'DIVIDEND',
          'B': 'BUY',
          'S': 'SELL',
          'DR': 'DIVIDEND_REINVEST'
        };
        const type = typeMap[typeCode] || typeCode;

        // Parse numbers (remove $ and spaces)
        const quantity = parseFloat(quantityStr.replace(/[$\s,]/g, '')) || 0;
        const price = parseFloat(priceStr.replace(/[$\s,]/g, '')) || 0;
        const total = parseFloat(totalStr.replace(/[$\s,]/g, '')) || 0;

        // Check for duplicate transaction
        const duplicate = db.prepare(`
          SELECT id FROM transactions
          WHERE portfolio_id = ?
            AND ticker = ?
            AND type = ?
            AND date = ?
            AND quantity = ?
            AND price = ?
        `).get(portfolio.id, symbol, type, parsedDate, quantity, price);

        if (duplicate) {
          console.log(`Skipping duplicate on line ${i + 1}: ${symbol} - ${type} on ${parsedDate}`);
          errors.push({ line: i + 1, error: 'Duplicate transaction (skipped)', data: line });
          continue;
        }

        const stmt = db.prepare(`
          INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total, date)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(portfolio.id, symbol, type, quantity, price, total, parsedDate);
        imported.push({ line: i + 1, symbol, portfolio: portfolioCode, date: parsedDate });
        console.log(`Successfully imported line ${i + 1}: ${symbol} - ${type}`);

      } catch (error) {
        errors.push({ line: i + 1, error: error.message, data: line });
        console.error(`Error on line ${i + 1}:`, error.message);
      }
    }

    console.log(`Import complete: ${imported.length} imported, ${errors.length} errors`);

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


// SPA fallback — must come after all API routes
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`Yieldly server running at http://localhost:${PORT}`);
  backupPortfolios(); // ensure portfolios.json is always in sync on startup
});
