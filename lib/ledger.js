'use strict';

const { SHARE_EPSILON } = require('./holdings');

// Date-aware share coverage for one position (portfolio + ticker).
//
// The write routes used to check a SELL against the *current* net share count,
// with no regard to dates. That let two kinds of change through that leave the
// ledger with a SELL of shares that weren't held on its date:
//   - a backdated SELL (BUY 100 on 2025-06-01, then SELL 50 dated 2025-01-01);
//   - deleting, shrinking, re-dating or moving a BUY that a later SELL relied on.
// computeRunningACB (lib/compute.js) walks the same rows in (date, id) order and
// skips/clamps a SELL with nothing to sell against, so ACB silently stays at the
// full pre-sale basis — return % is understated and cash_invested overstated.
//
// The walk below mirrors computeRunningACB's order and clamping exactly, and
// totals each SELL's uncovered quantity. Callers compare that total before and
// after a proposed change and reject only if the change makes it worse, so a
// ledger that already holds legacy bad rows isn't frozen: unrelated edits to
// that position still go through.

const SHARE_ADDING = new Set(['BUY', 'DIVIDEND_REINVEST']);

/** Types that move a position's share count — the only rows the walk needs. */
const SHARE_TYPES = ['BUY', 'DIVIDEND_REINVEST', 'SELL'];

function byDateThenId(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.id - b.id;
}

/**
 * Walk one position's rows in (date, id) order. Returns the total uncovered
 * SELL quantity and the first SELL that was short, for the error message.
 *
 * @param {Array<{id:number, type:string, quantity:number, date:string}>} rows
 */
function walkSellCoverage(rows) {
  const sorted = [...rows].sort(byDateThenId);
  let shares = 0;
  let shortfall = 0;
  let firstShort = null;
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
    }
  }
  return { shortfall, firstShort };
}

/**
 * Compare a position's rows before and after a proposed change. Returns null
 * when the change leaves no more uncovered SELL quantity than there was before,
 * or `{ date, quantity, held }` describing the first SELL left short.
 */
function newlyUncoveredSell(beforeRows, afterRows) {
  const before = walkSellCoverage(beforeRows);
  const after = walkSellCoverage(afterRows);
  if (after.shortfall <= before.shortfall + SHARE_EPSILON) return null;
  return after.firstShort;
}

/** User-facing message for a newlyUncoveredSell() result. */
function uncoveredSellMessage(ticker, short) {
  const held = Math.round(short.held * 1e6) / 1e6;
  return `This would leave the SELL of ${short.quantity} ${ticker} on ${short.date} uncovered — only ${held} shares were held on that date`;
}

/** Load the share-moving rows for one position. */
async function loadPositionRows(db, portfolioId, ticker) {
  const rows = await db.all(
    `SELECT id, type, quantity, date FROM transactions
      WHERE portfolio_id = ? AND ticker = ? AND type IN (${SHARE_TYPES.map(() => '?').join(',')})`,
    portfolioId, ticker, ...SHARE_TYPES,
  );
  return rows.map(r => ({ id: Number(r.id), type: r.type, quantity: Number(r.quantity) || 0, date: r.date }));
}

module.exports = {
  SHARE_TYPES,
  walkSellCoverage,
  newlyUncoveredSell,
  uncoveredSellMessage,
  loadPositionRows,
};
