import { useState, useEffect, useCallback } from 'react'
import { getDividendsMonthly, getUpcomingDividends, backfillDividendFrequency } from '../api/client'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const PER_PAGE = 15

// Keep in sync with INTERVAL_MONTHS in lib/dividends.js — same frequency strings.
const INTERVAL_MONTHS = { Monthly: 1, Quarterly: 3, 'Semi-Annual': 6, Annual: 12 }

function fmtNextDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysAway(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(`${dateStr}T00:00:00`)
  return Math.round((target - today) / 86400000)
}

function fmtDaysAway(n) {
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n < 0) return `${Math.abs(n)}d overdue`
  return `in ${n} days`
}

function UpcomingDividends({ data }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Portfolio</th>
            <th>Next payment</th>
            <th>Days away</th>
            <th className="num">Per share</th>
            <th className="num">Expected amount</th>
            <th>Frequency</th>
          </tr>
        </thead>
        <tbody>
          {data.map(h => {
            const n = daysAway(h.next_dividend_date)
            return (
              <tr key={`${h.portfolio_code}-${h.ticker}`}>
                <td>{h.ticker}</td>
                <td>{h.portfolio_name || h.portfolio_code}</td>
                <td>{fmtNextDate(h.next_dividend_date)}</td>
                <td>
                  <span className={n <= 7 ? 'tag-new' : 'dim'} style={n <= 7 ? { margin: 0 } : undefined}>
                    {fmtDaysAway(n)}
                  </span>
                </td>
                <td className="num">{fmtDiv(h.dividend_per_share)}</td>
                <td className="num">{fmtDiv(h.next_payout)}</td>
                <td>{h.dividend_frequency || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Pager({ page, totalPages, totalCount, onChange }) {
  if (totalPages <= 1) return null
  const pages = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else if (page <= 4) {
    pages.push(1, 2, 3, 4, 5, '…', totalPages)
  } else if (page >= totalPages - 3) {
    pages.push(1, '…', totalPages-4, totalPages-3, totalPages-2, totalPages-1, totalPages)
  } else {
    pages.push(1, '…', page-1, page, page+1, '…', totalPages)
  }
  return (
    <div className="row between" style={{ padding: '14px 20px' }}>
      <span className="muted-txt" style={{ fontSize: 12.5 }}>
        Showing <span className="num">{(page-1)*PER_PAGE+1}–{Math.min(page*PER_PAGE, totalCount)}</span> of <span className="num">{totalCount}</span>
      </span>
      <div className="pager">
        <button onClick={() => onChange(page-1)} disabled={page===1}>‹</button>
        {pages.map((p, i) =>
          typeof p === 'number'
            ? <button key={i} className={p === page ? 'active' : ''} onClick={() => onChange(p)}>{p}</button>
            : <span key={i} style={{ padding: '0 4px', color: 'var(--faint)' }}>…</span>
        )}
        <button onClick={() => onChange(page+1)} disabled={page===totalPages}>›</button>
      </div>
    </div>
  )
}

function fmtDiv(v) {
  return v > 0
    ? '$' + v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'
}

function fmtKPI(v) {
  return v > 0 ? '$' + Math.round(v).toLocaleString('en-CA') : '—'
}

// Walks each holding's next scheduled payment forward by its dividend
// frequency, bucketing the (guesstimated) amount into whichever target
// {year, month} it lands in. Holdings with no known frequency only ever
// contribute their single next_dividend_date, not a projected series.
function projectedByMonth(data, targetMonths) {
  const totals = targetMonths.map(() => 0)
  const windowEnd = targetMonths[targetMonths.length - 1]

  data.forEach(h => {
    if (!h.next_dividend_date || !(h.next_payout > 0)) return
    const interval = INTERVAL_MONTHS[h.dividend_frequency]
    const d = new Date(`${h.next_dividend_date}T00:00:00`)

    while (d.getFullYear() < windowEnd.year ||
          (d.getFullYear() === windowEnd.year && d.getMonth() + 1 <= windowEnd.month)) {
      const idx = targetMonths.findIndex(m => m.year === d.getFullYear() && m.month === d.getMonth() + 1)
      if (idx !== -1) totals[idx] += h.next_payout
      if (!interval) break
      d.setMonth(d.getMonth() + interval)
    }
  })

  return totals
}

function ProjectedDividends({ data }) {
  const today = new Date()
  const targetMonths = [0, 1, 2].map(offset => {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1)
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  })
  const totals = projectedByMonth(data, targetMonths)
  const labels = ['This month', 'Next month', 'In 2 months']

  return (
    <div className="kpis grid-3" style={{ marginBottom: 22 }}>
      {targetMonths.map((m, i) => (
        <div key={i} className="kpi">
          <div className="k">{labels[i]}</div>
          <div className="v num">{fmtKPI(totals[i])}</div>
          <div className="d">{MONTHS[m.month - 1]} {m.year} · projected</div>
        </div>
      ))}
    </div>
  )
}

function YoYCell({ prev, curr }) {
  if (curr > 0 && prev === 0) {
    return <span className="tag-new" style={{ margin: 0 }}>NEW</span>
  }
  if (curr > 0 && prev > 0) {
    const pct  = ((curr - prev) / prev) * 100
    const sign = pct >= 0 ? '▲' : '▼'
    return (
      <span className={`num ${pct >= 0 ? 'up' : 'down'}`}>
        {sign}{Math.abs(pct).toFixed(0)}%
      </span>
    )
  }
  return <span className="dim">—</span>
}

function KPIStrip({ data }) {
  const now         = new Date()
  const currentYear = now.getFullYear()

  const lookup = {}
  data.forEach(d => {
    if (!lookup[d.year]) lookup[d.year] = {}
    lookup[d.year][d.month] = (lookup[d.year][d.month] || 0) + d.total
  })

  const thisYear = lookup[currentYear] || {}
  const ttm      = Object.values(thisYear).reduce((s, v) => s + v, 0)

  const activeMths = Object.values(thisYear).filter(v => v > 0)
  const avgMonth   = activeMths.length ? ttm / activeMths.length : 0

  let bestMonth = 0, bestMonthLabel = ''
  Object.entries(thisYear).forEach(([m, v]) => {
    if (v > bestMonth) {
      bestMonth      = v
      bestMonthLabel = MONTHS[parseInt(m) - 1] + ' ' + currentYear
    }
  })

  const priorYears = Object.keys(lookup).map(Number).filter(y => y < currentYear)
  const newStreams  = Object.entries(thisYear)
    .filter(([m, v]) => v > 0 && priorYears.every(y => !(lookup[y]?.[parseInt(m)] > 0)))
    .length

  /* YoY vs prior year for TTM */
  const prevYear     = currentYear - 1
  const prevTtm      = Object.values(lookup[prevYear] || {}).reduce((s, v) => s + v, 0)
  const ttmYoYPct    = prevTtm > 0 ? ((ttm - prevTtm) / prevTtm) * 100 : null
  const ttmYoYSign   = ttmYoYPct != null ? (ttmYoYPct >= 0 ? '▲' : '▼') : null

  const kpis = [
    {
      label: 'This year (TTM)',
      value: fmtKPI(ttm),
      sub: ttmYoYPct != null
        ? <span className={ttmYoYPct >= 0 ? 'up' : 'down'}>{ttmYoYSign} {ttmYoYPct >= 0 ? '+' : ''}{ttmYoYPct.toFixed(0)}% vs prior</span>
        : null,
    },
    { label: 'Avg / month',  value: fmtKPI(avgMonth),  sub: 'across all accounts' },
    { label: 'Best month',   value: fmtKPI(bestMonth),  sub: bestMonthLabel || '—' },
    { label: 'New streams',  value: String(newStreams), sub: 'started this year' },
  ]

  return (
    <div className="kpis grid-4" style={{ marginBottom: 22 }}>
      {kpis.map(k => (
        <div key={k.label} className="kpi">
          <div className="k">{k.label}</div>
          <div className="v num">{k.value}</div>
          {k.sub && <div className="d">{k.sub}</div>}
        </div>
      ))}
    </div>
  )
}

function DividendMatrix({ data }) {
  if (!data.length) {
    return <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>No dividend data.</p>
  }

  const years    = [...new Set(data.map(d => d.year))].sort((a, b) => a - b).slice(-5)
  const lookup   = {}
  data.forEach(d => {
    if (!lookup[d.year]) lookup[d.year] = {}
    lookup[d.year][d.month] = (lookup[d.year][d.month] || 0) + d.total
  })

  const yearTotals = {}
  years.forEach(y => {
    yearTotals[y] = Object.values(lookup[y] || {}).reduce((s, v) => s + v, 0)
  })

  const currYear   = years[years.length - 1]
  const prevYear   = years.length >= 2 ? years[years.length - 2] : null
  const priorYears = years.filter(y => y < currYear)

  const isNew = (month) => {
    const v = lookup[currYear]?.[month] || 0
    return v > 0 && priorYears.every(y => !(lookup[y]?.[month] > 0))
  }

  return (
    <div className="tbl-wrap">
      <table className="tbl matrix">
        <thead>
          <tr>
            <th>Month</th>
            {years.map(y => <th key={y}>{y}</th>)}
            {prevYear && <th style={{ borderLeft: '1px solid var(--line)' }}>YoY</th>}
          </tr>
        </thead>
        <tbody>
          {MONTHS.map((label, i) => {
            const m         = i + 1
            const prev      = prevYear ? (lookup[prevYear]?.[m] || 0) : 0
            const curr      = lookup[currYear]?.[m] || 0
            const newStream = isNew(m)
            return (
              <tr key={label}>
                <td>{label}</td>
                {years.map(y => (
                  <td key={y} className="num">
                    {fmtDiv(lookup[y]?.[m] || 0)}
                    {y === currYear && newStream && (
                      <span className="tag-new">NEW</span>
                    )}
                  </td>
                ))}
                {prevYear && (
                  <td style={{ textAlign: 'right', borderLeft: '1px solid var(--line)' }}>
                    <YoYCell prev={prev} curr={curr} />
                  </td>
                )}
              </tr>
            )
          })}
          <tr className="total">
            <td>Annual total</td>
            {years.map(y => (
              <td key={y} className="num">{fmtDiv(yearTotals[y])}</td>
            ))}
            {prevYear && (
              <td style={{ textAlign: 'right', borderLeft: '1px solid var(--line)' }}>
                <YoYCell prev={yearTotals[prevYear] || 0} curr={yearTotals[currYear] || 0} />
              </td>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default function Dividends({ portfolios = [] }) {
  const [allData, setAllData]     = useState(null)
  const [upcoming, setUpcoming]   = useState(null)
  const [selected, setSelected]   = useState('ALL')
  const [page, setPage]           = useState(1)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillMsg, setBackfillMsg] = useState('')

  const [loadError, setLoadError] = useState('')

  // Without an error state these left `allData`/`upcoming` null forever and
  // both cards showed "Loading…" indefinitely on any API failure.
  const loadDividends = useCallback(() => {
    setLoadError('')
    getDividendsMonthly().then(setAllData).catch(e => setLoadError(e.message || 'Could not load dividend history'))
    getUpcomingDividends().then(setUpcoming).catch(e => setLoadError(e.message || 'Could not load upcoming dividends'))
  }, [])

  useEffect(() => { loadDividends() }, [loadDividends])

  const runBackfill = async () => {
    setBackfilling(true)
    try {
      const result = await backfillDividendFrequency('Quarterly')
      setBackfillMsg(result.message)
      getUpcomingDividends().then(setUpcoming).catch(console.error)
    } catch (e) {
      setBackfillMsg(e.message)
    } finally {
      setBackfilling(false)
      setTimeout(() => setBackfillMsg(''), 5000)
    }
  }

  const codes = portfolios.length
    ? portfolios.map(p => ({ code: p.code, label: p.name || p.code }))
    : allData
      ? [...new Set(allData.map(d => d.portfolio_code))].sort().map(c => ({ code: c, label: c }))
      : []

  const filteredData = !allData
    ? []
    : selected === 'ALL'
      ? allData
      : allData.filter(d => d.portfolio_code === selected)

  const filteredUpcoming = !upcoming
    ? []
    : selected === 'ALL'
      ? upcoming
      : upcoming.filter(h => h.portfolio_code === selected)

  const pills = [{ code: 'ALL', label: 'All' }, ...codes]

  const handleSelect = (code) => { setSelected(code); setPage(1) }

  const totalPages    = Math.max(1, Math.ceil(filteredUpcoming.length / PER_PAGE))
  const clampedPage   = Math.min(page, totalPages)
  const pagedUpcoming = filteredUpcoming.slice((clampedPage - 1) * PER_PAGE, clampedPage * PER_PAGE)

  return (
    <div>
      {/* ── Page head ── */}
      <div className="page-head">
        <div>
          <div className="eyebrow">Dividend income</div>
          <div className="page-title mt2">Monthly income by year</div>
          <div className="page-sub">Trailing five years · all accounts</div>
        </div>
        <div className="pills">
          {pills.map(p => (
            <button
              key={p.code}
              className={`pill${selected === p.code ? ' active' : ''}`}
              onClick={() => handleSelect(p.code)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Projected dividends ── */}
      {upcoming !== null && filteredUpcoming.length > 0 && (
        <ProjectedDividends data={filteredUpcoming} />
      )}

      {/* ── Upcoming payments ── */}
      <div className="tc-card" style={{ marginBottom: 22 }}>
        <div className="tc-card-head">
          <div>
            <div className="t">Upcoming payments</div>
            <div className="a">Soonest first · dates are guesstimated between TMX updates</div>
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            {backfillMsg && <span className="text-xs" style={{ color: 'var(--tc-muted)' }}>{backfillMsg}</span>}
            <button
              className="tc-btn sm"
              onClick={runBackfill}
              disabled={backfilling}
              title="Sets dividend_frequency = Quarterly for any stock TMX already reports a yield for but that has no frequency set yet. Monthly payers (REITs, some ETFs) still need a manual fix afterward."
            >
              {backfilling ? 'Filling…' : 'Fill missing frequency (Quarterly)'}
            </button>
          </div>
        </div>
        {loadError && (
          <div style={{ padding: '16px 20px' }}>
            <p className="text-destructive text-sm">{loadError}</p>
            <button type="button" className="tc-btn sm ghost mt2" onClick={loadDividends}>Try again</button>
          </div>
        )}
        {!loadError && upcoming === null && (
          <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>Loading…</p>
        )}
        {!loadError && upcoming !== null && filteredUpcoming.length === 0 && (
          <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>No upcoming payment dates on file.</p>
        )}
        {!loadError && upcoming !== null && filteredUpcoming.length > 0 && (
          <>
            <UpcomingDividends data={pagedUpcoming} />
            <Pager page={clampedPage} totalPages={totalPages} totalCount={filteredUpcoming.length} onChange={setPage} />
          </>
        )}
      </div>

      {/* ── KPI strip ── */}
      {allData !== null && filteredData.length > 0 && (
        <KPIStrip data={filteredData} />
      )}

      {/* ── Income matrix ── */}
      <div className="tc-card">
        <div className="tc-card-head">
          <div className="t">Income by month</div>
          <div className="a">CAD · before withholding</div>
        </div>
        {!loadError && allData === null && (
          <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>Loading…</p>
        )}
        {loadError && (
          <p className="text-destructive text-sm" style={{ padding: '16px 20px' }}>{loadError}</p>
        )}
        {!loadError && allData !== null && filteredData.length === 0 && (
          <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>No dividend data for this portfolio.</p>
        )}
        {!loadError && allData !== null && filteredData.length > 0 && (
          <DividendMatrix data={filteredData} />
        )}
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 18, marginTop: 12 }}>
        <span className="note"><span className="tag-new" style={{ margin: 0 }}>NEW</span>&nbsp;first payment from a newly-held position</span>
        <span className="note"><span className="up">▲</span>/<span className="down">▼</span>&nbsp;year-over-year change vs the same month</span>
      </div>
    </div>
  )
}
