import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

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
    const pct = ((curr - prev) / prev) * 100
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
  const now = new Date()
  const currentYear = now.getFullYear()

  const lookup = {}
  data.forEach(d => {
    if (!lookup[d.year]) lookup[d.year] = {}
    lookup[d.year][d.month] = (lookup[d.year][d.month] || 0) + d.total
  })

  const thisYear = lookup[currentYear] || {}
  const prevYear = lookup[currentYear - 1] || {}

  const ttm = Object.values(thisYear).reduce((s, v) => s + v, 0)

  const activeMths = Object.values(thisYear).filter(v => v > 0)
  const avgMonth   = activeMths.length ? ttm / activeMths.length : 0

  let bestMonth = 0, bestMonthLabel = ''
  Object.entries(thisYear).forEach(([m, v]) => {
    if (v > bestMonth) { bestMonth = v; bestMonthLabel = MONTHS[parseInt(m) - 1] + ' ' + currentYear }
  })

  // New streams: months where current year has income but prior year had none
  const priorYears = Object.keys(lookup).map(Number).filter(y => y < currentYear)
  const newStreams  = Object.entries(thisYear)
    .filter(([m, v]) => v > 0 && priorYears.every(y => !(lookup[y]?.[parseInt(m)] > 0)))
    .length

  const kpis = [
    { label: 'This Year (TTM)',  value: fmtKPI(ttm) },
    { label: 'Avg / Month',      value: fmtKPI(avgMonth), sub: 'across all accts' },
    { label: 'Best Month',       value: fmtKPI(bestMonth), sub: bestMonthLabel },
    { label: 'New Streams',      value: String(newStreams), sub: 'started this yr' },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4">
      {kpis.map(k => (
        <div key={k.label} className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{k.label}</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{k.value}</p>
          {k.sub && <p className="text-xs text-muted-foreground mt-0.5">{k.sub}</p>}
        </div>
      ))}
    </div>
  )
}

function DividendMatrix({ data }) {
  if (!data.length) return <p className="text-muted-foreground text-sm px-4 pb-4">No dividend data.</p>

  const years   = [...new Set(data.map(d => d.year))].sort((a, b) => a - b).slice(-5)
  const lookup  = {}
  data.forEach(d => {
    if (!lookup[d.year]) lookup[d.year] = {}
    lookup[d.year][d.month] = (lookup[d.year][d.month] || 0) + d.total
  })

  const yearTotals = {}
  years.forEach(y => {
    yearTotals[y] = Object.values(lookup[y] || {}).reduce((s, v) => s + v, 0)
  })

  const prevYear = years.length >= 2 ? years[years.length - 2] : null
  const currYear = years[years.length - 1]
  const priorYears = years.filter(y => y < currYear)

  const isNew = (month) => {
    const v = lookup[currYear]?.[month] || 0
    return v > 0 && priorYears.every(y => !(lookup[y]?.[month] > 0))
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[60px]">Month</TableHead>
            {years.map(y => <TableHead key={y} className="text-right">{y}</TableHead>)}
            {prevYear && <TableHead className="text-right border-l border-border">YoY</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {MONTHS.map((label, i) => {
            const m    = i + 1
            const prev = prevYear ? (lookup[prevYear]?.[m] || 0) : 0
            const curr = lookup[currYear]?.[m] || 0
            const newStream = isNew(m)
            return (
              <TableRow key={label}>
                <TableCell className="font-medium">{label}</TableCell>
                {years.map(y => (
                  <TableCell key={y} className="text-right tabular-nums">
                    {fmtDiv(lookup[y]?.[m] || 0)}
                    {y === currYear && newStream && (
                      <span className="ml-1.5 badge-pos text-xs align-middle">New</span>
                    )}
                  </TableCell>
                ))}
                {prevYear && (
                  <TableCell className="text-right border-l border-border">
                    <YoYBadge prev={prev} curr={curr} />
                  </TableCell>
                )}
              </TableRow>
            )
          })}
          <TableRow className="font-bold bg-muted/40 border-t-2 border-border">
            <TableCell className="font-bold">Annual total</TableCell>
            {years.map(y => (
              <TableCell key={y} className="text-right tabular-nums font-bold">
                {fmtDiv(yearTotals[y])}
              </TableCell>
            ))}
            {prevYear && (
              <TableCell className="text-right border-l border-border">
                <YoYBadge prev={yearTotals[prevYear] || 0} curr={yearTotals[currYear] || 0} />
              </TableCell>
            )}
          </TableRow>
        </TableBody>
      </Table>
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

  // Build pill list: use portfolios prop if available, else derive from data
  const codes = portfolios.length
    ? portfolios.map(p => ({ code: p.code, label: p.code }))
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
        <CardHeader className="border-b">
          <CardTitle>
            <span className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Dividends Income
            </span>
            Monthly income by year
          </CardTitle>
          <CardDescription>
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              {pills.map(p => (
                <button
                  key={p.code}
                  onClick={() => setSelected(p.code)}
                  className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                    selected === p.code
                      ? 'bg-primary text-white border-primary'
                      : 'bg-card border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </CardDescription>
        </CardHeader>

        {allData !== null && filteredData.length > 0 && (
          <KPIStrip data={filteredData} />
        )}

        <CardContent className="p-0">
          {allData === null && (
            <p className="text-muted-foreground text-sm px-4 py-4">Loading…</p>
          )}
          {allData !== null && filteredData.length === 0 && (
            <p className="text-muted-foreground text-sm px-4 py-4">No dividend data for this portfolio.</p>
          )}
          {allData !== null && filteredData.length > 0 && (
            <DividendMatrix data={filteredData} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
