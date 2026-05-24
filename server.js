require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = 3000;
const ALPHA_KEY = process.env.ALPHA_KEY;

// Build the holdings SQL query. When portfolioId is provided, filters to that portfolio.
function queryHoldings(portfolioId) {
  const whereClause = portfolioId ? `WHERE t.portfolio_id = ${portfolioId}` : '';
  return db.prepare(`
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
    LEFT JOIN stock_info s ON s.portfolio_id = t.portfolio_id AND s.ticker = t.ticker
    ${whereClause}
    GROUP BY t.portfolio_id, t.ticker
    HAVING shares > 0 OR shares_sold > 0
    ORDER BY p.display_order, p.code, t.ticker
  `).all();
}

function computeHoldings(rows) {
  return rows.map(h => {
    const shares      = h.shares      || 0;
    const buyTotal    = h.buy_total   || 0;
    const saleTotal   = h.sale_total  || 0;
    const divPaid     = h.dividends_paid || 0;
    const buyExpense  = h.buy_expense || 0;
    const saleExpense = h.sale_expense || 0;
    const sharesBought= h.shares_bought || 0;
    const marketPrice = h.market_price  || 0;
    const marketValue = shares * marketPrice;
    const totalReturn = marketValue + saleTotal + divPaid - buyTotal;
    const returnPct   = buyTotal > 0 ? (totalReturn / buyTotal) * 100 : 0;
    const divFreq    = h.dividend_frequency || '';
    const freqMap    = { Monthly: 12, Quarterly: 4, 'Semi-Annual': 2, Annual: 1 };
    const multiplier = freqMap[divFreq] || 0;
    const storedYield = h.dividend_yield;   // % from TMX (e.g. 5.5)
    const storedPerShare = h.dividend_per_share || 0;

    let annualPayout, nextPayout, divPerShare, divYield;
    if (storedYield != null && storedYield > 0 && marketValue > 0) {
      // Yield-first approach: Annual = MktVal × Yield%, Next = Annual ÷ Freq, PerShare = Next ÷ Shares
      annualPayout = marketValue * storedYield / 100;
      nextPayout   = multiplier > 0 ? annualPayout / multiplier : 0;
      divPerShare  = (shares > 0 && multiplier > 0) ? nextPayout / shares : 0;
      divYield     = storedYield;
    } else {
      // Fallback: per-share manually entered
      nextPayout   = shares * storedPerShare;
      annualPayout = nextPayout * multiplier;
      divPerShare  = storedPerShare;
      divYield     = marketValue > 0 ? (annualPayout / marketValue) * 100 : 0;
    }
    const totalExpense= buyExpense + saleExpense;
    const proceeds    = saleTotal - saleExpense;
    const acb         = sharesBought > 0 ? (buyTotal + buyExpense) * (shares / sharesBought) : 0;
    return {
      portfolio_code:    h.portfolio_code || '',
      portfolio_name:    h.portfolio_name || '',
      ticker:            h.ticker,
      investment_type:   h.investment_type || '',
      sector:            h.sector || '',
      shares,
      buy_price:         h.buy_price  || 0,
      market_price:      marketPrice,
      sale_price:        h.sale_price || 0,
      buy_total:         buyTotal,
      market_value:      marketValue,
      sale_total:        saleTotal,
      dividends_paid:    divPaid,
      return:            totalReturn,
      return_percent:    returnPct,
      dividend_frequency:  divFreq,
      dividend_per_share:  divPerShare,
      last_dividend_date:  h.last_dividend_date || '',
      next_payout:   nextPayout,
      annual_payout: annualPayout,
      dividend_yield:    divYield,
      buy_count:   h.buy_count  || 0,
      sell_count:  h.sell_count || 0,
      buy_expense:   buyExpense,
      sale_expense:  saleExpense,
      total_expense: totalExpense,
      proceeds,
      acb
    };
  });
}

// Middleware
app.use(express.json());
app.use(express.static('public'));

// API Routes

// ===== PORTFOLIO MANAGEMENT =====

