const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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
    `);
    // Use a parameterized statement for the data migration to avoid string interpolation
    db.prepare(`
      INSERT INTO transactions_new (id, portfolio_id, ticker, type, quantity, price, total, date, created_at)
      SELECT id, ?, ticker, type, quantity, price, total, date, created_at FROM transactions
    `).run(portfolio.id);
    db.exec(`
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

// Migration: Add commission column to transactions
const commissionExists = db.prepare(`
  SELECT COUNT(*) as count FROM pragma_table_info('transactions')
  WHERE name = 'commission'
`).get();
if (commissionExists.count === 0) {
  console.log('Adding commission column to transactions...');
  db.exec(`ALTER TABLE transactions ADD COLUMN commission REAL DEFAULT 0`);
}

// Migration: Add sector and investment_type columns to stock_info
const sectorExists = db.prepare(`
  SELECT COUNT(*) as count FROM pragma_table_info('stock_info')
  WHERE name = 'sector'
`).get();
if (sectorExists.count === 0) {
  console.log('Adding sector column to stock_info...');
  db.exec(`ALTER TABLE stock_info ADD COLUMN sector TEXT`);
}

const investmentTypeExists = db.prepare(`
  SELECT COUNT(*) as count FROM pragma_table_info('stock_info')
  WHERE name = 'investment_type'
`).get();
if (investmentTypeExists.count === 0) {
  console.log('Adding investment_type column to stock_info...');
  db.exec(`ALTER TABLE stock_info ADD COLUMN investment_type TEXT`);
}

// Migration: Add dividend_yield column to stock_info
const divYieldColExists = db.prepare(`
  SELECT COUNT(*) as count FROM pragma_table_info('stock_info')
  WHERE name = 'dividend_yield'
`).get();
if (divYieldColExists.count === 0) {
  console.log('Adding dividend_yield column to stock_info...');
  db.exec(`ALTER TABLE stock_info ADD COLUMN dividend_yield REAL`);
}

// Migration: Add cash_balance column to portfolios
const cashBalColExists = db.prepare(`
  SELECT COUNT(*) as count FROM pragma_table_info('portfolios')
  WHERE name = 'cash_balance'
`).get();
if (cashBalColExists.count === 0) {
  db.exec(`ALTER TABLE portfolios ADD COLUMN cash_balance REAL`);
}

// Migration: Add CONTRIBUTION and WITHDRAWAL transaction types
const txTypeSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='transactions'`).get();
if (txTypeSql && !txTypeSql.sql.includes('CONTRIBUTION')) {
  console.log('Migrating transactions to add CONTRIBUTION/WITHDRAWAL types...');
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE transactions_new (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id INTEGER NOT NULL,
      ticker       TEXT NOT NULL DEFAULT 'CASH',
      type         TEXT NOT NULL CHECK(type IN ('BUY','SELL','DIVIDEND','DIVIDEND_REINVEST','CONTRIBUTION','WITHDRAWAL')),
      quantity     REAL NOT NULL DEFAULT 0,
      price        REAL NOT NULL DEFAULT 0,
      total        REAL NOT NULL DEFAULT 0,
      commission   REAL DEFAULT 0,
      date         TEXT NOT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE
    );
    INSERT INTO transactions_new (id, portfolio_id, ticker, type, quantity, price, total, commission, date, created_at)
    SELECT id, portfolio_id, ticker, type, quantity, price, total, COALESCE(commission,0), date, created_at
    FROM transactions;
    DROP TABLE transactions;
    ALTER TABLE transactions_new RENAME TO transactions;
  `);
  db.pragma('foreign_keys = ON');
  console.log('Migration complete: CONTRIBUTION/WITHDRAWAL types added.');
}

// Auto-restore portfolios from backup if the DB is fresh (empty portfolios table)
const portfolioBackupPath = path.join(__dirname, 'portfolios.json');
const portfolioCount = db.prepare('SELECT COUNT(*) as count FROM portfolios').get();
if (portfolioCount.count === 0 && fs.existsSync(portfolioBackupPath)) {
  try {
    const saved = JSON.parse(fs.readFileSync(portfolioBackupPath, 'utf8'));
    const insert = db.prepare('INSERT INTO portfolios (name, code, display_order) VALUES (?, ?, ?)');
    const insertAll = db.transaction(rows => {
      for (const p of rows) insert.run(p.name, p.code, p.display_order || 0);
    });
    insertAll(saved);
    console.log(`Restored ${saved.length} portfolios from portfolios.json`);
  } catch (e) {
    console.error('Failed to restore portfolios from backup:', e.message);
  }
}

console.log('Database initialized at:', dbPath);

module.exports = db;
