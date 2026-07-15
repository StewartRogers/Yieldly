# Yieldly

Yieldly is a local stock portfolio tracker for managing multiple portfolios, transaction history, dividend income, and basic market data stored in a SQLite database.

## What It Does

- Manage multiple portfolios with unique codes and configurable display order
- Track buys, sells, dividends, dividend reinvestments, contributions, and withdrawals
- View holdings, average cost, sale totals, dividends paid, and estimated market value
- Store manual stock details such as market price, dividend yield, sector, and investment type
- Refresh stock prices and dividend data from TMX (Canadian) and Yahoo Finance (US) for supported tickers
- Export and re-import a full account backup (portfolios, transactions, and stock info)
- Import historical transactions from CSV
- Keep data locally in SQLite with automatic persistence across restarts

## Tech Stack

- Backend: Node.js + Express
- Database: libSQL via `@libsql/client` — a local `file:` SQLite database in development, or hosted [Turso](https://turso.tech) in production
- Auth: stateless JWT in an httpOnly cookie
- Frontend: React + Vite app in `client/`

## Requirements

- Node.js 18 or newer
- npm

## Setup

1. Install dependencies from the repository root:
```bash
npm install
```

2. Create your superuser account:
```bash
npm run user:create
```
This will prompt you for a username and password (minimum 8 characters).

3. Start the app in development mode:
```bash
npm run dev
```

4. Open `http://localhost:2080` and sign in.

Alternatively, if you skip step 2, the first time you open the app in a browser you'll be presented with a setup screen to create your account.

### Resetting Your Password

If you forget your password, reset it from the command line:
```bash
npm run user:reset-password
```
(Auth is stateless JWT, so this changes the password but does not retroactively revoke tokens already issued to other devices — they expire on their own.)

## Production Build

1. Build the client app:
```bash
npm run build
```

2. Start the server in production mode:
```bash
npm run start:prod
```

## Environment Variables

The app loads `.env` automatically. Copy `.env.example` to `.env` to get started.

- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` - hosted Turso database. **Omit both for local dev** — the app falls back to a local `file:yieldly.db`.
- `SESSION_SECRET` - secret key used to sign JWT auth tokens (required in production — `server.js` / the Vercel function refuse to start without it). Generate with `openssl rand -hex 32`.
- `NODE_ENV=production` - serves the built client from `client/dist` (local production mode)
- `TRUST_PROXY=1` - set when running behind a reverse proxy with HTTPS (trusts `X-Forwarded-*` headers from the proxy). The auth cookie's `Secure` flag is on by default whenever `NODE_ENV=production`, independent of this setting.
- `DEBUG_IMPORT=1` - log per-row detail during CSV import
- `CRON_SECRET` - bearer token required on `GET /api/cron/snapshot-values` (the daily portfolio value snapshot). Vercel sends it automatically as `Authorization: Bearer <value>` when a cron job triggers the route. Unset = route disabled. Generate with `openssl rand -hex 32`.

## Deploying to Vercel + Turso

The same codebase runs on a local SQLite file in dev and on Turso when hosted — switched purely by environment.

1. **Create a Turso database** ([turso.tech](https://turso.tech)) and grab its URL + auth token:
   ```bash
   turso db create yieldly
   turso db show yieldly --url
   turso db tokens create yieldly
   ```
2. **Set Vercel environment variables** (Project → Settings → Environment Variables): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `SESSION_SECRET`, and `CRON_SECRET` (for the daily portfolio value snapshot — `vercel.json` registers the cron job automatically on deploy, but it 401s until this is set).
3. **Apply the schema** once to the new database:
   ```bash
   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run db:migrate
   ```
4. **Create the superuser** against Turso (or use the in-app setup screen on first load):
   ```bash
   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run user:create
   ```
5. **Deploy**: `vercel --prod` (or connect the repo). `vercel.json` builds the client to `client/dist`, routes `/api/*` to the serverless function in `api/index.js`, serves the SPA, and registers the daily snapshot cron job (`GET /api/cron/snapshot-values`, `0 5 * * *` UTC = midnight EST / 1am EDT). On the Hobby plan, Cron Jobs run at most once a day and may fire up to an hour late.

To migrate existing local data into Turso, dump `yieldly.db` and import it with the Turso CLI (`turso db shell yieldly < dump.sql`).

## Supported Transaction Types

- `BUY`
- `SELL`
- `DIVIDEND`
- `DIVIDEND_REINVEST`
- `CONTRIBUTION`
- `WITHDRAWAL`
- `TRANSFER_IN` / `TRANSFER_OUT` - the two linked legs of a cash transfer between portfolios (see `POST /api/transfers`); not creatable via `POST /api/transactions`

Cash-flow transactions use `CASH` as the ticker internally. `CONTRIBUTION`, `WITHDRAWAL`, and transfers automatically adjust the portfolio's `cash_balance` (starting from 0 if it was previously unset).

## CSV Import

The CSV importer expects a header row and at least these columns:

`Date,Symbol,Portfolio,Type,Quantity,Share Price,Total`

Example:

```csv
Date,Symbol,Portfolio,Type,Quantity,Share Price,Total
01-Jan-24,AAPL,RR,B,10,150.00,1500.00
15-Feb-24,AAPL,RR,D,0,0,25.50
```

Supported type codes for imports depend on the app UI and database mapping. The app currently recognizes the transaction types listed above.

## API Endpoints

All API routes except `/api/auth/*` and `/api/cron/*` require authentication (return 401 without a valid auth cookie). `/api/cron/*` instead requires a `CRON_SECRET` bearer token (see Environment Variables).

### Authentication

- `GET /api/auth/session` - Check authentication status
- `POST /api/auth/setup` - Create the superuser (only works when no user exists)
- `POST /api/auth/login` - Sign in
- `POST /api/auth/logout` - Sign out
- `POST /api/change-password` - Change password (requires authentication and current password)

### Portfolios

- `GET /api/portfolios` - List all portfolios
- `POST /api/portfolios` - Create a portfolio
- `PUT /api/portfolios/:id` - Rename a portfolio (update name/code)
- `PUT /api/portfolios/:id/order` - Update portfolio display order
- `PUT /api/portfolios/:id/cash-balance` - Set or clear a manual cash balance
- `DELETE /api/portfolios/:id` - Delete a portfolio
- `GET /api/portfolios/:id/summary` - Get aggregated holdings for one portfolio
- `GET /api/portfolios/:id/transactions` - Get all transactions for one portfolio
- `GET /api/portfolios/:id/transactions/ticker/:ticker` - Get transactions for one ticker
- `PUT /api/portfolios/:portfolioId/stocks/:ticker` - Update manual stock info
- `POST /api/portfolios/:portfolioId/refresh-prices` - Refresh quote data (TMX + Yahoo Finance) for one portfolio

### Transactions

- `POST /api/transactions` - Add a transaction (`CONTRIBUTION`/`WITHDRAWAL` also adjust `cash_balance`; `TRANSFER_IN`/`TRANSFER_OUT` are rejected here - use `POST /api/transfers`)
- `DELETE /api/transactions/:id` - Delete a transaction, reversing any `cash_balance` change; deleting either leg of a transfer deletes both
- `POST /api/transfers` - Move cash between two of the user's own portfolios (`from_portfolio_id`, `to_portfolio_id`, `amount`, `date`); records a linked `TRANSFER_OUT`/`TRANSFER_IN` pair and adjusts both portfolios' `cash_balance`

### Summary and Income

- `GET /api/summary` - Combined holdings across all portfolios
- `GET /api/overview` - Portfolio overview with cash and market value fields
- `GET /api/summary/monthly-acb` - Monthly average cost basis trend
- `GET /api/dividends/monthly` - Monthly dividend totals by portfolio
- `GET /api/cashflow/monthly` - Monthly net external + transfer cash flow by portfolio (`CONTRIBUTION`/`TRANSFER_IN` add, `WITHDRAWAL`/`TRANSFER_OUT` subtract)
- `GET /api/summary/value-snapshots` - Daily portfolio value snapshots (all portfolios)
- `PUT /api/portfolios/:portfolioId/value-snapshots/:date` - Set/backfill a portfolio's total value for one date (`date` is `YYYY-MM-DD`)
- `DELETE /api/portfolios/:portfolioId/value-snapshots/:date` - Delete a snapshot

### Import / Export (full backup)

- `POST /api/import/csv` - Import transactions from CSV
- `GET /api/export` - Export a full account backup (portfolios, transactions, stock info) as JSON
- `GET /api/export/counts` - Row counts for the current account (preview before export/import)
- `POST /api/import` - Restore a full account backup, replacing all existing data

### Refresh

- `POST /api/refresh-all-prices` - Refresh quote data (TMX + Yahoo Finance) for every holding across all portfolios

### Cron (requires `CRON_SECRET`, not the auth cookie)

- `GET /api/cron/snapshot-values` - Refresh all prices, then record a `portfolio_value_snapshots` row for every portfolio for today (America/New_York calendar date). Triggered daily by `vercel.json`'s cron config; safe to call more than once per day (idempotent upsert).

## Project Structure

```text
yieldly/
├── client/              # React frontend used in production builds
├── public/              # Static development UI
├── api/index.js         # Vercel serverless entrypoint (Express → Turso)
├── lib/                 # Shared server-side helpers
│   ├── compute.js           # Holdings computation (ACB, return, yield)
│   ├── holdings.js          # Shared holdings aggregation SQL
│   ├── parse.js             # CSV parsing utilities
│   ├── auth.js              # Stateless JWT auth helpers
│   └── portfolios-backup.js # Local-file portfolio backup/restore
├── app.js                   # createApp(db, options) — all Express routes
├── database.js              # createDb()/runMigrations() — libSQL (local file / Turso)
├── server.js                # Local server entrypoint
├── scripts/migrate.js       # Apply schema to the configured database
├── manage-user.js           # CLI tool for user account management
├── vercel.json              # Vercel build + routing config
├── yieldly.db               # Local libSQL database (git-ignored)
├── portfolios.json          # Auto-generated portfolio backup (git-ignored)
└── portfolios.example.json  # Example seed file — copy to portfolios.json to pre-seed
```

## Notes

- The database is created automatically on first run.
- Portfolio metadata is backed up to `portfolios.json` (git-ignored) on every write so it can be restored if the database is recreated. Copy `portfolios.example.json` to `portfolios.json` to pre-seed portfolios on a fresh install.
- The app supports a single superuser with stateless JWT authentication. All API routes (except `/api/auth/*`) require a valid auth cookie.

## License

MIT
