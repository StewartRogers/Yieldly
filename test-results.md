# Yieldly — Test Results

**Suite:** `test-full.js` (220 tests across 11 sections)
**Date:** 2026-06-03
**Runtime:** Node.js v20.20.2 / better-sqlite3 v11.0.0 (in-memory SQLite)
**Result:** 219 passed — **1 FAILED**

---

## Summary Table

| Section | Description | Tests | Pass | Fail |
|---------|-------------|-------|------|------|
| A (A1–A30) | Math / computeHoldings — all transaction types, ACB, dividends, yields | 91 | 91 | 0 |
| B (B1–B3) | Monthly dividend grouping (Dividends page) | 12 | 12 | 0 |
| C (C1–C5) | computeMonthlyACB — Summary page ACB matrix | 13 | 13 | 0 |
| D (D1–D11) | CSV import — parseCSVLine, parseDate, duplicate detection, errors | 34 | **33** | **1** |
| E (E1–E5) | Portfolio creation input validation | 12 | 12 | 0 |
| F (F1–F5) | Transaction creation validation | 8 | 8 | 0 |
| G (G1–G6) | computeHoldings edge cases | 13 | 13 | 0 |
| H (H1–H2) | cash_invested / Overview logic | 4 | 4 | 0 |
| I (I1–I2) | CSV format compatibility | 8 | 8 | 0 |
| J (J1–J4) | All 6 transaction types | 12 | 12 | 0 |
| K (K1–K5) | Regression / metadata fields | 11 | 11 | 0 |
| **TOTAL** | | **220** | **219** | **1** |

---

## Failed Test — Full Detail

### D4 — `parseDate` does not pass through ISO dates unchanged

**Test:** `2024-01-15 passthrough`
**Expected:** `"2024-01-15"`
**Got:** `"2015-01-2024"`

**Root cause — `server.js` lines 726–745:**

```js
function parseDate(dateStr) {
  // ...
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr; // ← guard is wrong
  const day   = parts[0].padStart(2, '0');
  const month = months[parts[1]] || '01';
  let year    = parts[2];
  if (year.length === 2) { year = '20' + year; }
  return `${year}-${month}-${day}`;
}
```

An ISO date like `2024-01-15` also has exactly 3 dash-separated parts, so it falls through to the conversion logic. The function then treats:
- `parts[0]` = `"2024"` as the **day**
- `parts[1]` = `"01"` (numeric, not in the month map) → falls back to `"01"`
- `parts[2]` = `"15"` as the **year** → 2-digit check fires, producing `"2015"`

Final result: `"2015-01-2024"` — a completely corrupt, invalid date stored into the database.

**When triggered:** A CSV row whose date column already contains an ISO date (`YYYY-MM-DD`) rather than the expected `DD-MMM-YY` format. The Import page UI today shows `YYYY-MM-DD` as the example date format (see `Import.jsx` constant `SAMPLE_ROW`), so users following the UI's own example will hit this bug on every import row.

**Suggested fix — `server.js` `parseDate` function:**

```js
function parseDate(dateStr) {
  // 1. If it already looks like YYYY-MM-DD, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  const months = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };

  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;

  const day   = parts[0].padStart(2, '0');
  const month = months[parts[1]] || '01';
  let year    = parts[2];

  if (year.length === 2) {
    year = parseInt(year) < 50 ? '20' + year : '19' + year;
  }

  return `${year}-${month}-${day}`;
}
```

The single additional guard (`/^\d{4}-\d{2}-\d{2}$/.test(dateStr)`) short-circuits the function before any conversion for already-correct dates.

---

## What Was Covered

