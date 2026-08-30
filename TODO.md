# TODO

Open items from the full-repository quality and security review (2026-08-07).
Two passes were shipped that day — `02d460e` (server, security, supply chain)
and `6ba18a9` (client bugs). Everything below is what those passes
deliberately left open.

Line numbers are approximate: they were captured before the two fix commits
and some have shifted. Symbol names are reliable.

---

## P1 — Security / operational

- [ ] **Ask GitHub Support to expire cached views** of the objects purged in
      the history rewrite. The screenshots and `portfolios.json` are gone from
      the repo, but GitHub may still serve cached blobs. Anyone who cloned
      before 2026-08-07 also still has them (0 forks / 0 stars at the time).
      Not automatable — needs a human to file the support request.
- [x] **Verify the CSP on the first Vercel deploy.** Fixed/verified 2026-08-30:
      confirmed against the live deployment (not just the local build) — the
      `Content-Security-Policy` header comes back byte-for-byte as configured
      in `vercel.json`, and the served `index.html` only references same-origin
      hashed script/style assets (no inline `<script>`, no external hosts), so
      there's nothing in the shipped output that `script-src`/`style-src` would
      block. A live-browser DevTools console check is still worth doing once
      as a final sanity pass, but there's no static-analysis gap left to close.
- [x] **Re-add the History regression test.** Fixed 2026-08-30: added
      `client/tests/history-portfolio-switch.spec.js`, covering the exact
      `6ba18a9` scenario (open an edit on portfolio A, switch to portfolio B
      without saving, assert the stale editor is gone and neither portfolio's
      value changed). Verified both directions — passes against the current
      `History.jsx`, and fails (editor survives the switch) when the guard
      order / `ValueMatrix key={selected}` fix is temporarily reverted. Green
      on all three engines (`npx playwright test` from `client/`).
- [x] **Login rate limiting is per-instance.** Fixed 2026-08-30: added a
      persisted per-account lockout (`users.failed_login_attempts` /
      `locked_until`, migration in `database.js`) alongside the existing
      per-instance `express-rate-limit` — 10 failed attempts locks the account
      for 15 minutes regardless of which Vercel instance serves the request,
      since it's read/written on the `users` row via Turso rather than
      in-memory. Reset on successful login.
- [x] **`/api/cron/*` has no rate limit.** Fixed 2026-08-30: `authLimiter`
      (the same per-IP throttle already used on `/api/auth/login` +
      `/api/auth/setup`) now also guards `GET /api/cron/snapshot-values`. The
      prefix-match note (any future `/api/cron/*` route auto-inherits the JWT
      bypass) still stands as a design tradeoff, not a bug — worth remembering
      when adding a new cron route.
