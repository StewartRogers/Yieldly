'use strict';

const FREQ_MAP = { Monthly: 12, Quarterly: 4, 'Semi-Annual': 2, Annual: 1 };

/**
 * Running-average ACB, computed over transactions in chronological order.
 *
 * The aggregate holdings query SUMs everything up front, which throws away the
 * ordering — and `(buyTotal + buyExpense) * (shares / sharesBought)` only equals
 * average cost when every BUY precedes every SELL. After a buy→sell→buy
 * sequence it retroactively re-averages the sold lot's cost back into the
 * shares still held, understating the basis. So ACB has to be walked in order:
 *
 *   BUY / DRIP  →  acb += total + commission;  shares += qty
 *   SELL        →  acb -= acb * (qty / shares); shares -= qty
 *
 * `cost` tracks the same running average excluding commission, because
 * `buy_price` (average share price) is quoted ex-commission while ACB includes
 * it. Both scale by the same fraction on a sell.
 *
 * Expects rows ordered by date then id, of type BUY / DIVIDEND_REINVEST / SELL.
 * Returns a Map keyed `portfolio_id:ticker`.
 */
function computeRunningACB(txRows) {
  const state = new Map();
  for (const tx of txRows || []) {
    const key = `${tx.portfolio_id}:${tx.ticker}`;
    let s = state.get(key);
    if (!s) state.set(key, (s = { acb: 0, cost: 0, shares: 0 }));

    const qty = tx.quantity || 0;
    if (tx.type === 'BUY' || tx.type === 'DIVIDEND_REINVEST') {
      s.cost   += tx.total || 0;
      s.acb    += (tx.total || 0) + (tx.commission || 0);
      s.shares += qty;
    } else if (tx.type === 'SELL' && s.shares > 0) {
      // Clamp: an over-sell (only reachable via CSV import, which bypasses the
      // POST /api/transactions share-count guard) must not drive ACB negative.
      const sold = Math.min(qty, s.shares);
      const kept = 1 - sold / s.shares;
      s.acb    *= kept;
      s.cost   *= kept;
      s.shares -= sold;
    }
  }
  return state;
}

/**
 * Attach the order-aware `acb` / `acb_per_share` to pre-aggregated holdings
 * rows, so `computeHoldings` can use them instead of the order-blind proration.
 * Both callers of the holdings aggregation (the async server and the sync test
 * harnesses) go through here, so the two can't drift.
 */
function applyRunningACB(rows, txRows) {
  const state = computeRunningACB(txRows);
  for (const row of rows) {
    const s = state.get(`${row.portfolio_id}:${row.ticker}`);
    if (!s) continue;
    row.acb = s.acb;
    row.acb_per_share = s.shares > 0 ? s.cost / s.shares : 0;
  }
  return rows;
}

/**
 * Pure function: takes raw DB rows from queryHoldings and returns
 * fully-computed holding objects. No database dependency.
 */
