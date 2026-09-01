export const fmtCurrency = v =>
  v == null ? '—' : '$' + Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Whole-dollar display that truncates (never rounds) the cents.
export const fmtCurrencyTrim = v =>
  v == null ? '—' : '$' + Math.trunc(Number(v)).toLocaleString('en-CA');

export const fmtPrice = v =>
  v == null ? '—' : '$' + Number(v).toLocaleString('en-CA', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export const fmtCurrencyOr = v => (v && v !== 0) ? fmtCurrency(v) : '—';

export const fmtPct = v => v != null ? v.toFixed(2) + '%' : '—';

export const retClass = v => v >= 0 ? 'positive' : 'negative';

const FREQ_CODE = { Monthly: 'M', Quarterly: 'Q', 'Semi-Annual': 'S', Annual: 'A' };
export const fmtFreqCode = f => FREQ_CODE[f] || '—';

const INVESTMENT_TYPE_LABEL = { S: 'Stock', E: 'ETF', X: 'Other' };
export const fmtInvestmentType = t => INVESTMENT_TYPE_LABEL[t] || t;

// Flags a share quantity that isn't a clean multiple of 0.0001 — e.g. an
// unrounded DRIP reinvest amount (dividend / price, never rounded on save)
// surfacing as a holdings total like 0.58824383739999999.
export const isUnroundedQty = q => q > 0 && Math.abs(q - Math.round(q * 10000) / 10000) > 1e-9;
