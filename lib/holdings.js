'use strict';

/**
 * Shared holdings aggregation.
 *
 * This SQL is the single source of truth for how raw transaction rows are
 * rolled up into per-position aggregates before `computeHoldings` derives
 * return/ACB/yield from them. Both the server routes and the test suite build
 * their statements from here so the aggregation can never silently drift.
 */

// Net open-share count: BUY/DIVIDEND_REINVEST add shares, SELL subtracts.
// Single source of truth shared by the holdings aggregation (AS shares) and the
// price-refresh "held positions" filter, so the two can never disagree about
// what still counts as an open position. Assumes the transactions table is
// aliased `t`.
const NET_SHARES = `SUM(CASE WHEN t.type IN ('BUY','DIVIDEND_REINVEST') THEN t.quantity
               WHEN t.type = 'SELL' THEN -t.quantity ELSE 0 END)`;

const HOLDINGS_SQL = `
    SELECT
      p.code  AS portfolio_code,
      p.name  AS portfolio_name,
      t.ticker,
      ${NET_SHARES} AS shares,
      SUM(CASE WHEN t.type IN ('BUY','DIVIDEND_REINVEST') THEN t.quantity ELSE 0 END) AS shares_bought,
      SUM(CASE WHEN t.type = 'SELL' THEN t.quantity ELSE 0 END) AS shares_sold,
      SUM(CASE WHEN t.type IN ('BUY','DIVIDEND_REINVEST') THEN t.total ELSE 0 END) AS buy_total,
      SUM(CASE WHEN t.type = 'SELL' THEN t.total ELSE 0 END) AS sale_total,
      SUM(CASE WHEN t.type = 'DIVIDEND' THEN t.total ELSE 0 END) AS dividends_paid,
      SUM(CASE WHEN t.type IN ('BUY','DIVIDEND_REINVEST') THEN t.total ELSE 0 END) /
        NULLIF(SUM(CASE WHEN t.type IN ('BUY','DIVIDEND_REINVEST') THEN t.quantity ELSE 0 END), 0) AS buy_price,
      SUM(CASE WHEN t.type = 'SELL' THEN t.total ELSE 0 END) /
        NULLIF(SUM(CASE WHEN t.type = 'SELL' THEN t.quantity ELSE 0 END), 0) AS sale_price,
      COUNT(CASE WHEN t.type IN ('BUY','DIVIDEND_REINVEST') THEN 1 END) AS buy_count,
      COUNT(CASE WHEN t.type = 'SELL' THEN 1 END) AS sell_count,
      SUM(CASE WHEN t.type IN ('BUY','DIVIDEND_REINVEST') THEN COALESCE(t.commission,0) ELSE 0 END) AS buy_expense,
      SUM(CASE WHEN t.type = 'SELL' THEN COALESCE(t.commission,0) ELSE 0 END) AS sale_expense,
      s.market_price,
      s.dividend_yield,
      s.dividend_frequency,
      s.dividend_per_share,
      s.last_dividend_date,
      s.next_dividend_date,
      s.sector,
      s.investment_type
    FROM transactions t
    JOIN portfolios p ON t.portfolio_id = p.id
    LEFT JOIN stock_info s ON s.portfolio_id = t.portfolio_id AND s.ticker = t.ticker`;

// Fractional shares (DRIP) leave IEEE-754 residue when a position is closed:
// 0.1 + 0.2 - 0.3 is 5.55e-17, not 0, so a `> 0` test keeps a fully-sold
// position alive as a phantom holding with a near-zero ACB and an absurd
// return percentage. SHARE_EPSILON is well below any real holding (brokerages
// report at most ~6 decimal places) and well above the residue.
const SHARE_EPSILON = 1e-9;

const GROUP_ORDER = `GROUP BY t.portfolio_id, t.ticker HAVING shares > ${SHARE_EPSILON} ORDER BY p.display_order, p.code, t.ticker`;

/**
 * Prepare the holdings statements against a database connection.
 * Returns a `query(portfolioId)` helper: pass a portfolio id for a single
 * portfolio, or a falsy value for all portfolios combined.
 */
function prepareHoldings(db) {
  const allSql = `${HOLDINGS_SQL} ${GROUP_ORDER}`;
  const byPortfolioSql = `${HOLDINGS_SQL} WHERE t.portfolio_id = ? ${GROUP_ORDER}`;
  return {
    async query(portfolioId) {
      return portfolioId ? db.all(byPortfolioSql, portfolioId) : db.all(allSql);
    },
  };
}

module.exports = { HOLDINGS_SQL, GROUP_ORDER, NET_SHARES, SHARE_EPSILON, prepareHoldings };
