const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// API Routes

// ===== PORTFOLIO MANAGEMENT =====

// Get all portfolios
app.get('/api/portfolios', (req, res) => {
  try {
    const portfolios = db.prepare('SELECT * FROM portfolios ORDER BY name').all();
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
        ticker,
        SUM(CASE
          WHEN type IN ('BUY', 'DIVIDEND_REINVEST') THEN quantity
          WHEN type = 'SELL' THEN -quantity
          ELSE 0
        END) as total_shares,
        SUM(CASE
          WHEN type IN ('BUY', 'DIVIDEND_REINVEST') THEN total
          WHEN type = 'SELL' THEN -total
          ELSE 0
        END) as total_cost,
        SUM(CASE WHEN type = 'DIVIDEND' THEN total ELSE 0 END) as total_dividends
      FROM transactions
      WHERE portfolio_id = ?
      GROUP BY ticker
      HAVING total_shares > 0
    `).all(req.params.portfolioId);

    const portfolio = holdings.map(holding => ({
      ticker: holding.ticker,
      shares: holding.total_shares,
      avgCost: holding.total_cost / holding.total_shares,
      totalDividends: holding.total_dividends
    }));

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

    // Skip header row
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        // Parse CSV line: Date, Symbol, Portfolio, Type, Quantity, Share Price, Total
        const parts = line.split(',').map(p => p.trim());

        if (parts.length < 7) {
          errors.push({ line: i + 1, error: 'Invalid CSV format' });
          continue;
        }

        const [dateStr, symbol, portfolioCode, typeCode, quantityStr, priceStr, totalStr] = parts;

        // Find portfolio by code
        const portfolio = db.prepare('SELECT id FROM portfolios WHERE code = ?').get(portfolioCode.toUpperCase());
        if (!portfolio) {
          errors.push({ line: i + 1, error: `Portfolio '${portfolioCode}' not found` });
          continue;
        }

        // Parse date (DD-MMM-YY format to YYYY-MM-DD)
        const parsedDate = parseDate(dateStr);

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

        const stmt = db.prepare(`
          INSERT INTO transactions (portfolio_id, ticker, type, quantity, price, total, date)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(portfolio.id, symbol, type, quantity, price, total, parsedDate);
        imported.push({ line: i + 1, symbol, portfolio: portfolioCode, date: parsedDate });

      } catch (error) {
        errors.push({ line: i + 1, error: error.message });
      }
    }

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
