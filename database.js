const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'yieldly.db');
const db = new Database(dbPath);

// Create portfolios table
db.exec(`
  CREATE TABLE IF NOT EXISTS portfolios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    display_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Create transactions table with portfolio support
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portfolio_id INTEGER NOT NULL,
    ticker TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('BUY', 'SELL', 'DIVIDEND', 'DIVIDEND_REINVEST')),
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    total REAL NOT NULL,
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE
  )
`);

// Migration: Check if portfolio_id column exists
const columnExists = db.prepare(`
  SELECT COUNT(*) as count FROM pragma_table_info('transactions')
  WHERE name = 'portfolio_id'
`).get();

// If the column doesn't exist, we need to migrate
if (columnExists.count === 0) {
  console.log('Migrating old database schema...');

  // Check if there's any existing data
  const hasData = db.prepare(`SELECT COUNT(*) as count FROM transactions`).get();

  if (hasData.count > 0) {
    console.log(`Found ${hasData.count} existing transactions. Creating default portfolio for migration...`);

    // Create a default portfolio for existing data
    const defaultPortfolio = db.prepare(`
      INSERT OR IGNORE INTO portfolios (name, code) VALUES ('Default', 'DEF')
    `).run();

    const portfolio = db.prepare(`SELECT id FROM portfolios WHERE code = 'DEF'`).get();

    // Recreate the transactions table with the new schema
    db.exec(`
      -- Create new table with correct schema
      CREATE TABLE transactions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portfolio_id INTEGER NOT NULL,
        ticker TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('BUY', 'SELL', 'DIVIDEND', 'DIVIDEND_REINVEST')),
        quantity REAL NOT NULL,
        price REAL NOT NULL,
        total REAL NOT NULL,
        date TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE
      );

      -- Copy old data to new table with default portfolio_id
      INSERT INTO transactions_new (id, portfolio_id, ticker, type, quantity, price, total, date, created_at)
      SELECT id, ${portfolio.id}, ticker, type, quantity, price, total, date, created_at
      FROM transactions;

      -- Drop old table and rename new one
      DROP TABLE transactions;
      ALTER TABLE transactions_new RENAME TO transactions;
    `);

    console.log(`Migration complete. ${hasData.count} transactions moved to 'Default' portfolio.`);
  } else {
    // No data exists, just drop and recreate
    console.log('No existing data. Recreating transactions table...');
    db.exec(`DROP TABLE IF EXISTS transactions`);
    db.exec(`
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portfolio_id INTEGER NOT NULL,
        ticker TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('BUY', 'SELL', 'DIVIDEND', 'DIVIDEND_REINVEST')),
        quantity REAL NOT NULL,
        price REAL NOT NULL,
        total REAL NOT NULL,
        date TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE
      )
    `);
  }
}

// Add display_order column if it doesn't exist
const displayOrderExists = db.prepare(`
  SELECT COUNT(*) as count FROM pragma_table_info('portfolios')
  WHERE name = 'display_order'
`).get();

if (displayOrderExists.count === 0) {
  console.log('Adding display_order column to portfolios...');
  db.exec(`ALTER TABLE portfolios ADD COLUMN display_order INTEGER DEFAULT 0`);
}

// Create stock_info table for market prices and dividend data
db.exec(`
  CREATE TABLE IF NOT EXISTS stock_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portfolio_id INTEGER NOT NULL,
    ticker TEXT NOT NULL,
    market_price REAL DEFAULT 0,
    dividend_frequency TEXT,
    dividend_per_share REAL DEFAULT 0,
    last_dividend_date TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(portfolio_id, ticker),
    FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE
  )
`);

console.log('Database initialized at:', dbPath);

module.exports = db;