// Get all portfolios
app.get('/api/portfolios', (req, res) => {
  try {
    const portfolios = db.prepare('SELECT * FROM portfolios ORDER BY display_order, id').all();
    res.json(portfolios);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new portfolio
app.post('/api/portfolios', (req, res) => {
  try {
    const { name, code } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: 'Name and code are required' });
    }

    const stmt = db.prepare('INSERT INTO portfolios (name, code) VALUES (?, ?)');
    const result = stmt.run(name, code.toUpperCase());

    res.json({
      id: result.lastInsertRowid,
      name,
      code: code.toUpperCase()
    });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      res.status(400).json({ error: 'Portfolio code already exists' });
    } else {
      res.status(500).json({ error: error.message });
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

    res.json({ message: 'Portfolio order updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
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

    res.json({ message: 'Portfolio deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

// ===== TMX DATA HELPERS =====

function normalizeTicker(ticker) {
  return ticker.replace(/\.TO$/i, '').replace(/-/g, '.');
}

async function fetchTMXQuote(ticker) {
  const symbol = normalizeTicker(ticker);
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

// Refresh prices for one portfolio using TMX
app.post('/api/portfolios/:portfolioId/refresh-prices', async (req, res) => {
  try {
    const portfolioId = req.params.portfolioId;
    const tickers = db.prepare(`
      SELECT DISTINCT ticker FROM transactions
      WHERE portfolio_id = ? AND ticker != 'CASH'
      GROUP BY ticker
      HAVING SUM(CASE WHEN type IN ('BUY','DIVIDEND_REINVEST') THEN quantity
                      WHEN type = 'SELL' THEN -quantity ELSE 0 END) > 0
    `).all(portfolioId).map(r => r.ticker);

    if (!tickers.length) return res.json({ message: 'No holdings to update', updated: 0 });

    const wait = ms => new Promise(r => setTimeout(r, ms));
    const today = new Date(); today.setHours(0,0,0,0);
    let updated = 0; const errors = [];

    for (let i = 0; i < tickers.length; i++) {
      const ticker = tickers[i];
      try {
        const q = await fetchTMXQuote(ticker);
        if (!q) { errors.push({ ticker, error: 'No data' }); }
        else {
          const price = q.price != null ? parseFloat(q.price) : null;
          // TMX returns dividendYield as 0–100 percentage (e.g. 5.5 = 5.5%)
          const divYield = q.dividendYield != null ? parseFloat(q.dividendYield) : null;
          const payDate  = q.dividendPayDate && new Date(q.dividendPayDate) > today
                           ? q.dividendPayDate : null;
          upsertStockInfo(portfolioId, ticker, price, divYield, payDate);
          console.log(`${ticker}: $${price?.toFixed(2)} yield=${divYield}%`);
          updated++;
        }
      } catch (e) { errors.push({ ticker, error: e.message }); }
      if (i < tickers.length - 1) await wait(300);
    }

    res.json({ message: `Updated ${updated} of ${tickers.length} stocks`, updated,
               total: tickers.length, errors: errors.length ? errors : undefined });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Refresh prices for ALL portfolios using TMX (fetches each unique ticker once)
app.post('/api/refresh-all-prices', async (req, res) => {
  try {
    // All portfolio_id/ticker combos with current holdings
    const holdings = db.prepare(`
      SELECT DISTINCT portfolio_id, ticker FROM transactions
      WHERE ticker != 'CASH'
      GROUP BY portfolio_id, ticker
      HAVING SUM(CASE WHEN type IN ('BUY','DIVIDEND_REINVEST') THEN quantity
                      WHEN type = 'SELL' THEN -quantity ELSE 0 END) > 0
    `).all();

    if (!holdings.length) return res.json({ message: 'No holdings to update', updated: 0 });

    const wait = ms => new Promise(r => setTimeout(r, ms));
    const today = new Date(); today.setHours(0,0,0,0);
    const errors = [];

    // Fetch each unique ticker from TMX once
    const uniqueTickers = [...new Set(holdings.map(h => h.ticker))];
    const quotes = {};
    for (let i = 0; i < uniqueTickers.length; i++) {
      const ticker = uniqueTickers[i];
      try {
        quotes[ticker] = await fetchTMXQuote(ticker);
        console.log(`${ticker}: ${JSON.stringify(quotes[ticker])}`);
      } catch (e) {
        errors.push({ ticker, error: e.message });
        quotes[ticker] = null;
      }
      if (i < uniqueTickers.length - 1) await wait(300);
    }

    // Write to every portfolio that holds each ticker
    let updated = 0;
    for (const { portfolio_id, ticker } of holdings) {
      const q = quotes[ticker];
      if (!q) continue;
      const price    = q.price         != null ? parseFloat(q.price)         : null;
      const divYield = q.dividendYield != null ? parseFloat(q.dividendYield) : null;
      const payDate  = q.dividendPayDate && new Date(q.dividendPayDate) > today
                       ? q.dividendPayDate : null;
      upsertStockInfo(portfolio_id, ticker, price, divYield, payDate);
      updated++;
    }

    res.json({ message: `Updated ${updated} stock-portfolio entries (${uniqueTickers.length} unique tickers)`,
               updated, total: holdings.length, errors: errors.length ? errors : undefined });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== TRANSACTION MANAGEMENT =====

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
    res.status(500).json({ error: error.message });
  }
});

// All portfolios cash/invested/market-value overview
app.get('/api/overview', (req, res) => {
  try {
    const portfolios = db.prepare('SELECT * FROM portfolios ORDER BY display_order, id').all();

    const cashRows = db.prepare(`
      SELECT portfolio_id,
        SUM(CASE
          WHEN type = 'CONTRIBUTION'                 THEN  total
          WHEN type = 'WITHDRAWAL'                   THEN -total
          WHEN type = 'DIVIDEND'                     THEN  total
          WHEN type = 'SELL'                         THEN  total
          WHEN type IN ('BUY','DIVIDEND_REINVEST')   THEN -total
          ELSE 0 END) AS cash,
        SUM(CASE WHEN type IN ('BUY','DIVIDEND_REINVEST') THEN total ELSE 0 END) AS cash_invested
      FROM transactions GROUP BY portfolio_id
    `).all();

    const cashById = {};
    cashRows.forEach(r => { cashById[r.portfolio_id] = r; });

    const allHoldings = computeHoldings(queryHoldings(null));
    const mktValById = {};
    const pidByCode = {};
    portfolios.forEach(p => { pidByCode[p.code] = p.id; });
    allHoldings.forEach(h => {
      const pid = pidByCode[h.portfolio_code];
      if (pid) mktValById[pid] = (mktValById[pid] || 0) + h.market_value;
    });

    res.json(portfolios.map(p => ({
      id:           p.id,
      code:         p.code,
      name:         p.name,
      cash:         cashById[p.id]?.cash         || 0,
      cash_invested:cashById[p.id]?.cash_invested || 0,
      market_value: mktValById[p.id]             || 0
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a new transaction
app.post('/api/transactions', (req, res) => {
  try {
    const { portfolio_id, ticker, type, quantity, price, total, date, commission } = req.body;

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
      INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total, commission, date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(portfolio_id, finalTicker.toUpperCase(), type.toUpperCase(), finalQuantity, finalPrice, finalTotal, commission || 0, date);

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
    res.status(500).json({ error: error.message });
  }
});

// Get portfolio summary (aggregated holdings)
app.get('/api/portfolios/:portfolioId/summary', (req, res) => {
  try {
    const rows = queryHoldings(req.params.portfolioId);
    res.json(computeHoldings(rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// All portfolios combined summary
app.get('/api/summary', (req, res) => {
  try {
    const rows = queryHoldings(null);
    res.json(computeHoldings(rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
        // Parse CSV line: Date, Symbol, Portfolio, Type, Quantity, Share Price, Total (ignore extra columns like Month, Year)
        const parts = line.split(',').map(p => p.trim());

        console.log(`Line ${i + 1}: ${parts.length} parts:`, parts);

        if (parts.length < 7) {
          errors.push({ line: i + 1, error: `Invalid CSV format - expected at least 7 columns, got ${parts.length}`, data: line });
          continue;
        }

        // Extract first 7 columns, ignore any additional ones (Month, Year, etc.)
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
    res.status(500).json({ error: error.message });
  }
});

// Helper function to parse date from DD-MMM-YY to YYYY-MM-DD
function parseDate(dateStr) {
  const months = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };

  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr; // Return as-is if not expected format

  const day = parts[0].padStart(2, '0');
  const month = months[parts[1]] || '01';
  let year = parts[2];

  // Convert 2-digit year to 4-digit (assuming 2000s for < 50, 1900s for >= 50)
  if (year.length === 2) {
    year = parseInt(year) < 50 ? '20' + year : '19' + year;
  }

  return `${year}-${month}-${day}`;
}

// Start server
app.listen(PORT, () => {
  console.log(`Yieldly server running at http://localhost:${PORT}`);
});
