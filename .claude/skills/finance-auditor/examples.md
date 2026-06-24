# Finance Auditor — examples

## Reconciliation harness

Reuse the app's own engine instead of re-deriving formulas. This reads the live DB, recomputes holdings, and is the starting point for the Mode 2 invariants. Run with `node` from the repo root.

```js
// scratch-reconcile.js  (write to the scratchpad dir, not the repo)
const Database = require('better-sqlite3');
const { computeHoldings } = require('./lib/compute');

const db = new Database('yieldly.db', { readonly: true });

// Mirror HOLDINGS_SQL closely enough for reconciliation, or import rows the same
// way server.js does. Then:
const rows = db.prepare(`/* HOLDINGS_SQL ... */ GROUP BY t.portfolio_id, t.ticker HAVING shares > 0`).all();
const holdings = computeHoldings(rows);

const EPS = 0.01;
const close = (a, b) => Math.abs(a - b) <= EPS;

for (const h of holdings) {
  // Invariant 1: share conservation
  if (h.shares < 0) console.log(`CRITICAL ${h.portfolio_code}/${h.ticker}: oversold (shares=${h.shares})`);

  // Invariant 6: return identity
  const expected = h.market_value + h.sale_total + h.dividends_paid - h.buy_total;
  if (!close(expected, h.return))
    console.log(`CRITICAL ${h.portfolio_code}/${h.ticker}: return ${h.return} != ${expected} (Δ ${(h.return - expected).toFixed(4)})`);

  // Invariant 8: finite fields
  for (const [k, v] of Object.entries(h))
    if (typeof v === 'number' && !Number.isFinite(v))
      console.log(`CRITICAL ${h.portfolio_code}/${h.ticker}: ${k} is ${v}`);
}
```

## Independent raw-transaction re-sum (Invariant 9)

The other invariants recompute from `HOLDINGS_SQL`'s own `SUM(CASE…)` output, so they can't catch a bug in that SQL. This one re-sums the **raw ledger** in plain JS and compares — it's the only source-of-truth check. Run it every time.

```js
const txByKey = {}; // "pid|ticker" -> raw transaction rows
for (const t of db.prepare('SELECT * FROM transactions').all())
  (txByKey[`${t.portfolio_id}|${t.ticker}`] ??= []).push(t);

for (const h of holdings) {
  const pid = pidByCode[h.portfolio_code];
  const tx = txByKey[`${pid}|${h.ticker}`] || [];
  const isBuy = t => t.type === 'BUY' || t.type === 'DIVIDEND_REINVEST';
  const sum = (f, p) => tx.filter(p).reduce((a, t) => a + (f(t) || 0), 0);

  const expect = {
    buy_total:      sum(t => t.total, isBuy),
    sale_total:     sum(t => t.total, t => t.type === 'SELL'),
    dividends_paid: sum(t => t.total, t => t.type === 'DIVIDEND'),
    buy_expense:    sum(t => t.commission, isBuy),
    sale_expense:   sum(t => t.commission, t => t.type === 'SELL'),
  };
  for (const [k, v] of Object.entries(expect))
    if (!close(v, h[k]))
      console.log(`CRITICAL ${h.portfolio_code}/${h.ticker}: ${k} SQL=${h[k]} ledger=${v} (Δ ${(h[k]-v).toFixed(4)})`);
}
```

## Running-balance oversell (Invariant 10)

Invariant 1 only checks the net `shares ≥ 0`, and `HAVING shares > 0` hides closed positions — so a SELL recorded before its shares existed is invisible. Walk the balance chronologically instead.

```js
for (const k of db.prepare('SELECT DISTINCT portfolio_id, ticker FROM transactions').all()) {
  const tx = db.prepare('SELECT date, type, quantity FROM transactions WHERE portfolio_id=? AND ticker=? ORDER BY date, id').all(k.portfolio_id, k.ticker);
  let bal = 0, worst = 0, worstDate = null;
  for (const t of tx) {
    if (t.type === 'BUY' || t.type === 'DIVIDEND_REINVEST') bal += t.quantity;
    else if (t.type === 'SELL') bal -= t.quantity;
    if (bal < worst) { worst = bal; worstDate = t.date; }
  }
  if (worst < -EPS) // HIGH, not Critical — may be a same-day BUY/SELL ordering artifact
    console.log(`HIGH ${k.ticker}: running balance hit ${worst} on ${worstDate}, final=${bal}`);
}
```

✅ Note the caveat in the finding: same-date rows are tie-broken by `id`, so a one-day dip that recovers may be ordering, not corruption. State the date and the final balance.

## Data-quality screen (Invariant 11)

```js
const neg = db.prepare('SELECT COUNT(*) c FROM transactions WHERE quantity<0 OR price<0 OR total<0').get().c;
const future = db.prepare('SELECT COUNT(*) c FROM transactions WHERE date > ?').get(TODAY).c; // TODAY = 'YYYY-MM-DD'
const dups = db.prepare(`SELECT portfolio_id,ticker,type,quantity,price,total,date,COUNT(*) n
  FROM transactions GROUP BY portfolio_id,ticker,type,quantity,price,total,date HAVING n>1`).all();
// Held positions silently valued at 0 because stock_info.market_price is missing:
const missingPrice = holdings.filter(h => h.shares > 0 && (!rawByKey[`${h.portfolio_code}|${h.ticker}`].market_price));
```

Negatives / future dates / duplicates are **High**; a missing price on a held position is **Medium** (stale data, not wrong math).

## Float comparison

✅ Compare money with a one-cent tolerance:
```js
if (Math.abs(expected - actual) > 0.01) report(...);
```

❌ Never compare derived money with strict equality — floating-point rounding will produce false discrepancies:
```js
if (expected !== actual) report(...); // wrong: 19.999999998 !== 20
```

## Cash drift (Invariant 7)

`cash_balance` is manual and is **not** updated by cash-flow transactions, so a difference is a *warning*, not a corruption.

✅ Report drift as Medium with both numbers:
```
Medium — RRSP cash drift: stored cash_balance = 5,000.00,
derived from transactions = 4,250.00 (Δ 750.00). May be an
intentional manual override; confirm with the user.
```

❌ Do not silently "fix" `cash_balance` or label drift Critical — the app treats it as user-owned.

## Closed positions (Invariant 5)

Holdings are filtered by `HAVING shares > 0`, so a fully-sold ticker won't appear in `computeHoldings` output.

✅ For realized P/L or lifetime dividends, query `transactions` directly rather than the holdings list:
```js
const allDiv = db.prepare(`SELECT SUM(total) d FROM transactions WHERE type='DIVIDEND'`).get().d || 0;
```

❌ Don't conclude "dividends missing" just because a closed position's `DIVIDEND` rows aren't in the holdings roll-up.

## Clean result

A passing audit is a real outcome — state it plainly:
```
RECONCILED ✓
Checked 3 portfolios / 41 holdings. Invariants 1–8 hold within ±0.01.
Market value 128,440.17 · buy_total 96,210.00 · dividends_paid 3,884.52.
node test.js: 30 passing.
```
