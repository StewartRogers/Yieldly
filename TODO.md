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
- [ ] **Verify the CSP on the first Vercel deploy.** The `headers` block in
      `vercel.json` was validated against the Vite build output (no inline
      scripts, no external resources), *not* against a live deployment. Check
      the browser console for CSP violations after deploying.
- [ ] **Re-add the History regression test.** A Playwright spec covering the
      cross-portfolio write fix (`6ba18a9`) was written but deleted rather than
      committed unverified. Note: portfolio pills are labelled by portfolio
      **name**, not code, and Playwright must be run from `client/` —
      running it from the repo root reports a misleading "No tests found".
- [ ] **Login rate limiting is per-instance.** `express-rate-limit` uses an
      in-memory store, so on Vercel each warm lambda has its own counter and
      "10 attempts / 15 min" is really "10 per instance". Use a shared store
      (Turso/Upstash) or add a persisted lockout on the user row.
- [ ] **`/api/cron/*` has no rate limit.** The bearer comparison is
      timing-safe and fails closed, but an attacker gets unlimited guesses at
      `CRON_SECRET`. Also note the `/cron/` auth exemption is a *prefix* match,
      so any future `/api/cron/*` route inherits the JWT bypass automatically.
- [ ] **Request bodies are parsed before authentication.** The 50 MB / 10 MB
      JSON parsers mount above the auth guard, so an unauthenticated request is
      fully buffered and `JSON.parse`d before the 401. Move `cookieParser` and
      the `/api` guard above the `express.json` mounts.
- [ ] **`createApp` mints a random `sessionSecret` when the option is
      omitted** (`app.js:152`). Both current callers guard, so it isn't
      exploitable — but a future entrypoint that forgets would get a silently
      random secret, invalidating all tokens on every cold start with no error.
      Make it required.
- [ ] **Pin CI actions to commit SHAs.** `actions/checkout@v4` and
      `actions/setup-node@v4` use mutable major tags.
- [ ] **Username enumeration via timing.** `bcrypt.compare` (~60 ms) only runs
      when the user exists; a wrong username returns in ~1 ms. Compare against
      a dummy hash when no user is found.
- [ ] **`/api/auth/setup` land-grab.** `GET /api/auth/session` advertises
      `needsSetup: true` to anyone, and setup is first-wins — whoever POSTs
      first on a fresh deployment owns the instance. Consider requiring a
      `SETUP_TOKEN` in production.

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
- [ ] **DIVIDEND_REINVEST income vanishes from `return` and the dividend
      chart.** DRIP adds to `buy_total` but never to `dividends_paid`, and
      `/api/dividends/monthly` filters `WHERE t.type = 'DIVIDEND'`. BUY 100 @
      $10 then DRIP $50 at market $10 reports **$0.00 / 0.0%** where the
      correct answer is **+$50 / +5.0%**. A pure-DRIP portfolio reports zero
      lifetime return and an empty income chart. (Adding the DRIP amount to ACB
      is correct tax treatment — the bug is that the offsetting income is never
      recognised.)
- [ ] **`return` excludes commissions while its own denominator includes
      them.** `totalReturn` never subtracts `buyExpense`/`saleExpense`, but
      `acb` adds `buyExpense`. `total_expense` is returned by the API and
      consumed by nothing. Example: reported $150.00 / 29.70% vs
      commission-consistent $135.00 / 26.73%.
- [ ] **NULL `market_price` is coerced to $0**, reporting −100% return rather
      than "price unknown" — and, critically, the **persisted** cron snapshot
      writes that zero into `portfolio_value_snapshots`, so a TMX outage
      permanently charts a fake drawdown. Emit `null` and have the snapshot
      route skip (not zero) portfolios with unpriced holdings.
- [ ] **`guessNextDividendDate` overflows month-end.**
      `setUTCMonth(+months)` on 2024-01-31 Monthly gives **2024-03-02**
      (skipping February entirely); 2024-08-31 Quarterly gives 2024-12-01.
      `estimateNextDividendDate` compounds it on each loop iteration. Affects
      month-end payers, common among TSX monthly-distribution ETFs. Clamp to
      the last valid day of the target month.
- [ ] **Per-share dividend fallback with an unknown frequency** zeroes
      `annual_payout` and `dividend_yield` while `next_payout` stays positive,
      so a holding appears in `/api/dividends/upcoming` with a payout it
      contributes $0 of annual income for. The yield-first branch handles the
      same case correctly — the two branches disagree.
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
- [ ] **`market` is not whitelisted.** `performRefreshPrices` treats anything
      that isn't `NYSE`/`NASDAQ` as TMX, so a typo like `"NYSE "` routes a US
      ticker to the Canadian quote source and it silently never updates.
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
