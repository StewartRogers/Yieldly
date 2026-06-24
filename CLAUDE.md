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

# Backend math test suite (in-memory SQLite, no server needed)
node test.js          # or: npm test

# Same suite with branch/line coverage of lib/compute.js (text + HTML report)
npm run coverage
```

`test.js` is the only test suite: 37 numbered scenarios (~141 assertions) validating `lib/compute.js` against an in-memory SQLite DB via a hand-rolled `check()`/`checkEq()` harness (no Jest/Mocha). It is a flat script with no filtering, so there is **no single-test command** — to isolate a case, temporarily comment out scenarios in the file. Coverage is via `c8` (V8 coverage, no source changes); `lib/compute.js` is at 100% statements/branches/lines and the HTML report lands in `coverage/`. Playwright is installed under `client/` but no E2E tests or config exist yet.

## Ports

- Client (Vite): `http://localhost:2080`
- Server (Express API): `http://localhost:2085`

Vite proxies `/api/*` to the Express server, so the client always calls `/api/...` paths — never the full server URL directly.

## Architecture

This is a local single-user portfolio tracker with no authentication.

**Server (`server.js`, Node/Express, CommonJS)**
- All API routes live in `server.js`. No router files — everything is registered directly on `app`.
- Database access via `better-sqlite3` (synchronous). All queries use parameterized statements.
- `database.js` initializes the DB and runs all schema migrations on startup. Migrations use `pragma_table_info` guards so they're safe to re-run.
- `lib/compute.js` — pure function `computeHoldings(rows)` that derives return, ACB, yield, and payout from raw DB rows. No DB dependency; used by the `/summary` and `/overview` endpoints.
- `lib/parse.js` — `parseCSVLine` and `parseDate` utilities used by the CSV import route.
- Market prices are fetched from TMX (Toronto Stock Exchange GraphQL API) via `fetchTMXQuote`. Tickers are validated with `/^[A-Z0-9.]{1,12}$/` before interpolation.
- `portfolios.json` is a startup backup of the portfolios table, written on server start and auto-restored if the DB is empty.

**Database schema (SQLite at `yieldly.db`)**
- `portfolios` — id, name, code (unique), display_order, cash_balance
- `transactions` — portfolio_id, ticker, type (`BUY|SELL|DIVIDEND|DIVIDEND_REINVEST|CONTRIBUTION|WITHDRAWAL`), quantity, price, total, commission, date
- `stock_info` — portfolio_id + ticker (unique pair), market_price, dividend_frequency, dividend_per_share, dividend_yield, last_dividend_date, sector, investment_type

**Client (`client/`, React + Vite, ES modules)**
- All API calls go through `client/src/api/client.js` — a thin `fetch` wrapper with a shared `request()` helper. Never add raw `fetch('/api/...')` calls in components; import from this module instead.
- Pages: `Home`, `Summary`, `Portfolios`, `Transactions`, `Dividends`, `Import`
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

Run `node test.js` after touching `lib/compute.js` or the `HOLDINGS_SQL` aggregation in `server.js`.

## Project skills

Invoke these on demand (`/<name>`); they are not automatic:
- `/finance-auditor` — audits the math and reconciles portfolio totals against the live DB.
- `/test-engineer` — creates/updates tests following the `test.js` conventions.
- `/ui-design` — see below.

## UI Work

Always use the `ui-design` skill for UI changes. Use wireframes in `/design` as the source of truth for layout and information architecture.
