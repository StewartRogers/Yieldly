export const fmtCurrency = v =>
  v == null ? '—' : '$' + Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtPrice = v =>
  v == null ? '—' : '$' + Number(v).toLocaleString('en-CA', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export const fmtCurrencyOr = v => (v && v !== 0) ? fmtCurrency(v) : '—';

export const fmtPct = v => v != null ? v.toFixed(2) + '%' : '—';

export const retClass = v => v >= 0 ? 'positive' : 'negative';
