'use strict';

const path = require('path');
const { createClient } = require('@libsql/client');

const DEFAULT_DB_FILE = path.join(__dirname, 'yieldly.db');

/**
 * Thin async wrapper over a libSQL client that preserves the better-sqlite3
 * call ergonomics the route code was written against:
 *   db.get(sql, ...args)  → first row (or undefined)
 *   db.all(sql, ...args)  → array of rows
 *   db.run(sql, ...args)  → { changes, lastInsertRowid }
 *   db.exec(sqlScript)    → run a multi-statement script (no args/results)
 *   db.transaction(mode)  → libSQL interactive transaction
 *
 * Everything is async because a remote (Turso) database cannot be queried
 * synchronously. Locally the same wrapper drives a `file:` libSQL database.
 */
function wrap(client) {
  return {
    _client: client,
    async get(sql, ...args) {
      const r = await client.execute({ sql, args });
      return r.rows[0];
    },
    async all(sql, ...args) {
      const r = await client.execute({ sql, args });
      return r.rows;
    },
    async run(sql, ...args) {
      const r = await client.execute({ sql, args });
      return {
        changes: r.rowsAffected,
        lastInsertRowid: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid),
      };
    },
    async exec(sqlScript) {
      await client.executeMultiple(sqlScript);
    },
    transaction(mode = 'write') {
      return client.transaction(mode);
    },
    async close() {
      await client.close();
    },
  };
}

/** True if `column` already exists on `table`. */
async function columnExists(db, table, column) {
  // table/column are trusted internal literals, never user input.
  const rows = await db.all(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

/** Idempotent `ALTER TABLE ... ADD COLUMN` for upgrading older databases. */
async function addColumnIfMissing(db, table, column, definition) {
  if (!(await columnExists(db, table, column))) {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Create and upgrade the schema. Safe to call on every connection / cold start.
 *
 * Two layers:
 *  1. `CREATE TABLE IF NOT EXISTS` defines the final table shape — a fresh
 *     local/Turso DB is fully provisioned in one round-trip.
 *  2. Guarded incremental migrations bring a *pre-existing* DB (created before
 *     a column or the widened CHECK constraint existed) up to that same shape.
 *     Without these, an older `yieldly.db` — or an older dump imported into
 *     Turso — would be missing columns the routes read/write (`cash_balance`,
 *     `commission`, `market`, `dividend_yield`, …) and fail with `no such
 *     column` / CHECK errors.
 *
 * No `sessions` table: authentication is now stateless JWT (see lib/auth.js).
 */
async function runMigrations(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS portfolios (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      code          TEXT NOT NULL UNIQUE,
      display_order INTEGER DEFAULT 0,
      cash_balance  REAL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id INTEGER NOT NULL,
      ticker       TEXT NOT NULL DEFAULT 'CASH',
      type         TEXT NOT NULL CHECK(type IN ('BUY','SELL','DIVIDEND','DIVIDEND_REINVEST','CONTRIBUTION','WITHDRAWAL')),
      quantity     REAL NOT NULL DEFAULT 0,
      price        REAL NOT NULL DEFAULT 0,
      total        REAL NOT NULL DEFAULT 0,
      commission   REAL DEFAULT 0,
      date         TEXT NOT NULL,
      market       TEXT DEFAULT 'TMX',
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stock_info (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id       INTEGER NOT NULL,
      ticker             TEXT NOT NULL,
      market_price       REAL DEFAULT 0,
      dividend_frequency TEXT,
      dividend_per_share REAL DEFAULT 0,
      dividend_yield     REAL,
      last_dividend_date TEXT,
      sector             TEXT,
      investment_type    TEXT,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(portfolio_id, ticker),
      FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // --- Incremental column adds for databases created before these existed ---
  await addColumnIfMissing(db, 'portfolios', 'display_order', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(db, 'portfolios', 'cash_balance', 'REAL');
  await addColumnIfMissing(db, 'transactions', 'commission', 'REAL DEFAULT 0');
  await addColumnIfMissing(db, 'transactions', 'market', "TEXT DEFAULT 'TMX'");
  await addColumnIfMissing(db, 'stock_info', 'sector', 'TEXT');
  await addColumnIfMissing(db, 'stock_info', 'investment_type', 'TEXT');
  await addColumnIfMissing(db, 'stock_info', 'dividend_yield', 'REAL');

  // --- Widen the transactions.type CHECK constraint (CONTRIBUTION/WITHDRAWAL) ---
  // Old DBs were created with a 4-type CHECK; a constraint can't be altered in
  // place, so rebuild the table (now that all columns above exist) when the
  // stored DDL predates the cash-flow types.
  const txDef = await db.get(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='transactions'`
  );
  if (txDef && txDef.sql && !String(txDef.sql).includes('CONTRIBUTION')) {
    await db.exec(`
      PRAGMA foreign_keys=OFF;
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
        market       TEXT DEFAULT 'TMX',
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE
      );
      INSERT INTO transactions_new (id, portfolio_id, ticker, type, quantity, price, total, commission, date, market, created_at)
      SELECT id, portfolio_id, ticker, type, quantity, price, total, COALESCE(commission,0), date, COALESCE(market,'TMX'), created_at
      FROM transactions;
      DROP TABLE transactions;
      ALTER TABLE transactions_new RENAME TO transactions;
      PRAGMA foreign_keys=ON;
    `);
  }

  // --- Indexes (last: a table rebuild above drops the table's old indexes) ---
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_transactions_portfolio ON transactions(portfolio_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_ticker ON transactions(portfolio_id, ticker);
  `);
}

// Vercel's Turso storage integration provisions its env vars under the store
// name as a prefix (`yieldly_storage_TURSO_DATABASE_URL`, …). Accept either the
// plain names (manual setup, local `.env`) or the integration-prefixed ones, so
// the app works no matter how the Turso connection was wired up.
function tursoUrl() {
  return process.env.TURSO_DATABASE_URL || process.env.yieldly_storage_TURSO_DATABASE_URL || '';
}
function tursoAuthToken() {
  return process.env.TURSO_AUTH_TOKEN || process.env.yieldly_storage_TURSO_AUTH_TOKEN || '';
}

/**
 * Open a database connection, switched purely by environment:
 *   - Turso URL set (TURSO_DATABASE_URL or the yieldly_storage_-prefixed var
 *     from the Vercel integration) → remote Turso, with its matching auth token
 *   - otherwise               → local `file:` libSQL database (dev)
 *   - pass ':memory:' explicitly → ephemeral in-memory DB (tests)
 *
 * Returns the async wrapper. Migrations run by default (idempotent); pass
 * { migrate: false } to skip (e.g. when migrations are applied at deploy time).
 */
async function createDb(url, { migrate = true } = {}) {
  const resolvedUrl = url || tursoUrl() || `file:${DEFAULT_DB_FILE}`;
  const authToken = tursoAuthToken();
  const client = createClient(authToken ? { url: resolvedUrl, authToken } : { url: resolvedUrl });
  const db = wrap(client);
  if (migrate) await runMigrations(db);
  return db;
}

module.exports = { createDb, runMigrations, wrap, DEFAULT_DB_FILE, tursoUrl, tursoAuthToken };
