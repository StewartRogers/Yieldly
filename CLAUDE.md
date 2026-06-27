# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Full dev environment (server + client with hot reload)
npm run dev

# Server only
npm start

# Client only (from repo root)
npm run dev --prefix client

# Lint client
npm run lint --prefix client

# Production build of client
npm run build

# Production server (serves built client as static files)
npm run start:prod

# Full backend test suite (all three suites, in-memory SQLite, no live server)
npm test

# Individual suites
npm run test:math     # test.js      — computeHoldings math
npm run test:full     # test-full.js — broad math/CSV/monthly-ACB/validation coverage
npm run test:auth     # test-auth.js — auth routes + guard against the real app

# Branch/line coverage of lib/compute.js (text + HTML report)
npm run coverage

# Apply schema to the configured database (local file, or Turso if env is set)
npm run db:migrate

# User management (interactive prompts)
npm run user:create           # Create the superuser account
npm run user:reset-password   # Reset the superuser password
```

There are three flat-script test suites (no Jest/Mocha), all using a hand-rolled `check()`/`checkEq()` harness:
- `test.js` (~141 assertions) — `computeHoldings` math.
- `test-full.js` (~220 assertions) — broader math, CSV import, `computeMonthlyACB`, and validation rules.
- `test-auth.js` (~90 assertions) — boots the **real async app** (`createApp(await createDb(...))`) over an ephemeral HTTP port to exercise the auth routes, the auth guard, JWT cookies, cascade delete, login rate-limiting, and the full backup export/import.

`test.js`/`test-full.js` validate the **driver-agnostic** money math, so they run synchronously on `better-sqlite3` (a devDependency) for a tight, await-free harness, importing the shared `HOLDINGS_SQL`/`GROUP_ORDER` from `lib/holdings.js` so the aggregation can't drift. `test-auth.js` exercises the **real** async libSQL schema + app (backed by a temp-file libSQL DB — `:memory:` is per-connection in libSQL and would not be shared across an interactive transaction). They are flat scripts with no filtering, so there is **no single-test command** — to isolate a case, temporarily comment out scenarios. Coverage (`npm run coverage`) is via `c8` over `test.js`; `lib/compute.js` is at 100% statements/branches/lines, HTML report in `coverage/`. Playwright is installed under `client/` but no E2E tests exist yet.

## Ports

- Client (Vite): `http://localhost:2080`
- Server (Express API): `http://localhost:2085`

Vite proxies `/api/*` to the Express server, so the client always calls `/api/...` paths — never the full server URL directly.

## Architecture

This is a single-user portfolio tracker with stateless JWT authentication (one superuser).

**Persistence — libSQL, environment-switched**
- Data access is **async** (libSQL via `@libsql/client`). `database.js` `createDb(url?)` resolves the connection by env via `tursoUrl()`/`tursoAuthToken()`: `TURSO_DATABASE_URL` (+ `TURSO_AUTH_TOKEN`) **or** the Vercel Turso integration's `yieldly_storage_`-prefixed equivalents → remote **Turso** (hosted/Vercel); otherwise a local `file:yieldly.db`; pass an explicit url (e.g. a temp file) in tests. A token is only attached to remote URLs, never a local `file:`/`:memory:` DB. It returns a thin async wrapper exposing better-sqlite3-style `get/all/run/exec/transaction` so route code stays readable.
- `runMigrations(db)` is idempotent and safe to run on every cold start. It has two layers: `CREATE TABLE IF NOT EXISTS` defines the final shape, then guarded incremental migrations (`addColumnIfMissing` for ~7 columns + a `transactions` table rebuild to widen the `type` CHECK constraint) upgrade a pre-existing DB created before those existed.