### Financial Calculations (Part A, C, G, H)
- Simple buy, weighted-average buy price across multiple buys
- Partial sell: remaining shares, ACB reduction, return, return%
- Full sell: position removed from holdings
- DRIP (dividend reinvestment): shares + buy_total both increase, commission excluded from buy_price but included in ACB
- Commission: included in ACB, excluded from buy_price; tracked as buy_expense/sale_expense/total_expense
- Cash dividend: tracked in dividends_paid, included in return calculation, does not affect share count
- Dividend yield calculations — yield-first (TMX) path and per-share fallback path for all four frequencies: Monthly, Quarterly, Semi-Annual, Annual
- Return % denominator = ACB of open position (not all-time buy cost)
- No market price: return uses only realized values; dividend_yield returns 0
- CASH ticker (CONTRIBUTION / WITHDRAWAL) excluded from holdings
- Multiple portfolios are isolated from each other
- computeMonthlyACB: single buy, partial sell reducing ACB, commission in ACB, CASH excluded, DRIP adding to ACB
- Edge cases: empty input, zero market price with yield set, fractional DRIP, very large values, same-day duplicate transactions

### Monthly Dividend Grouping (Part B)
- Same-month dividends sum into one row
- Portfolio isolation in dividend queries
- All-portfolios dividend aggregation

### CSV Import (Part D, I)
- parseCSVLine: basic comma separation, quoted fields with embedded commas
- parseDate: DD-MMM-YY with 2-digit year (century logic), 4-digit year, non-standard passthrough (BUG found)
- Full import flow: 3-row success, unknown portfolio rejection, duplicate detection, too-few-columns error, mixed success/error batch
- Type code mapping: B→BUY, S→SELL, D→DIVIDEND, DR→DIVIDEND_REINVEST
- All 4 transaction type codes in one import

### Input Validation (Parts E, F)
- Portfolio: valid names and codes, missing name/code, 101-character name, forbidden HTML characters (`<>\"'`), invalid codes (6+ chars, spaces, special chars)
- Transaction: valid BUY, CONTRIBUTION/WITHDRAWAL without ticker, missing portfolio_id/date/type, BUY without ticker

### Transaction Types (Part J)
- All 6 types stored and retrievable: BUY, SELL, DIVIDEND, DIVIDEND_REINVEST, CONTRIBUTION, WITHDRAWAL
- CONTRIBUTION and WITHDRAWAL do not appear in holdings
- DIVIDEND does not affect share count
- DIVIDEND_REINVEST increases both shares and buy_total

### Metadata / Regression (Part K)
- sector and investment_type stored and returned in holdings
- last_dividend_date stored and returned
- portfolio_code and portfolio_name included in holdings output
- buy_price (acbPerShare) excludes commission correctly

---

## Remaining Risk Areas (not covered by automated tests)

1. **E2E / browser tests** — No Playwright tests yet. Key flows untested in a real browser:
   - Navigation between all 6 routes (Home, Summary, Dividends, Portfolios, Transactions, Import)
   - Creating a portfolio from the UI form
   - Adding each transaction type through the Transactions form
   - Portfolio drag-to-reorder
   - StockInfoModal save flow
   - HoldingTransactionsModal display
   - File drag-and-drop on the Import page
   - Card view vs List view toggle on Portfolios page
   - Pagination on Transactions page (> 20 rows)
   - Cash balance inline edit on Summary page

2. **TMX price refresh** — `/api/portfolios/:id/refresh-prices` and `/api/refresh-all-prices` make live network calls to TMX GraphQL. Not tested (would need mocking or network access).

3. **Portfolio deletion** — The `DELETE /api/portfolios/:id` endpoint is present in server.js but not covered by current tests. Cascade deletion of transactions/stock_info should be verified.

4. **Concurrent portfolio reordering** — The drag-to-reorder calls `PUT /api/portfolios/:id/order` in parallel for every portfolio. Race conditions under load are not tested.

5. **Database migration paths** — `database.js` contains several migration branches. The in-memory test DB bypasses them. The live DB migration for adding CONTRIBUTION/WITHDRAWAL to the CHECK constraint has not been tested against a pre-migration DB.

6. **Cash balance** — `PUT /api/portfolios/:id/cash-balance` with null/empty/invalid values is not tested.

---

## How to Re-run

```bash
node test-full.js
```

No server needed. Tests run entirely in-memory.
