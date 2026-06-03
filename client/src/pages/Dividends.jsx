import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtDiv(v) {
  return v > 0
    ? '$' + v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'
}

function fmtKPI(v) {
  return v > 0
    ? '$' + Math.round(v).toLocaleString('en-CA')
    : '—'
}

function YoYBadge({ prev, curr }) {
  if (curr > 0 && prev === 0) return <span className="badge-pos">New</span>
  if (curr > 0 && prev > 0) {
    const pct  = ((curr - prev) / prev) * 100
    const sign = pct >= 0 ? '▲' : '▼'
    return (
      <span className={pct >= 0 ? 'badge-pos' : 'badge-neg'}>
        {sign}{Math.abs(pct).toFixed(0)}%
      </span>
    )
  }
  return <span className="text-muted-foreground">—</span>
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

  const kpis = [
    { label: 'This Year (TTM)', value: fmtKPI(ttm) },
    { label: 'Avg / Month',     value: fmtKPI(avgMonth), sub: 'across all accts' },
    { label: 'Best Month',      value: fmtKPI(bestMonth), sub: bestMonthLabel },
    { label: 'New Streams',     value: String(newStreams), sub: 'started this yr' },
  ]

  return (
    <div className="div-kpi-strip">
      {kpis.map(k => (
        <div key={k.label} className="div-kpi-tile">
          <p className="div-kpi-label">{k.label}</p>
          <p className="div-kpi-value">{k.value}</p>
          {k.sub && <p className="div-kpi-sub">{k.sub}</p>}
        </div>
      ))}
    </div>
  )
}

function DividendMatrix({ data }) {
  if (!data.length) return <p className="text-muted-foreground text-sm px-5 pb-5">No dividend data.</p>

  const years     = [...new Set(data.map(d => d.year))].sort((a, b) => a - b).slice(-5)
  const lookup    = {}
  data.forEach(d => {
    if (!lookup[d.year]) lookup[d.year] = {}
    lookup[d.year][d.month] = (lookup[d.year][d.month] || 0) + d.total
  })

  const yearTotals = {}
  years.forEach(y => {
    yearTotals[y] = Object.values(lookup[y] || {}).reduce((s, v) => s + v, 0)
  })

  const prevYear  = years.length >= 2 ? years[years.length - 2] : null
  const currYear  = years[years.length - 1]
  const priorYears = years.filter(y => y < currYear)

  const isNew = (month) => {
    const v = lookup[currYear]?.[month] || 0
    return v > 0 && priorYears.every(y => !(lookup[y]?.[month] > 0))
  }

  return (
    <div className="overflow-x-auto">
      <table className="div-matrix-table">
        <thead>
          <tr>
            <th className="div-th text-left">Month</th>
            {years.map(y => <th key={y} className="div-th text-right">{y}</th>)}
            {prevYear && <th className="div-th text-right div-yoy-col">YoY</th>}
          </tr>
        </thead>
        <tbody>
          {MONTHS.map((label, i) => {
            const m         = i + 1
            const prev      = prevYear ? (lookup[prevYear]?.[m] || 0) : 0
            const curr      = lookup[currYear]?.[m] || 0
            const newStream = isNew(m)
            return (
              <tr key={label} className="div-matrix-row">
                <td className="div-td font-medium">{label}</td>
                {years.map(y => (
                  <td key={y} className="div-td text-right tabular-nums">
                    {fmtDiv(lookup[y]?.[m] || 0)}
                    {y === currYear && newStream && (
                      <span className="ml-1.5 badge-pos text-xs align-middle">New</span>
                    )}
                  </td>
                ))}
                {prevYear && (
                  <td className="div-td text-right div-yoy-col">
                    <YoYBadge prev={prev} curr={curr} />
                  </td>
                )}
              </tr>
            )
          })}
          <tr className="div-total-row">
            <td className="div-td font-bold">Annual total</td>
            {years.map(y => (
              <td key={y} className="div-td text-right tabular-nums font-bold">
                {fmtDiv(yearTotals[y])}
              </td>
            ))}
            {prevYear && (
              <td className="div-td text-right div-yoy-col">
                <YoYBadge prev={yearTotals[prevYear] || 0} curr={yearTotals[currYear] || 0} />
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
    fetch('/api/dividends/monthly')
      .then(r => r.json())
      .then(setAllData)
      .catch(console.error)
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
    <div className="flex flex-col gap-6">
      <Card>
        {/* Header: eyebrow + display heading + "last 5 years" indicator */}
        <CardHeader className="border-b px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="summary-eyebrow">Dividends Income</p>
              <h1 className="summary-display-heading">Monthly income by year</h1>
            </div>
            <span className="div-last5-label">last 5 years</span>
          </div>
        </CardHeader>

        {/* Portfolio filter pills — own row, clearly separated from heading */}
        <div className="div-filter-row">
          {pills.map(p => (
            <button
              key={p.code}
              onClick={() => setSelected(p.code)}
              className={`div-filter-pill${selected === p.code ? ' div-filter-pill--active' : ''}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* KPI stat tiles */}
        {allData !== null && filteredData.length > 0 && (
          <KPIStrip data={filteredData} />
        )}

        {/* Dividend matrix table */}
        <CardContent className="p-0">
          {allData === null && (
            <p className="text-muted-foreground text-sm px-5 py-4">Loading…</p>
          )}
          {allData !== null && filteredData.length === 0 && (
            <p className="text-muted-foreground text-sm px-5 py-4">No dividend data for this portfolio.</p>
          )}
          {allData !== null && filteredData.length > 0 && (
            <DividendMatrix data={filteredData} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
