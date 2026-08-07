'use strict';

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // RFC 4180: a doubled quote inside a quoted field is a literal quote.
      // Without this, `"He said ""hi"", ok"` loses both quote characters and,
      // worse, an odd quote count leaves inQuotes stuck true so every
      // remaining field merges into one.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04',
  may: '05', jun: '06', jul: '07', aug: '08',
  sep: '09', oct: '10', nov: '11', dec: '12'
};

/** True when y-m-d is a real calendar date (rejects 2024-02-30, 2024-13-01, …). */
function isRealDate(year, month, day) {
  const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return d.getUTCFullYear() === Number(year)
    && d.getUTCMonth() === Number(month) - 1
    && d.getUTCDate() === Number(day);
}

/**
 * Parse a CSV date into `YYYY-MM-DD`, or return null when it cannot be
 * understood.
 *
 * Returning null (rather than guessing) is deliberate: this previously
 * defaulted an unrecognized month to '01', so `15-Sept-2024` and `15-mar-2024`
 * both silently became 2024-01-15 — a September dividend booked as January
 * income, with no error surfaced to the user. Callers must treat null as a
 * row-level error.
 */
function parseDate(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const raw = dateStr.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-');
    return isRealDate(y, m, d) ? raw : null;
  }

  const parts = raw.split('-');
  if (parts.length !== 3) return null;

  const day = parts[0].trim().padStart(2, '0');
  if (!/^\d{2}$/.test(day)) return null;

  // Accept any case and longer forms ("Sept", "SEPTEMBER") by folding to the
  // canonical 3-letter key; reject anything that still isn't a known month.
  const month = MONTHS[parts[1].trim().slice(0, 3).toLowerCase()];
  if (!month) return null;

  let year = parts[2].trim();
  if (!/^\d{2}$/.test(year) && !/^\d{4}$/.test(year)) return null;
  if (year.length === 2) {
    year = parseInt(year, 10) < 50 ? '20' + year : '19' + year;
  }

  return isRealDate(year, month, day) ? `${year}-${month}-${day}` : null;
}

module.exports = { parseCSVLine, parseDate };
