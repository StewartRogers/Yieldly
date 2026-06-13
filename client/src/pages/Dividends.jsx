import { useState, useEffect } from 'react'
import { getDividendsMonthly } from '../api/client'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtDiv(v) {
  return v > 0
    ? '$' + v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'
}

function fmtKPI(v) {
  return v > 0 ? '$' + Math.round(v).toLocaleString('en-CA') : '—'
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
  const [allData, setAllData]   = useState(null)
  const [selected, setSelected] = useState('ALL')

  useEffect(() => {
    getDividendsMonthly().then(setAllData).catch(console.error)
  }, [])

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

  const pills = [{ code: 'ALL', label: 'All' }, ...codes]

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
              onClick={() => setSelected(p.code)}
            >
              {p.label}
            </button>
          ))}
        </div>
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
        {allData === null && (
          <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>Loading…</p>
        )}
        {allData !== null && filteredData.length === 0 && (
          <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>No dividend data for this portfolio.</p>
        )}
        {allData !== null && filteredData.length > 0 && (
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
