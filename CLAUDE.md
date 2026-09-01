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

# Full backend test suite (all four suites, in-memory SQLite, no live server)
npm test

# Individual suites
npm run test:math     # test.js      — computeHoldings math
npm run test:full     # test-full.js — broad math/CSV/monthly-ACB/validation coverage
npm run test:auth     # test-auth.js — auth routes + guard against the real app

# Browser suite — every spec on Chromium, Firefox AND WebKit (Safari's engine).
# Boots its own server + throwaway libSQL file; needs ports 2080/2085 free.
npm run test:browser
npm run test:browser:install   # one-time: download the three browser engines

# Branch/line coverage of lib/compute.js (text + HTML report)
npm run coverage

# Apply schema to the configured database (local file, or Turso if env is set)
npm run db:migrate

# User management (interactive prompts)
npm run user:create           # Create the superuser account
npm run user:reset-password   # Reset the superuser password
```

There are three flat-script test suites (no Jest/Mocha), all using a hand-rolled `check()`/`checkEq()` harness:
- `test.js` (~150 assertions) — `computeHoldings` math.
- `test-full.js` (~268 assertions) — broader math, CSV import, `computeMonthlyACB`, and validation rules.
- `test-auth.js` (~90 assertions) — boots the **real async app** (`createApp(await createDb(...))`) over an ephemeral HTTP port to exercise the auth routes, the auth guard, JWT cookies, cascade delete, login rate-limiting, and the full backup export/import.

### Browser suite (`client/tests/`, Playwright)

Runs under three projects — `chromium`, `firefox`, `webkit` — so every spec is
checked on all three rendering engines. **WebKit is the stand-in for Safari**
and is the only way to catch Safari-specific breakage without a Mac.

- `responsive.spec.js` — asserts no page scrolls horizontally at 390/768/1440 px.
  Wide content is fine, but it must scroll inside its own container.
- `cross-browser.spec.js` — console/page errors, table scroll containment,
  sticky table headers, mobile nav behaviour, form-control sizing.
- `accessibility.spec.js` — every visible control has an accessible name, and
  clicking a field's label focuses it.
- `transactions-ticker-filter.spec.js` — the ticker filter.
- `auth.setup.js` — a `setup` project that logs in **once** and saves the JWT
  cookie for the others via `storageState`. This is not an optimisation: the
  app rate-limits `/api/auth/login` to 10 attempts per 15 min, and signing in
  per-spec across three engines tripped it and failed everything after the
  tenth. `workers: 1` for the same reason — all specs share one server and one
  libSQL file, so parallel projects raced through the first-run setup flow.

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
- `app.js` exports `createApp(db, options)` — registers **all** routes against the injected async `db`. No module-load side effects. Options: `sessionSecret` (**required** — throws if omitted, rather than the old fallback of minting a random one), `secureCookies`, `trustProxy`, `backupPortfolios`, `serveClient`, `rateLimit`, `verbose`, `cronSecret`, `setupToken`. Also exports pure `computeMonthlyACB(rows, now?)` and the market-data fetchers.
- `lib/auth.js` — **stateless JWT** auth: `signToken`/`verifyToken` + httpOnly `token` cookie. No sessions table; verification is a signature check (no per-request DB hit — important on serverless). Trade-off: logout clears the cookie and tokens expire; there's no server-side revocation list.
- `lib/holdings.js` — `HOLDINGS_SQL` + `GROUP_ORDER` + `SHARE_EPSILON` + async `prepareHoldings(db)`: single source of truth for the holdings aggregation, shared by `app.js` and the (sync) math test suites. The `HAVING shares > SHARE_EPSILON` (1e-9, not `> 0`) filter is deliberate — fractional DRIP shares leave float residue when a position is closed, and `> 0` kept those as phantom holdings with absurd return percentages. `prepareHoldings`'s `query()` also runs `ACB_TX_SQL` (the same tickers, ordered `date ASC, id ASC`) and pipes both result sets through `applyRunningACB` before returning, so every caller gets order-aware ACB for free.
- `lib/compute.js` — pure `computeHoldings(rows)`; no DB dependency; used by `/summary` and `/overview`. Also exports `computeRunningACB`/`applyRunningACB` (see Financial correctness below) — `computeHoldings` prefers a row's pre-attached `.acb`/`.acb_per_share` and only falls back to order-blind proration when called directly without them.
- `lib/parse.js` — `parseCSVLine` / `parseDate` for the CSV import route. **`parseDate` returns `null`** when a date can't be understood; callers must treat that as a row-level error. It previously defaulted an unknown month to `01`, so `15-Sept-2024` silently became January.
- `lib/portfolios-backup.js` — async `makePortfoliosBackup` / `restorePortfoliosIfEmpty`. `portfolios.json` is a **local-file-only** convenience (portfolio names/codes/order/cash_balance, not the ledger); a no-op on Vercel (ephemeral FS) where Turso's own backups are the source of truth.
- Market prices: TMX (TSX GraphQL) via `fetchTMXQuote`, Yahoo Finance for US tickers. Tickers validated with `/^[A-Z0-9.-]{1,12}$/` (hyphen allowed for TSX unit-trust tickers like `REI-UN.TO`).
- **Security**: `helmet` (its CSP is disabled in-app because on Vercel Express never serves the HTML — `serveClient: false` — so the real CSP and the other document headers are set by the `headers` block in `vercel.json`: CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`). Plus `express-rate-limit` on `/api/auth/login` + `/api/auth/setup` + `/api/cron/*`, write-route validation (transaction-type whitelist + finite, non-negative number checks, `isValidISODate` on every `date`), portfolio delete cascades explicitly (not relying on the FK pragma), and `SESSION_SECRET` (the JWT secret) is required — `createApp` throws if it's omitted, and `server.js`/`api/index.js` refuse to start without it.
  - The CSP assumes Vite's output shape: hashed external scripts (no inline `<script>`), so `script-src 'self'` is enough; `style-src` needs `'unsafe-inline'` for Tailwind/base-ui injected styles. If you ever add an inline script, the CSP must change with it.
  - `cookieParser()` and the `/api` auth guard are mounted **before** the `express.json()` body parsers (except a small one scoped to `/api/auth` for login/setup's own bodies), so an unauthenticated request to a protected route gets its 401 before its body is ever buffered/parsed.
  - `POST /api/auth/login` equalizes timing on a nonexistent username by always running `bcrypt.compare` (against a fixed dummy hash on a miss), and persists a lockout on the `users` row (`failed_login_attempts`/`locked_until`, 10 attempts / 15 min) so throttling holds across Vercel's per-instance `express-rate-limit` counters.
  - `POST /api/auth/setup` is first-wins by default (anyone who reaches a fresh deployment first becomes the superuser) — set `setupToken` (env `SETUP_TOKEN`) to require a matching token in the request body, checked with `crypto.timingSafeEqual`.

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

**Responsive + cross-browser invariants** (all verified by `npm run test:browser`; breaking one is how the layout silently overflows a phone again):
- **`--page-pad` is the single source of truth for the page gutter.** `.app-page` pads by it and the Home hero bleeds full-width with `calc(var(--page-pad) * -1)`. Never hard-code the bleed — a literal `-24px` against a 16px padding overflowed every viewport from 641–768 px.
- **`min-width: 0` on anything that can hold a wide table or toolbar** (`.tc-card`, `.kpi`, `.hold`, `.row`, `.col`). Grid/flex items default to `min-width: auto`, i.e. "never shrink below my content" — so one wide table pushes the whole page sideways instead of scrolling inside its own `.tbl-wrap`.
- **Grid tracks that hold tables use `minmax(0, 1fr)`, not `1fr`.** A bare `1fr` means `minmax(auto, 1fr)`, and that `auto` floor has the same effect (see `.tx-layout`).
- **No percentage widths on flex items in a wrapping container.** A percentage cannot resolve while the parent's intrinsic width is being measured, so the browser substitutes max-content and that becomes the parent's minimum. Use `flex-basis` (see `.pills.full`) — an inline `width: 100%` here forced a 690 px card onto a 390 px phone.
- **`table.tbl` must keep `border-collapse: separate`.** WebKit ignores `position: sticky` on `<th>`/`<td>` under `border-collapse: collapse`. (Those sticky headers are currently inert in *every* engine — `overflow-x: auto` on `.tbl-wrap` makes it the sticky scrollport, and it has no height limit. Activating them means capping `.tbl-wrap`'s height, which is a layout decision, not a compat fix.)
- Fixed px font sizes on headlines are clamped (`.hero-total`, `.page-title`, `.home-hero-title`) — a seven-figure total at 56 px is wider than a phone.
- **`.tbl-wrap`'s `max-height` is what makes the sticky `<th>` work.** Setting `overflow-x` makes `overflow-y` compute to `auto`, which makes `.tbl-wrap` itself the scrollport for any sticky descendant; without a height cap there is nothing to scroll within it and the header just leaves with the page. Remove the cap and the sticky header silently stops working everywhere.

**Form labels.** `.tc-field` renders `<label>` and its control as siblings, so every label needs an explicit `htmlFor` pointing at the control's `id` — there is no wrapping to fall back on. Base UI's `SelectTrigger` forwards `id` onto a `<button>`, which is a labelable element, so the same pattern works for selects. Controls with no visible label (inline cash edits, the portfolio name/code boxes) carry an `aria-label` instead; a placeholder is not an accessible name. `accessibility.spec.js` fails if any visible control ends up without a name.

## Financial correctness

The money math is the heart of this app, and several rules are non-obvious and easy to break:
- **ACB** includes buy commissions; `buy_price` (avg share price) excludes them. It's computed as a running average over transactions in date order (`computeRunningACB`/`applyRunningACB` in `lib/compute.js`, shared by `lib/holdings.js` and `computeMonthlyACB`): each BUY/`DIVIDEND_REINVEST` adds `total + commission` to the basis, each SELL retires its proportional share (`acb -= acb × (qty / shares)`) at the average cost *as of that sale* — order matters, so a buy→sell→buy sequence doesn't re-average the sold lot's cost back into shares bought later. `computeHoldings` falls back to the older order-blind proration (`(buyTotal + buyExpense) × (shares / sharesBought)`) only when a row has no `.acb` attached (i.e. called directly, without going through `applyRunningACB`) — every real server call path always attaches it.
- **Return %** uses ACB as the denominator, not all-time buy cost.
- **Dividends have two mutually exclusive paths** in `computeHoldings`: yield-first (when `stock_info.dividend_yield > 0` and market value > 0) vs per-share fallback. Don't blend them.
- `DIVIDEND` (cash) accumulates `dividends_paid`; `DIVIDEND_REINVEST` instead adds shares and buy cost. `CONTRIBUTION`/`WITHDRAWAL`/`TRANSFER_IN`/`TRANSFER_OUT` auto-adjust `cash_balance` via `CASH_BALANCE_DELTA`; it can go negative (e.g. a transfer logged before its matching contribution) — that's allowed by design, not validated against.
- The holdings query filters `HAVING shares > 0`, so fully-sold positions never appear in `/summary` or `/overview`.
- `POST /api/transactions` rejects `SELL`/`DIVIDEND`/`DIVIDEND_REINVEST` unless the portfolio's *current* net share count for that ticker (via `NET_SHARES`, not "was ever bought") is positive, and rejects a `SELL` quantity exceeding current shares **plus `SHARE_EPSILON`** — a running `SUM()` over many DRIP/fractional-share transactions can land a hair below the "true" total (e.g. `0.5882999999999989` instead of `0.5883`) purely from IEEE-754 summation, and a bare `>` comparison rejected selling the full position. The PUT edit route and the CSV import's oversell guard apply the same tolerance. It also rejects an exact duplicate of an existing row (same portfolio/ticker/type/date/quantity/price/total) with 409.
- **The CSV import (`POST /api/import/csv`) must enforce the same rules as `POST /api/transactions`** — it is a second, parallel write path and drifted once already. It now whitelists `type` against `TRANSACTION_TYPES`, rejects `TRANSFER_*`, applies `CASH_BALANCE_DELTA` for `CONTRIBUTION`/`WITHDRAWAL`, and checks the oversell guard against a running per-position share count (so a sequence of sells in one file is validated cumulatively, not just against the starting balance). Before this, an over-sell drove `shares` negative, `HAVING shares > …` dropped the position, and it vanished from `/summary` and `/overview` while the import reported success.
- **Backup export is `version: 2`** and includes `portfolio_value_snapshots`. This matters because `POST /api/import` does `DELETE FROM portfolios`, which cascades snapshots away — point-in-time market data that cannot be recomputed from the ledger. A `version: 1` file (no snapshots) is still accepted: the live snapshot rows are read before the delete and re-inserted for portfolios that survive the import.

Run `npm test` after touching `lib/compute.js` or the `HOLDINGS_SQL` aggregation in `lib/holdings.js`.

**Resolved:** ACB used to be prorated from all-time `sharesBought`/`buyTotal`, which only equalled average-cost ACB when every buy preceded every sell — a buy→sell→buy sequence re-averaged the sold lot's cost back into the remaining shares (e.g. buy 100@$10, sell 50@$12, buy 50@$20 used to report ACB $1,333.33 where CRA average-cost is $1,500.00). Fixed by walking transactions in date order (`computeRunningACB`/`applyRunningACB` in `lib/compute.js`) instead of pre-aggregating the order away; this changed displayed ACB and return % for any position with a buy after a sell. Regression coverage in `test-full.js` section C2.

## Stylesheet

`client/src/style.css` holds the hand-written Terminal Calm layer; Tailwind
utilities and the shadcn primitives cover everything else. About half the file
was dead when the Terminal Calm port landed — 261 rules for classes that no
longer appeared in any component — and has been removed. If you delete a
component, delete its rules with it.

Two things make a class look unused when it is not, so check both before
removing anything:
- **Runtime-assembled class names.** `` `type ${t.type.toLowerCase()}` ``
  (HoldingTransactionsModal), `TYPE_BADGE` → `` `tc-badge ${cls}` ``
  (Transactions), `` `toast toast--${variant}` `` (toast.jsx) and `retClass()`
  → `positive`/`negative` (utils/format.js) all build class names from data, so
  grepping for the literal finds nothing.
- **Compound selectors.** `.type` is live but `.transaction-item .type` is
  dead, because `.transaction-item` no longer exists. Judge the whole
  selector, not the individual class names in it.

## Project skills

Invoke these on demand (`/<name>`); they are not automatic:
- `/finance-auditor` — audits the math and reconciles portfolio totals against the live DB.
- `/test-engineer` — creates/updates tests following the `test.js`/`test-full.js`/`test-auth.js` conventions.
- `/ui-design` — see below.

## UI Work

Always use the `ui-design` skill for UI changes. Use wireframes in `/design` as the source of truth for layout and information architecture.