function computeHoldings(rows) {
  return rows.map(h => {
    const shares       = h.shares        || 0;
    const buyTotal     = h.buy_total     || 0;
    const saleTotal    = h.sale_total    || 0;
    const divPaid      = h.dividends_paid || 0;
    const buyExpense   = h.buy_expense   || 0;
    const saleExpense  = h.sale_expense  || 0;
    const sharesBought = h.shares_bought || 0;
    const marketPrice  = h.market_price  || 0;
    const marketValue  = shares * marketPrice;
    // stock_info.market_price defaults to 0 (never fetched yet), and a
    // holding with no stock_info row at all comes through as null via the
    // LEFT JOIN — both mean "we don't know the price," not "it's worth $0."
    const priceKnown   = h.market_price != null && h.market_price > 0;

    // Commissions are real cost, and ACB (this return's own denominator)
    // already includes buy commission — but the numerator ignored commission
    // entirely, both the buy side (never subtracted) and the sell side (used
    // gross saleTotal instead of net proceeds). That understated cost while
    // fully counting proceeds, inflating both the dollar return and the %.
    const totalExpense = buyExpense + saleExpense;
    // A currently-held position (shares > 0) with an unknown price has an
    // unknowable return — null, not the -100% that `0 - buyTotal` would
    // produce. (shares === 0 has no such ambiguity: every term is legitimately
    // 0 regardless of price, so it's excluded from this guard.)
    const totalReturn  = (!priceKnown && shares > 0)
      ? null
      : (marketValue + saleTotal + divPaid - buyTotal - totalExpense);
    // ACB includes commission; buy_price (avg share price) excludes it.
    // `applyRunningACB` supplies the order-aware values; the all-time proration
    // below is only a fallback for rows built without a transaction feed (it
    // agrees whenever every BUY precedes every SELL).
    const acb          = h.acb != null
      ? h.acb
      : (sharesBought > 0 ? (buyTotal + buyExpense) * (shares / sharesBought) : 0);
    const acbPerShare  = h.acb_per_share != null
      ? h.acb_per_share
      : (sharesBought > 0 ? buyTotal / sharesBought : 0);
    const returnPct    = totalReturn == null ? null : (acb > 0 ? (totalReturn / acb) * 100 : 0);

    const divFreq      = h.dividend_frequency || '';
    const multiplier   = FREQ_MAP[divFreq] || 0;
    const storedYield  = h.dividend_yield;
    const storedPerShare = h.dividend_per_share || 0;

    let annualPayout, nextPayout, divPerShare, divYield;
    if (storedYield != null && storedYield > 0 && marketValue > 0) {
      annualPayout = marketValue * storedYield / 100;
      nextPayout   = multiplier > 0 ? annualPayout / multiplier : 0;
      divPerShare  = (shares > 0 && multiplier > 0) ? nextPayout / shares : 0;
      divYield     = storedYield;
    } else {
      nextPayout   = shares * storedPerShare;
      divPerShare  = storedPerShare;
      if (multiplier > 0) {
        annualPayout = nextPayout * multiplier;
        divYield     = marketValue > 0 ? (annualPayout / marketValue) * 100 : 0;
      } else {
        // Frequency is missing/unrecognized, so there's no way to annualize a
        // per-payment amount — we don't know how many payments happen a year.
        // Reporting $0/0% here (as if this pays nothing) would contradict the
        // nonzero `next_payout` shown right next to it on the Dividends page.
        // Only report "genuinely zero" (0, not null) when there's no known
        // per-share amount either — the ordinary non-dividend-payer case.
        annualPayout = nextPayout > 0 ? null : 0;
        divYield     = nextPayout > 0 ? null : 0;
      }
    }

    const proceeds = saleTotal - saleExpense;

    return {
      portfolio_code:     h.portfolio_code || '',
      portfolio_name:     h.portfolio_name || '',
      ticker:             h.ticker,
      investment_type:    h.investment_type || '',
      sector:             h.sector || '',
      shares,
      buy_price:          acbPerShare,
      market_price:       marketPrice,
      price_known:        priceKnown,
      sale_price:         h.sale_price || 0,
      buy_total:          buyTotal,
      market_value:       marketValue,
      sale_total:         saleTotal,
      dividends_paid:     divPaid,
      return:             totalReturn,
      return_percent:     returnPct,
      dividend_frequency: divFreq,
      dividend_per_share: divPerShare,
      last_dividend_date: h.last_dividend_date || '',
      next_dividend_date: h.next_dividend_date || '',
      next_payout:        nextPayout,
      annual_payout:      annualPayout,
      dividend_yield:     divYield,
      buy_count:          h.buy_count  || 0,
      sell_count:         h.sell_count || 0,
      buy_expense:        buyExpense,
      sale_expense:       saleExpense,
      total_expense:      totalExpense,
      proceeds,
      acb
    };
  });
}

module.exports = { computeHoldings, computeRunningACB, applyRunningACB };
