require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = 3000;
const ALPHA_KEY = process.env.ALPHA_KEY;

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
    const { market_price, dividend_frequency, dividend_per_share, last_dividend_date } = req.body;

    const stmt = db.prepare(`
      INSERT INTO stock_info (portfolio_id, ticker, market_price, dividend_frequency, dividend_per_share, last_dividend_date, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(portfolio_id, ticker) DO UPDATE SET
        market_price = COALESCE(?, market_price),
        dividend_frequency = COALESCE(?, dividend_frequency),
        dividend_per_share = COALESCE(?, dividend_per_share),
        last_dividend_date = COALESCE(?, last_dividend_date),
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(
      portfolioId, ticker.toUpperCase(),
      market_price, dividend_frequency, dividend_per_share, last_dividend_date,
      market_price, dividend_frequency, dividend_per_share, last_dividend_date
    );

    res.json({ message: 'Stock info updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Refresh prices from Alpha Vantage API
app.post('/api/portfolios/:portfolioId/refresh-prices', async (req, res) => {
  try {
    if (!ALPHA_KEY) {
      return res.status(500).json({ error: 'Alpha Vantage API key not configured. Please add ALPHA_KEY to your .env file' });
    }

    console.log('Alpha Vantage API Key loaded:', ALPHA_KEY ? 'Yes' : 'No');

    const portfolioId = req.params.portfolioId;

    // Get all unique tickers from portfolio holdings
    const holdings = db.prepare(`
      SELECT DISTINCT ticker
      FROM transactions
      WHERE portfolio_id = ?
      GROUP BY ticker
      HAVING SUM(CASE
        WHEN type IN ('BUY', 'DIVIDEND_REINVEST') THEN quantity
        WHEN type = 'SELL' THEN -quantity
        ELSE 0
      END) > 0
    `).all(portfolioId);

    if (holdings.length === 0) {
      return res.json({ message: 'No holdings to update', updated: 0 });
    }

    const tickers = holdings.map(h => h.ticker);
    console.log(`Fetching prices for ${tickers.length} stocks using Alpha Vantage`);
    console.log(`Note: Free tier limit is 25 requests/day, 5 requests/minute`);

    let updated = 0;
    const errors = [];

    // Helper function to wait between requests (rate limiting)
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Process each holding individually
    for (let i = 0; i < holdings.length; i++) {
      try {
        const ticker = holdings[i].ticker;
        console.log(`[${i + 1}/${holdings.length}] Fetching quote for ${ticker}...`);

        // Alpha Vantage GLOBAL_QUOTE endpoint supports TSX stocks
        const quoteUrl = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${ALPHA_KEY}`;
        const quoteResponse = await fetch(quoteUrl);

        if (!quoteResponse.ok) {
          const errorText = await quoteResponse.text();
          console.error(`Alpha Vantage API Response for ${ticker}:`, quoteResponse.status, errorText);
          errors.push({ ticker, error: `API error (${quoteResponse.status})` });

          // Wait 12 seconds between requests (5 per minute rate limit)
          if (i < holdings.length - 1) await wait(12000);
          continue;
        }

        const quoteData = await quoteResponse.json();

        // Check for API error messages
        if (quoteData['Error Message']) {
          errors.push({ ticker, error: 'Invalid ticker symbol' });
          console.log(`${ticker}: Invalid symbol`);
          if (i < holdings.length - 1) await wait(12000);
          continue;
        }

        if (quoteData['Note']) {
          errors.push({ ticker, error: 'API rate limit reached' });
          console.log(`${ticker}: Rate limit reached`);
          break; // Stop processing if we hit rate limit
        }

        const quote = quoteData['Global Quote'];
        if (!quote || !quote['05. price']) {
          errors.push({ ticker, error: 'No quote data returned' });
          console.log(`${ticker}: No data returned`);
          if (i < holdings.length - 1) await wait(12000);
          continue;
        }

        const marketPrice = parseFloat(quote['05. price']);

        if (!marketPrice || marketPrice <= 0) {
          errors.push({ ticker, error: 'Invalid price data' });
          if (i < holdings.length - 1) await wait(12000);
          continue;
        }

        console.log(`${ticker}: $${marketPrice.toFixed(2)}`);

        // For now, skip dividend data fetching to conserve API calls
        // Alpha Vantage has a separate endpoint for dividends that would use more API calls
        let dividendData = null;

        // Update stock_info
        const stmt = db.prepare(`
          INSERT INTO stock_info (portfolio_id, ticker, market_price, dividend_frequency, dividend_per_share, last_dividend_date, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(portfolio_id, ticker) DO UPDATE SET
            market_price = ?,
            dividend_frequency = COALESCE(?, dividend_frequency),
            dividend_per_share = COALESCE(?, dividend_per_share),
            last_dividend_date = COALESCE(?, last_dividend_date),
            updated_at = CURRENT_TIMESTAMP
        `);

        stmt.run(
          portfolioId, ticker, marketPrice,
          dividendData?.frequency, dividendData?.per_share, dividendData?.last_date,
          marketPrice,
          dividendData?.frequency, dividendData?.per_share, dividendData?.last_date
        );

        updated++;

        // Wait 12 seconds between requests (5 per minute rate limit)
        if (i < holdings.length - 1) {
          console.log(`Waiting 12 seconds before next request...`);
          await wait(12000);
        }

      } catch (error) {
        errors.push({ ticker: holdings[i].ticker, error: error.message });
        console.error(`Error processing ${holdings[i].ticker}:`, error);

        // Wait even on error to respect rate limits
        if (i < holdings.length - 1) await wait(12000);
      }
    }

    res.json({
      message: `Updated ${updated} of ${holdings.length} stocks`,
      updated: updated,
      total: holdings.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Error refreshing prices:', error);
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

// Add a new transaction
app.post('/api/transactions', (req, res) => {
  try {
    const { portfolio_id, ticker, type, quantity, price, total, date } = req.body;

    if (!portfolio_id || !ticker || !type || !date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // For dividends, total is provided; for others, calculate from quantity * price
    const finalTotal = total !== undefined ? total : (quantity * price);
    const finalQuantity = quantity !== undefined ? quantity : 0;
    const finalPrice = price !== undefined ? price : 0;

    const stmt = db.prepare(`
      INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total, date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(portfolio_id, ticker.toUpperCase(), type.toUpperCase(), finalQuantity, finalPrice, finalTotal, date);

    res.json({
      id: result.lastInsertRowid,
      portfolio_id,
      ticker,
      type,
      quantity: finalQuantity,
      price: finalPrice,
      total: finalTotal,
      date
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get portfolio summary (aggregated holdings)
app.get('/api/portfolios/:portfolioId/summary', (req, res) => {
  try {
    const holdings = db.prepare(`
      SELECT
        t.ticker,
        -- Current shares (Buys + Reinvestments - Sells)
        SUM(CASE
          WHEN t.type IN ('BUY', 'DIVIDEND_REINVEST') THEN t.quantity
          WHEN t.type = 'SELL' THEN -t.quantity
          ELSE 0
        END) as shares,

        -- Total shares bought (for average cost calculation)
        SUM(CASE WHEN t.type IN ('BUY', 'DIVIDEND_REINVEST') THEN t.quantity ELSE 0 END) as shares_bought,

        -- Total shares sold
        SUM(CASE WHEN t.type = 'SELL' THEN t.quantity ELSE 0 END) as shares_sold,

        -- Buy Total (total amount invested)
        SUM(CASE WHEN t.type IN ('BUY', 'DIVIDEND_REINVEST') THEN t.total ELSE 0 END) as buy_total,

        -- Sale Total (total from sales)
        SUM(CASE WHEN t.type = 'SELL' THEN t.total ELSE 0 END) as sale_total,

        -- Dividends Paid (total dividends received)
        SUM(CASE WHEN t.type = 'DIVIDEND' THEN t.total ELSE 0 END) as dividends_paid,

        -- Average buy price (weighted)
        SUM(CASE WHEN t.type IN ('BUY', 'DIVIDEND_REINVEST') THEN t.total ELSE 0 END) /
        NULLIF(SUM(CASE WHEN t.type IN ('BUY', 'DIVIDEND_REINVEST') THEN t.quantity ELSE 0 END), 0) as buy_price,

        -- Average sale price
        SUM(CASE WHEN t.type = 'SELL' THEN t.total ELSE 0 END) /
        NULLIF(SUM(CASE WHEN t.type = 'SELL' THEN t.quantity ELSE 0 END), 0) as sale_price,

        -- Stock info (market price and dividend data)
        s.market_price,
        s.dividend_frequency,
        s.dividend_per_share,
        s.last_dividend_date

      FROM transactions t
      LEFT JOIN stock_info s ON s.portfolio_id = t.portfolio_id AND s.ticker = t.ticker
      WHERE t.portfolio_id = ?
      GROUP BY t.ticker
      HAVING shares > 0 OR shares_sold > 0
    `).all(req.params.portfolioId);

    const portfolio = holdings.map(holding => {
      const shares = holding.shares || 0;
      const buyPrice = holding.buy_price || 0;
      const salePrice = holding.sale_price || 0;
      const buyTotal = holding.buy_total || 0;
      const saleTotal = holding.sale_total || 0;
      const dividendsPaid = holding.dividends_paid || 0;

      // Market price from stock_info table (default 0)
      const marketPrice = holding.market_price || 0;
      const marketValue = shares * marketPrice;

      // Return calculation: (Current Value + Sales + Dividends) - Investment
      const totalReturn = marketValue + saleTotal + dividendsPaid - buyTotal;
      const returnPercent = buyTotal > 0 ? (totalReturn / buyTotal) * 100 : 0;

      // Dividend calculations
      const dividendPerShare = holding.dividend_per_share || 0;
      const dividendFrequency = holding.dividend_frequency || '';

      // Calculate annual payout based on frequency
      let annualMultiplier = 0;
      if (dividendFrequency === 'Monthly') annualMultiplier = 12;
      else if (dividendFrequency === 'Quarterly') annualMultiplier = 4;
      else if (dividendFrequency === 'Semi-Annual') annualMultiplier = 2;
      else if (dividendFrequency === 'Annual') annualMultiplier = 1;

      const nextPayout = shares * dividendPerShare;
      const annualPayout = nextPayout * annualMultiplier;
      const dividendYield = marketValue > 0 ? (annualPayout / marketValue) * 100 : 0;

      return {
        ticker: holding.ticker,
        shares: shares,
        buy_price: buyPrice,
        market_price: marketPrice,
        sale_price: salePrice,
        buy_total: buyTotal,
        market_value: marketValue,
        sale_total: saleTotal,
        dividends_paid: dividendsPaid,
        return: totalReturn,
        return_percent: returnPercent,
        // Dividend fields
        dividend_frequency: dividendFrequency,
        dividend_per_share: dividendPerShare,
        last_dividend_date: holding.last_dividend_date || '',
        next_payout: nextPayout,
        annual_payout: annualPayout,
        dividend_yield: dividendYield
      };
    });

    res.json(portfolio);
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
