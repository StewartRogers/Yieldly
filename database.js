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

/**
 * Create the schema. Idempotent (`IF NOT EXISTS`) and a single round-trip, so
 * it is safe to call on every connection / cold start. Reflects the final
 * shape of the tables (no incremental ALTER history — that lived in the old
 * better-sqlite3 build and is no longer needed for a fresh libSQL/Turso DB).
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

    CREATE INDEX IF NOT EXISTS idx_transactions_portfolio ON transactions(portfolio_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_ticker ON transactions(portfolio_id, ticker);
  `);
}

/**
 * Open a database connection, switched purely by environment:
 *   - TURSO_DATABASE_URL set  → remote Turso (Vercel/hosted), with TURSO_AUTH_TOKEN
 *   - otherwise               → local `file:` libSQL database (dev)
 *   - pass ':memory:' explicitly → ephemeral in-memory DB (tests)
 *
 * Returns the async wrapper. Migrations run by default (idempotent); pass
 * { migrate: false } to skip (e.g. when migrations are applied at deploy time).
 */
async function createDb(url, { migrate = true } = {}) {
  const resolvedUrl = url || process.env.TURSO_DATABASE_URL || `file:${DEFAULT_DB_FILE}`;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  const client = createClient(authToken ? { url: resolvedUrl, authToken } : { url: resolvedUrl });
  const db = wrap(client);
  if (migrate) await runMigrations(db);
  return db;
}

module.exports = { createDb, runMigrations, wrap, DEFAULT_DB_FILE };
