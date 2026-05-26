'use strict';

const FREQ_MAP = { Monthly: 12, Quarterly: 4, 'Semi-Annual': 2, Annual: 1 };

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

    const totalReturn  = marketValue + saleTotal + divPaid - buyTotal;
    // ACB includes commission; buy_price (avg share price) excludes it
    const acb          = sharesBought > 0 ? (buyTotal + buyExpense) * (shares / sharesBought) : 0;
    const acbPerShare  = sharesBought > 0 ? buyTotal / sharesBought : 0;
    const returnPct    = acb > 0 ? (totalReturn / acb) * 100 : 0;

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
      annualPayout = nextPayout * multiplier;
      divPerShare  = storedPerShare;
      divYield     = marketValue > 0 ? (annualPayout / marketValue) * 100 : 0;
    }

    const totalExpense = buyExpense + saleExpense;
    const proceeds     = saleTotal - saleExpense;

    return {
      portfolio_code:     h.portfolio_code || '',
      portfolio_name:     h.portfolio_name || '',
      ticker:             h.ticker,
      investment_type:    h.investment_type || '',
      sector:             h.sector || '',
      shares,
      buy_price:          acbPerShare,
      market_price:       marketPrice,
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

module.exports = { computeHoldings };