**Server (Node/Express, CommonJS) — factored for testability**
- `server.js` — thin local entrypoint: `await createDb()`, restore/back up `portfolios.json`, enforce `SESSION_SECRET`, `app.listen`. No routes.
- `api/index.js` — **Vercel serverless entrypoint**: builds the app once per warm instance against Turso, `secureCookies`/`trustProxy` on. Requires `SESSION_SECRET` + `TURSO_DATABASE_URL`.
- `app.js` exports `createApp(db, options)` — registers **all** routes against the injected async `db`. No module-load side effects. Options: `sessionSecret`, `secureCookies`, `trustProxy`, `backupPortfolios`, `serveClient`, `rateLimit`, `verbose`. Also exports pure `computeMonthlyACB(rows, now?)` and the market-data fetchers.
- `lib/auth.js` — **stateless JWT** auth: `signToken`/`verifyToken` + httpOnly `token` cookie. No sessions table; verification is a signature check (no per-request DB hit — important on serverless). Trade-off: logout clears the cookie and tokens expire; there's no server-side revocation list.
- `lib/holdings.js` — `HOLDINGS_SQL` + `GROUP_ORDER` + async `prepareHoldings(db)`: single source of truth for the holdings aggregation, shared by `app.js` and the (sync) math test suites.
- `lib/compute.js` — pure `computeHoldings(rows)`; no DB dependency; used by `/summary` and `/overview`.
- `lib/parse.js` — `parseCSVLine` / `parseDate` for the CSV import route.
- `lib/portfolios-backup.js` — async `makePortfoliosBackup` / `restorePortfoliosIfEmpty`. `portfolios.json` is a **local-file-only** convenience (portfolio names/codes/order, not the ledger); a no-op on Vercel (ephemeral FS) where Turso's own backups are the source of truth.
- Market prices: TMX (TSX GraphQL) via `fetchTMXQuote`, Yahoo Finance for US tickers. Tickers validated with `/^[A-Z0-9.]{1,12}$/`.
- **Security**: `helmet` (CSP deferred to the platform), `express-rate-limit` on `/api/auth/login` + `/api/auth/setup`, write-route validation (transaction-type whitelist + finite, non-negative number checks), portfolio delete cascades explicitly (not relying on the FK pragma), and `SESSION_SECRET` (the JWT secret) is required in production — `server.js`/`api/index.js` refuse to start without it.

**Database schema (libSQL: local `file:yieldly.db` or Turso)**
- `portfolios` — id, name, code (unique), display_order, cash_balance
- `transactions` — portfolio_id, ticker, type (`BUY|SELL|DIVIDEND|DIVIDEND_REINVEST|CONTRIBUTION|WITHDRAWAL`), quantity, price, total, commission, date, market
- `stock_info` — portfolio_id + ticker (unique pair), market_price, dividend_frequency, dividend_per_share, dividend_yield, last_dividend_date, sector, investment_type
- `users` — id, username (unique), password_hash (bcrypt)
- (No `sessions` table — auth is stateless JWT.)

**Deployment (Vercel + Turso)**
- `vercel.json` builds the client (`client/dist`), routes `/api/*` to `api/index.js`, and falls back to `index.html` for SPA routes.
- Provision a Turso DB, set `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` / `SESSION_SECRET` in Vercel env, run `npm run db:migrate` once, then create the superuser. See README for the full sequence.

**Client (`client/`, React + Vite, ES modules)**
- All API calls go through `client/src/api/client.js` — a thin `fetch` wrapper with a shared `request()` helper. Never add raw `fetch('/api/...')` calls in components; import from this module instead.
- Auth state managed in `App.jsx` — if not authenticated, renders `Login` page instead of the app. `api/client.js` fires an `onUnauthorized` callback on 401 responses to force re-login.
- Pages: `Home`, `Summary`, `Portfolios`, `Transactions`, `Dividends`, `Import`, `Login`
- Global state in `App.jsx`: `portfolios` list and `pricesTick` counter. Pages receive these as props. When `pricesTick` increments (after a price refresh), price-sensitive pages re-fetch via `useEffect([pricesTick])`.
- Styling uses Tailwind v4 + a custom design system with CSS custom properties (`--ink`, `--inset`, `--line-2`, etc.). Shadcn/ui components live in `client/src/components/ui/`.
- `client/src/utils/format.js` — shared currency/percentage formatters used across all pages.

## Financial correctness

The money math is the heart of this app, and several rules are non-obvious and easy to break:
- **ACB** includes buy commissions; `buy_price` (avg share price) excludes them. After a partial sell, ACB is prorated: `(buyTotal + buyExpense) × (shares / sharesBought)`.
- **Return %** uses ACB as the denominator, not all-time buy cost.
- **Dividends have two mutually exclusive paths** in `computeHoldings`: yield-first (when `stock_info.dividend_yield > 0` and market value > 0) vs per-share fallback. Don't blend them.
- `DIVIDEND` (cash) accumulates `dividends_paid`; `DIVIDEND_REINVEST` instead adds shares and buy cost. `cash_balance` is a **manual** field — cash-flow transactions do not update it.
- The holdings query filters `HAVING shares > 0`, so fully-sold positions never appear in `/summary` or `/overview`.

Run `npm test` after touching `lib/compute.js` or the `HOLDINGS_SQL` aggregation in `lib/holdings.js`.

## Project skills

Invoke these on demand (`/<name>`); they are not automatic:
- `/finance-auditor` — audits the math and reconciles portfolio totals against the live DB.
- `/test-engineer` — creates/updates tests following the `test.js`/`test-full.js`/`test-auth.js` conventions.
- `/ui-design` — see below.

## UI Work

Always use the `ui-design` skill for UI changes. Use wireframes in `/design` as the source of truth for layout and information architecture.