- [x] **Request bodies are parsed before authentication.** Fixed 2026-08-30:
      `cookieParser()` and the `/api` auth guard now run before the 50 MB /
      10 MB `express.json()` mounts. `/api/auth/login` and `/api/auth/setup`
      (unauthenticated by design) get their own small-body parser
      (`express.json()`'s 100kb default) mounted separately, before the guard.
- [x] **`createApp` mints a random `sessionSecret` when the option is
      omitted.** Fixed 2026-08-30: `createApp` now throws
      `"createApp: options.sessionSecret is required"` if omitted, rather than
      silently minting one. Both current callers already passed it explicitly.
- [x] **Pin CI actions to commit SHAs.** Fixed 2026-08-30: `.github/workflows/ci.yml`
      now pins `actions/checkout` and `actions/setup-node` to the commit SHA
      `v4` currently resolves to (v4.4.0 for both), with a version comment.
      Bump both the SHA and the comment together when upgrading.
- [x] **Username enumeration via timing.** Fixed 2026-08-30: `POST
      /api/auth/login` now always runs `bcrypt.compare` — against a fixed
      dummy hash (`DUMMY_PASSWORD_HASH`) when the username doesn't exist — so
      a nonexistent username takes the same ~60ms as a wrong password instead
      of returning in ~1ms.
- [x] **`/api/auth/setup` land-grab.** Fixed 2026-08-30: added an optional
      `setupToken` option (env `SETUP_TOKEN`) — when set, `POST
      /api/auth/setup` requires a matching `setupToken` in the body
      (`crypto.timingSafeEqual`) or returns 403. `GET /api/auth/session` now
      also reports `setupTokenRequired` so the Login page can show the field;
      unset (the default) preserves the original first-wins convenience for a
      local-only deployment.

---

## P2 — Correctness (server)

- [x] **Transactions can be dated in the future.** Fixed 2026-08-28: added
      `isFutureDate` (`app.js`), comparing against "today" pinned to Pacific
      time (`America/Los_Angeles`) rather than the server's own clock, so the
      bound is consistent regardless of where the code runs. Wired into
      `POST /api/transactions`, the transfer route, and the CSV import's
      per-row date check. The client date inputs (`Transactions.jsx`) now set
      `max={todayLocal()}` (client-local, informational only — the server
      check is authoritative). Regression coverage in `test-auth.js` section 39.
- [x] **DIVIDEND_REINVEST income vanishes from `return` and the dividend
      chart.** Fixed 2026-08-30: `HOLDINGS_SQL`'s `dividends_paid` now sums
      `DIVIDEND_REINVEST` alongside `DIVIDEND` (`lib/holdings.js`), and
      `/api/dividends/monthly` filters on both types too (`app.js`). DRIP
      income is real, just immediately reinvested — the reinvested amount was
      already correctly added to ACB, but the offsetting income was never
      recognised, so a pure-DRIP holding reported $0.00/0.0% return and never
      showed up on the income chart. Regression coverage: test.js §24,
      test-full.js §A22.
- [x] **`return` excludes commissions while its own denominator includes
      them.** Fixed 2026-08-30: `totalReturn` now subtracts
      `buyExpense + saleExpense` (`lib/compute.js`), matching `acb`, which
      already included buy commission. Regression coverage: test.js §35
      (return now $-2010/-40.12% instead of $-2000/-39.92% for the same
      position).
- [x] **NULL `market_price` is coerced to $0**, reporting −100% return rather
      than "price unknown" — and, critically, the **persisted** cron snapshot
      writes that zero into `portfolio_value_snapshots`, so a TMX outage
      permanently charts a fake drawdown. Fixed 2026-08-30: `computeHoldings`
      now emits `price_known` and reports `return`/`return_percent` as `null`
      (not a fabricated loss) for a currently-held position with no known
      price (`lib/compute.js`). `GET /api/cron/snapshot-values` skips writing
      a portfolio's snapshot for the day entirely when any of its holdings has
      `price_known: false`, leaving the prior value in place rather than
      overwriting it with a deflated total; the response now reports
      `skipped: [portfolio codes]`. Regression coverage: test.js §20,
      test-full.js §A27, test-auth.js §33b.
- [x] **`guessNextDividendDate` overflows month-end.** Fixed 2026-08-30: added
      `addMonthsClamped` (`lib/dividends.js`), clamping the day-of-month to the
      target month's last day instead of letting `setUTCMonth` overflow it
      forward. `estimateNextDividendDate`'s loop now re-anchors on the
      original date each step instead of compounding from a previously
      clamped result, so a day-31 payer doesn't permanently erode to day-28
      after passing through February. Regression coverage: test-full.js
      §L2b, §L4b.
- [x] **Per-share dividend fallback with an unknown frequency** zeroes
      `annual_payout` and `dividend_yield` while `next_payout` stays positive,
      so a holding appears in `/api/dividends/upcoming` with a payout it
      contributes $0 of annual income for. The yield-first branch handles the
      same case correctly — the two branches disagree. Fixed 2026-08-30:
      `lib/compute.js`'s fallback branch now reports `annual_payout`/
      `dividend_yield` as `null` (unknown — we don't know how many payments
      happen a year) rather than `0` (which reads as "no dividend") whenever
      there's a real nonzero `next_payout` to contradict. Still reports a
      genuine `0` when there's no per-share amount either (the ordinary
      non-dividend-payer case is unaffected). Regression coverage: test.js §34.
- [ ] **`computeMonthlyACB` depends on the caller's `ORDER BY`** despite being
      exported as pure. (The `now`-in-local-time half of this item is fixed —
      2026-08-28: its default is now pinned to Pacific time via `nowInPacific`
      in `app.js`, matching `isFutureDate`.)
