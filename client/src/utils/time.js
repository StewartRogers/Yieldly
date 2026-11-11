// The app's one timezone, so dates and times read in B.C. Pacific Time (PCT,
// year-round UTC−7) whatever timezone the device happens to be in.
// Mirrors lib/time.js on the server and reads the same APP_TIMEZONE /
// APP_TIMEZONE_LABEL variables (exposed by vite.config.js from the repo-root
// .env, or from the Vercel project's env at build time).
//
// The label is fixed config rather than Intl's `timeZoneName`, which can
// render B.C. time as "MST", "GMT-7" or a stale "PST".

export const APP_TIMEZONE = import.meta.env.APP_TIMEZONE || 'America/Vancouver'
export const APP_TIMEZONE_LABEL = import.meta.env.APP_TIMEZONE_LABEL || 'PCT'

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
})

/** { year, month (1-12), day } of `date` in APP_TIMEZONE. */
export function zonedDateParts(date = new Date()) {
  const out = {}
  for (const { type, value } of partsFmt.formatToParts(date)) {
    if (type !== 'literal') out[type] = Number(value)
  }
  return { year: out.year, month: out.month, day: out.day }
}

const pad = (n) => String(n).padStart(2, '0')

/** Today's date (YYYY-MM-DD) in APP_TIMEZONE. Use this for date inputs and filenames, not toISOString() (UTC). */
export function todayInZone(date = new Date()) {
  const { year, month, day } = zonedDateParts(date)
  return `${year}-${pad(month)}-${pad(day)}`
}

/** "1:35 p.m. PCT" */
export function fmtTimeInZone(date) {
  const t = date.toLocaleTimeString('en-CA', { timeZone: APP_TIMEZONE, hour: 'numeric', minute: '2-digit' })
  return `${t} ${APP_TIMEZONE_LABEL}`
}

/**
 * Calendar date (YYYY-MM-DD) in APP_TIMEZONE of a SQLite CURRENT_TIMESTAMP
 * value ("YYYY-MM-DD HH:MM:SS", stored in UTC with no zone marker). Slicing
 * the string gives the UTC date, which is already tomorrow from 5 pm PCT.
 */
export function sqliteUtcToZoneDate(value) {
  if (!value) return ''
  const d = parseSqliteUtc(value)
  return d ? todayInZone(d) : String(value).slice(0, 10)
}

/** SQLite CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", UTC, no zone marker) → Date, or null. */
function parseSqliteUtc(value) {
  if (!value) return null
  const s = String(value)
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * "2026-11-11 1:35 p.m.": date and time in APP_TIMEZONE of a SQLite UTC
 * timestamp, without the zone label (put APP_TIMEZONE_LABEL in the column
 * header instead of repeating it per row). Empty string when missing.
 */
export function fmtSqliteUtcDateTime(value) {
  const d = parseSqliteUtc(value)
  if (!d) return ''
  const t = d.toLocaleTimeString('en-CA', { timeZone: APP_TIMEZONE, hour: 'numeric', minute: '2-digit' })
  return `${todayInZone(d)} ${t}`
}

/** Whole days from today (APP_TIMEZONE) to a YYYY-MM-DD date; negative if past. */
export function daysFromToday(dateStr) {
  const [ty, tm, td] = todayInZone().split('-').map(Number)
  const [y, m, d] = dateStr.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000)
}
