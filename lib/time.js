'use strict';

/**
 * The app's one timezone. Everything about *the user*: what "today" is,
 * which month is current, and the times shown in logs. It all uses
 * APP_TIMEZONE, so the answer doesn't depend on the server's own clock
 * (UTC on Vercel, the Pi's local zone in dev).
 *
 * Default: America/Vancouver. Since 1 Nov 2026 B.C. keeps a single year-round
 * standard, Pacific Time (PCT), at UTC−7. Not America/Los_Angeles, which still
 * falls back to UTC−8 in winter.
 *
 * The display label is configured separately (APP_TIMEZONE_LABEL, default
 * "PCT") rather than taken from Intl's `timeZoneName`. Depending on the
 * runtime's tzdata that comes out as "MST", "GMT-7" or a stale "PST", and none
 * of those is the right name for B.C. time.
 *
 * Exchange trading days are a separate concept and deliberately stay on
 * MARKET_TIMEZONE (New York), e.g. the snapshot cron's date label.
 *
 * Keep in sync with client/src/utils/time.js (same env vars, read via Vite).
 */

const DEFAULT_TIMEZONE = 'America/Vancouver';
const DEFAULT_TIMEZONE_LABEL = 'PCT';
const MARKET_TIMEZONE = 'America/New_York';

/** Throws a RangeError at load time for a typo'd zone, rather than on first use. */
function assertValidTimeZone(timeZone) {
  new Intl.DateTimeFormat('en-CA', { timeZone });
  return timeZone;
}

const APP_TIMEZONE = assertValidTimeZone(process.env.APP_TIMEZONE || DEFAULT_TIMEZONE);
const APP_TIMEZONE_LABEL = process.env.APP_TIMEZONE_LABEL || DEFAULT_TIMEZONE_LABEL;

const formatters = new Map();
function partsFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      // h23, not hour12:false: some ICU builds render midnight as "24".
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }));
  }
  return formatters.get(timeZone);
}

/** Wall-clock fields of `date` in `timeZone`, as numbers (month is 1-12). */
function zonedParts(date = new Date(), timeZone = APP_TIMEZONE) {
  const out = {};
  for (const { type, value } of partsFormatter(timeZone).formatToParts(date)) {
    if (type !== 'literal') out[type] = Number(value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, second: out.second };
}

const pad = (n) => String(n).padStart(2, '0');

/** Calendar date (YYYY-MM-DD) of `date` in `timeZone`. */
function todayInZone(date = new Date(), timeZone = APP_TIMEZONE) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Today in `timeZone`, as a Date whose *server-local* getFullYear()/getMonth()/
 * getDate() are that calendar date. This is for code that reads those local
 * getters, such as lib/dividends.js and computeMonthlyACB. Set to noon so a
 * server zone with a DST change at midnight can't roll it to another day.
 */
function todayAsLocalDate(date = new Date(), timeZone = APP_TIMEZONE) {
  const p = zonedParts(date, timeZone);
  return new Date(p.year, p.month - 1, p.day, 12);
}

/** "2026-11-11 13:35:45 PCT" */
function formatTimestamp(date = new Date(), timeZone = APP_TIMEZONE, label = APP_TIMEZONE_LABEL) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} ${label}`;
}

/** console.* with a timestamp in the app's zone, so logs read in B.C. time wherever they're viewed. */
const log = {
  info: (...args) => console.log(`[${formatTimestamp()}]`, ...args),
  warn: (...args) => console.warn(`[${formatTimestamp()}]`, ...args),
  error: (...args) => console.error(`[${formatTimestamp()}]`, ...args),
};

/**
 * True when this runtime's tzdata knows B.C.'s year-round UTC−7. An older ICU
 * bundled with Node, or an older browser, still applies the old winter
 * fall-back to UTC−8, which would make "today" wrong for an hour after
 * midnight all winter. 2027-01-15 07:30Z is 00:30 on the 15th at UTC−7 and
 * 23:30 on the 14th at UTC−8.
 */
function hasCurrentBCTimeZoneData() {
  return todayInZone(new Date('2027-01-15T07:30:00Z'), 'America/Vancouver') === '2027-01-15';
}

/** Startup warning (entrypoints only; createApp stays side-effect free). */
function warnIfStaleTimeZoneData() {
  if (APP_TIMEZONE === 'America/Vancouver' && !hasCurrentBCTimeZoneData()) {
    log.warn(`WARNING: this Node runtime's timezone data predates B.C.'s year-round UTC−7 (tz ${process.versions.tz ?? 'unknown'}). Winter dates will be computed at UTC−8. Upgrade Node.`);
  }
}

module.exports = {
  APP_TIMEZONE,
  APP_TIMEZONE_LABEL,
  MARKET_TIMEZONE,
  zonedParts,
  todayInZone,
  todayAsLocalDate,
  formatTimestamp,
  hasCurrentBCTimeZoneData,
  warnIfStaleTimeZoneData,
  log,
};