- [ ] **Cron snapshot labels Friday's close as Saturday and Sunday**, adding
      two duplicate weekend rows per week (~40% row inflation). Harmless for
      month-end bucketing; skip the write when the computed date is a weekend.
- [ ] **`PUT /api/portfolios/:id` skips the validation `POST` performs** — a
      300-character code is accepted, and a non-string name returns 500 rather
      than 400. Extract a shared `validatePortfolioInput`.
- [ ] **`PUT /api/portfolios/:portfolioId/stocks/:ticker` validates almost
      nothing** — no `TICKER_REGEX`, no `dividend_frequency` whitelist, and
      negative prices are accepted. A bogus frequency silently disables
      next-dividend estimation for that holding forever.
- [ ] **TOCTOU on the SELL/duplicate guards** — both checks run outside the
      write transaction, so two concurrent SELLs can each see enough shares.
      Single-user, so low probability.
- [x] **`market` is not whitelisted.** `performRefreshPrices` treats anything
      that isn't `NYSE`/`NASDAQ` as TMX, so a typo like `"NYSE "` routes a US
      ticker to the Canadian quote source and it silently never updates. Fixed
      2026-08-30: added a `MARKETS` whitelist (`TMX`/`NYSE`/`NASDAQ`), enforced
      on `POST /api/transactions` and `PUT /api/transactions/:id` (400 on
      anything else). The CSV import path was already unaffected — it never
      writes a `market` column, always defaulting to the schema's `TMX`.
      Regression coverage: test-auth.js §47.
- [ ] **Non-string inputs return 500 instead of 400** on `username`,
      `csvData`, and `name` (all call `.trim()` unguarded), logging a full
      stack trace for what is a client error.
- [ ] **Raw DB error text is reflected to the client** in the CSV import
      response (e.g. `CHECK constraint failed` with SQL fragments).
      Authenticated-only, but it leaks schema detail.
- [ ] **Unknown `/api` paths return the SPA HTML** with a 200 in self-hosted
      production mode, instead of a 404 JSON.
- [ ] **`db.transaction()` abandons the connection.** After a transaction the
      wrapper lazily opens a *new* connection and never closes the old one.
      This makes the `:memory:` mode that `database.js` documents for tests
      unusable end-to-end, and churns connections in local-file mode. Either
      fix the wrapper to re-adopt the connection on commit/rollback, or drop
      the `:memory:` claim from the doc comment.
- [ ] **`parseCSVLine` breaks on quoted fields containing newlines**, because
      the import splits on `\n` before parsing.
- [ ] **Two `HOLDINGS_SQL` columns are dead** — `shares_sold` is read nowhere,
      and `buy_price` is recomputed in `compute.js` rather than consumed. The
      duplicate `buy_price` is a real drift hazard.

---

## P2 — Correctness (client)

- [ ] **Add regression coverage for the fixed race conditions.** The request-id
      guards in `Portfolios.jsx` / `Transactions.jsx` and the cancellation flag
      in `HoldingTransactionsModal.jsx` are currently unverified by any test.
- [ ] **`Import.jsx` fails silently.** Dropping a non-`.csv` file does nothing
      at all — no message. The `FileReader` also has no `onerror`, so a read
      failure leaves the Import button inert.
- [ ] **`Import.jsx` revokes the object URL in the same tick as `a.click()`**,
      with the anchor never appended to the DOM. Works in current Chrome; has
      historically cancelled the download in Firefox/Safari.
- [ ] **`Portfolios.jsx` bootstrap effect is missing `selectedId` from its
      deps** — if every portfolio is deleted, `selectedId` keeps pointing at a
      dead id and stale holdings stay rendered.
- [ ] **`setTimeout` state resets have no cleanup** (`App.jsx:75`,
      `Dividends.jsx:340`, `Portfolios.jsx:154` and `:200`). Benign in React 19,
      but re-triggering an action within the window lets the first timer clear
      the second message early.

---

## P3 — Quality / hygiene

- [ ] **17 remaining lint problems.** 7 are the data-fetching
      `setState`-in-effect pattern (needs a fetching library or a different
      structure to satisfy), 3 are `react-refresh/only-export-components` from
      shadcn's cva exports, plus `toast.jsx` reading a ref during render.
      All need architectural change rather than a fix.
