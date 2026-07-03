// Pure aggregation math for the History page's value matrix. No React/DOM
// dependency, so this is unit-tested directly from test-history.js at the
// repo root (see that file for why: it's the only client-side logic with
// real edge cases — Jan-wraps to prior Dec, missing months, div-by-zero,
// current-year YTD walk-back).

// Per-portfolio pivot: {year: {month: {value, date, source}}} — each cell is
// the LATEST snapshot dated within that year-month (not carried forward from
// a prior month), so a month with no data renders blank. This single rule
// gives end-of-month values for closed months and "latest so far" for the
// current month, with no special-casing.
export function buildPivot(rows) {
  const pivot = {}
  for (const r of rows) {
    const [y, m] = r.date.split('-').map(Number)
    if (!pivot[y]) pivot[y] = {}
    const existing = pivot[y][m]
    if (!existing || r.date > existing.date) {
      pivot[y][m] = { value: r.total_value, date: r.date, source: r.source }
    }
  }
  return pivot
}

// Sum per-portfolio pivots cell-wise for the "All" view. A portfolio with no
// data for a given month simply contributes 0 to that month's total.
export function sumPivots(pivots) {
  const all = {}
  pivots.forEach(pivot => {
    Object.entries(pivot).forEach(([y, months]) => {
      if (!all[y]) all[y] = {}
      Object.entries(months).forEach(([m, cell]) => {
        if (!all[y][m]) all[y][m] = { value: 0, date: null, source: 'mixed' }
        all[y][m].value += cell.value
        if (!all[y][m].date || cell.date > all[y][m].date) all[y][m].date = cell.date
      })
    })
  })
  return all
}

export function pivotValue(pivot, year, month) {
  return pivot?.[year]?.[month]?.value ?? null
}

// Month-over-month % change for `year`/`month`, looking back to December of
// the prior year when `month` is January.
export function momChange(pivot, year, month) {
  const cur = pivotValue(pivot, year, month)
  const prevYear  = month === 1 ? year - 1 : year
  const prevMonth = month === 1 ? 12 : month - 1
  const prev = pivotValue(pivot, prevYear, prevMonth)
  if (cur == null || prev == null || prev === 0) return null
  return ((cur - prev) / prev) * 100
}

// Year-end value for closed years; latest-so-far (YTD) value for `currentYear`.
export function yearTotal(pivot, year, currentYear, currentMonth) {
  if (year < currentYear) return pivotValue(pivot, year, 12)
  // Current year: walk back from the current month to the latest snapshot on
  // record, so a month with no data yet still shows the last known YTD value.
  for (let m = currentMonth; m >= 1; m--) {
    const v = pivotValue(pivot, year, m)
    if (v != null) return v
  }
  return null
}

// Year-over-year % change for `year` vs the year before it.
export function yoyChange(pivot, year, currentYear, currentMonth) {
  const cur  = yearTotal(pivot, year, currentYear, currentMonth)
  const prev = yearTotal(pivot, year - 1, currentYear, currentMonth)
  if (cur == null || prev == null || prev === 0) return null
  return ((cur - prev) / prev) * 100
}
