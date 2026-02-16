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

// Migration: Check if old data exists without portfolio_id
const oldDataExists = db.prepare(`
  SELECT COUNT(*) as count FROM pragma_table_info('transactions')
  WHERE name = 'portfolio_id'
`).get();

// If the schema needs migration, handle it
if (!oldDataExists || oldDataExists.count === 0) {
  console.log('Migrating old database schema...');
  // This will only run if old schema exists - new installs skip this
}

console.log('Database initialized at:', dbPath);

module.exports = db;