- [ ] **`Pager` is duplicated verbatim** in `Dividends.jsx:68` and
      `Transactions.jsx:59` with different `PER_PAGE` constants closed over
      from module scope — and the two copies have **already drifted** (one
      renders "of N", the other dropped it). Extract to
      `client/src/components/Pager.jsx` taking `perPage` as a prop.
- [ ] **Inline formatters bypass `utils/format.js`**, and they disagree:
      `Dividends.jsx`'s `fmtDiv` renders a *negative* total as `—`, and its
      `fmtKPI` rounds where the shared helper truncates — so $1,234.60 reads
      `$1,235` on Dividends and `$1,234` on Summary for the same dollar.
      `Portfolios.jsx` formats yield two different ways between card and list
      view.
- [ ] **`test-results.md` is stale** — dated 2026-06-03, references
      `better-sqlite3 v11` against a declared `^12.10.0`, and describes a
      `parseDate` bug at "server.js lines 726-745" when that code now lives in
      `lib/parse.js` (and the bug is fixed).
- [ ] **Remove the inert `allowScripts` key** from `package.json` — it's a
      `@lavamoat/allow-scripts` field and LavaMoat isn't installed. It also
      pins an exact version that will drift from the `^12.10.0` range.
- [ ] **Prune the root `node_modules`.** ~40 extraneous packages (the OpenAI
      Codex CLI dependency tree) are installed but declared nowhere and used by
      no source file. They don't ship — Vercel installs fresh from the
      lockfiles — but they pollute local `npm audit`. `rm -rf node_modules &&
      npm ci`, and install that CLI globally instead.

---

## Feature requests

- [x] **Edit an existing transaction.** Implemented 2026-08-28: added
      `PUT /api/transactions/:id` (`app.js`), re-running every guard
      `POST /api/transactions` applies (type whitelist, finite/non-negative
      checks, date/future-date validation, the `NET_SHARES` oversell guard,
      the duplicate check) with the row's own id excluded from the
      self-comparisons so a no-op re-save doesn't reject itself. Reverses the
      *old* row's `CASH_BALANCE_DELTA` before applying the new one (including
      across a portfolio change). `TRANSFER_IN`/`OUT` legs are rejected
      outright — delete and recreate via `POST /api/transfers` instead, since
      editing one leg in place would desync its `transfer_peer_id` twin.
      Client: `Transactions.jsx` gained an edit (pencil) button per row that
      loads the form into edit mode with a Cancel affordance; the Transfer
      type option is hidden while editing. Regression coverage in
      `test-auth.js` section 46.

---

## Verified clean — do not re-investigate

Recorded so a future review doesn't re-tread these:

- **Auth guard coverage is complete.** `app.use('/api', …)` precedes all 38
  data routes. Fuzzed with dot-segment, encoded-dot-segment, double-slash and
  case-variant paths — all 401/404, never data.
- **No SQL injection.** Every user-controlled value is a bound parameter; the
  four interpolation sites are trusted internal literals (PRAGMA table names
  from a hardcoded array, a module constant, two fixed WHERE strings).
- **No SSRF in the market-data fetchers.** TMX uses an anchored regex and puts
  the symbol in a GraphQL variable, not a URL; Yahoo wraps it in
  `encodeURIComponent`. Both hosts are constants.
- **JWT handling is sound.** HS256 pinned on sign *and* verify (blocks
  `alg:none` and RS256→HS256 confusion), `expiresIn` set and enforced, cookie
  `maxAge` matches the token TTL.
- **Cookie flags are correct**, and SameSite=Lax plus no cookie-authenticated
  state-changing GETs makes the absence of a CSRF token acceptable here.
- **No secrets in the codebase or in git history** (swept with `git log --all
  -p`). Production guards fail closed; the dev `SESSION_SECRET` fallback cannot
  reach production.
- **No missing `await`** on any `db` call in `app.js`, and every multi-statement
  mutation is correctly wrapped in a transaction with rollback.
- **The two dividend paths in `computeHoldings` cannot blend** — single
  if/else, no cross-reads.
- **`NaN` cannot reach an API response** from a DB row; every input is
  `|| 0`-guarded and every division has a `> 0` denominator guard.
- **The client has no raw `fetch('/api/…')`** outside `api/client.js`, no
  `dangerouslySetInnerHTML`, no token in `localStorage`, and no
  open-redirect surface.
