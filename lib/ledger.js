'use strict';

const { SHARE_EPSILON } = require('./holdings');

// Date-aware share accounting for one position (portfolio + ticker).
//
// SELL coverage
// -------------
// The write routes used to check a SELL against the *current* net share count,
// with no regard to dates. That let two kinds of change through that leave the
// ledger with a SELL of shares that weren't held on its date:
//   - a backdated SELL (BUY 100 on 2025-06-01, then SELL 50 dated 2025-01-01);
//   - deleting, shrinking, re-dating or moving a BUY that a later SELL relied on.
// computeRunningACB (lib/compute.js) walks the same rows in ledger order and
// skips/clamps a SELL with nothing to sell against, so ACB silently stays at the
// full pre-sale basis — return % is understated and cash_invested overstated.
// Callers compare the total uncovered SELL quantity before and after a change
// and reject only if the change makes it worse, so a ledger that already holds
// legacy bad rows isn't frozen: unrelated edits to that position still go through.
//
// Splits
// ------
// A SPLIT row stores the ratio (split_ratio = new units per old unit: 3 for a
// 3-for-1, 0.1 for a 1-for-10 consolidation) and, in `quantity`, the units the
// split added — what NET_SHARES and the ACB walk sum. That quantity is derived:
// units held going into the split date × (ratio − 1). So it goes stale whenever
// a share-moving row dated before the split is added, edited or deleted. The
// walk below always derives it from the ratio, and splitResyncStatements()
// returns the UPDATEs that bring the stored quantities back in line; every
// write path runs them in the same transaction as its own write.

const SHARE_ADDING = new Set(['BUY', 'DIVIDEND_REINVEST']);

/** Types that move a position's unit count — the only rows the walk needs. */
const SHARE_TYPES = ['BUY', 'DIVIDEND_REINVEST', 'SELL', 'SPLIT'];

/**
 * JS twin of LEDGER_ORDER (lib/holdings.js): date, then a SPLIT before any
 * other row on the same date (it takes effect at the open, so it applies to
 * units held from earlier days, not to that day's trades), then id.
 */
function compareLedgerOrder(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const as = a.type === 'SPLIT' ? 0 : 1;
  const bs = b.type === 'SPLIT' ? 0 : 1;
  if (as !== bs) return as - bs;
  return a.id - b.id;
}

/**
 * Walk one position's rows in ledger order.
 *
 * Returns:
 *   shortfall   total uncovered SELL quantity
 *   firstShort  the first SELL left short ({ date, quantity, held }), for messages
 *   shares      units held at the end
 *   splitUnits  Map(id → units each SPLIT row should carry)
 *
 * @param {Array<{id:number, type:string, quantity:number, date:string, split_ratio?:number}>} rows
 */
function walkLedger(rows) {
  const sorted = [...rows].sort(compareLedgerOrder);
  let shares = 0;
  let shortfall = 0;
  let firstShort = null;
  const splitUnits = new Map();
  for (const r of sorted) {
    const qty = Number(r.quantity) || 0;
    if (SHARE_ADDING.has(r.type)) {
      shares += qty;
    } else if (r.type === 'SELL') {
      const held = Math.max(shares, 0);
      const sold = Math.min(qty, held);
      const short = qty - sold;
      if (short > SHARE_EPSILON) {
        shortfall += short;
        if (!firstShort) firstShort = { date: r.date, quantity: qty, held };
      }
      shares -= sold;
    } else if (r.type === 'SPLIT') {
      const ratio = Number(r.split_ratio);
      const added = ratio > 0 ? Math.max(shares, 0) * (ratio - 1) : 0;
      splitUnits.set(r.id, added);
      shares += added;
    }
  }
  return { shortfall, firstShort, shares, splitUnits };
}

/** Back-compat name used by the SELL-coverage callers. */
const walkSellCoverage = walkLedger;

/**
 * Compare a position's rows before and after a proposed change. Returns null
 * when the change leaves no more uncovered SELL quantity than there was before,
 * or `{ date, quantity, held }` describing the first SELL left short.
 */
function newlyUncoveredSell(beforeRows, afterRows) {
  const before = walkLedger(beforeRows);
  const after = walkLedger(afterRows);
  if (after.shortfall <= before.shortfall + SHARE_EPSILON) return null;
  return after.firstShort;
}

/** User-facing message for a newlyUncoveredSell() result. */
function uncoveredSellMessage(ticker, short) {
  const held = Math.round(short.held * 1e6) / 1e6;
  return `This would leave the SELL of ${short.quantity} ${ticker} on ${short.date} uncovered — only ${held} shares were held on that date`;
}

/**
 * UPDATE statements that set each existing SPLIT row's stored quantity to what
 * the ratio implies for `afterRows` (the position as it will be once the
 * caller's own change is written). Rows whose id isn't a real one (a pending
 * insert's placeholder) are skipped — the caller inserts those with the
 * derived value itself.
 */
function splitResyncStatements(afterRows, isRealId = (id) => id < PENDING_ID_BASE) {
  const { splitUnits } = walkLedger(afterRows);
  const stored = new Map(afterRows.filter(r => r.type === 'SPLIT').map(r => [r.id, Number(r.quantity) || 0]));
  const statements = [];
  for (const [id, units] of splitUnits) {
    if (!isRealId(id)) continue;
    if (Math.abs((stored.get(id) ?? 0) - units) > SHARE_EPSILON) {
      statements.push({ sql: 'UPDATE transactions SET quantity = ? WHERE id = ?', args: [units, id] });
    }
  }
  return statements;
}

/** Load the unit-moving rows for one position. */
async function loadPositionRows(db, portfolioId, ticker) {
  const rows = await db.all(
    `SELECT id, type, quantity, date, split_ratio FROM transactions
      WHERE portfolio_id = ? AND ticker = ? AND type IN (${SHARE_TYPES.map(() => '?').join(',')})`,
    portfolioId, ticker, ...SHARE_TYPES,
  );
  return rows.map(toLedgerRow);
}

/** Normalize a DB row into the shape the walk expects. */
function toLedgerRow(r) {
  return {
    id: Number(r.id),
    type: r.type,
    quantity: Number(r.quantity) || 0,
    date: r.date,
    split_ratio: r.split_ratio == null ? null : Number(r.split_ratio),
  };
}

/** Placeholder ids for rows not yet inserted: above any real id, in order. */
const PENDING_ID_BASE = Number.MAX_SAFE_INTEGER - 1e6;

module.exports = {
  SHARE_TYPES,
  PENDING_ID_BASE,
  compareLedgerOrder,
  walkLedger,
  walkSellCoverage,
  newlyUncoveredSell,
  uncoveredSellMessage,
  splitResyncStatements,
  loadPositionRows,
  toLedgerRow,
};
