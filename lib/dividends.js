'use strict';

// Same four frequency strings the client's stock-info form uses (see
// FREQ_MAP in lib/compute.js), expressed as a payment interval in months.
const INTERVAL_MONTHS = { Monthly: 1, Quarterly: 3, 'Semi-Annual': 6, Annual: 12 };

/**
 * Guesstimate the next dividend date from a just-logged payment date and the
 * stock's dividend frequency. Returns null if the frequency is missing/unknown
 * or the payment date doesn't parse.
 */
function guessNextDividendDate(paymentDateStr, frequency) {
  const months = INTERVAL_MONTHS[frequency];
  if (!months || !paymentDateStr) return null;
  const d = new Date(`${paymentDateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * TMX often doesn't roll its own pay-date forward for days/weeks after a
 * payment, so a TMX-reported date is only trustworthy once it's clearly in
 * the future. Reject anything historical or within `graceDays` of today and
 * keep the existing guesstimate instead.
 */
function shouldAcceptTmxDate(tmxDateStr, today = new Date(), graceDays = 3) {
  if (!tmxDateStr) return false;
  const tmxDate = new Date(`${tmxDateStr}T00:00:00Z`);
  if (Number.isNaN(tmxDate.getTime())) return false;
  // Read today's calendar date from local wall-clock fields (matching how
  // callers construct `today`), then do the +graceDays roll entirely in UTC so
  // it can't drift against tmxDate's UTC-midnight parse across DST/offsets.
  const cutoff = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  cutoff.setUTCDate(cutoff.getUTCDate() + graceDays);
  return tmxDate.getTime() > cutoff.getTime();
}

module.exports = { INTERVAL_MONTHS, guessNextDividendDate, shouldAcceptTmxDate };
