'use strict';

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
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

function parseDate(dateStr) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const months = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const day   = parts[0].padStart(2, '0');
  const month = months[parts[1]] || '01';
  let year    = parts[2];
  if (year.length === 2) {
    year = parseInt(year) < 50 ? '20' + year : '19' + year;
  }
  return `${year}-${month}-${day}`;
}

module.exports = { parseCSVLine, parseDate };
