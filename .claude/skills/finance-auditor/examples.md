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
