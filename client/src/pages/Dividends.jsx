import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmt(v) {
  return v > 0
    ? '$' + v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'
}

function YoYBadge({ prev, curr }) {
  if (curr > 0 && prev === 0) return <span className="badge-pos">New</span>
  if (prev > 0 && curr > 0) {
    const pct = ((curr - prev) / prev) * 100
    return <span className={pct >= 0 ? 'badge-pos' : 'badge-neg'}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>
  }
  return <span style={{ color: 'var(--text-secondary)' }}>—</span>
}

function DividendTable({ data }) {
  if (!data.length) return <p className="text-muted-foreground text-sm px-4 pb-4">No dividend data.</p>

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

  const prevYear = years.length >= 2 ? years[years.length - 2] : null
  const currYear = years[years.length - 1]

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead></TableHead>
            {years.map(y => <TableHead key={y} className="text-right">{y}</TableHead>)}
            {prevYear && <TableHead className="text-right">{prevYear}→{currYear}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {MONTHS.map((label, i) => {
            const m    = i + 1
            const prev = prevYear ? (lookup[prevYear]?.[m] || 0) : 0
            const curr = lookup[currYear]?.[m] || 0
            return (
              <TableRow key={label}>
                <TableCell className="font-medium">{label}</TableCell>
                {years.map(y => (
                  <TableCell key={y} className="text-right tabular-nums">{fmt(lookup[y]?.[m] || 0)}</TableCell>
                ))}
                {prevYear && (
                  <TableCell className="text-right">
                    <YoYBadge prev={prev} curr={curr} />
                  </TableCell>
                )}
              </TableRow>
            )
          })}
          <TableRow className="font-semibold border-t-2">
            <TableCell>Total</TableCell>
            {years.map(y => <TableCell key={y} className="text-right tabular-nums">{fmt(yearTotals[y])}</TableCell>)}
            {prevYear && (
              <TableCell className="text-right">
                <YoYBadge prev={yearTotals[prevYear] || 0} curr={yearTotals[currYear] || 0} />
              </TableCell>
            )}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}

export default function Dividends() {
  const [sections, setSections] = useState(null)

  useEffect(() => {
    fetch('/api/dividends/monthly')
      .then(r => r.json())
      .then(data => {
        if (!data.length) { setSections([]); return }
        const byCode = code => data.filter(d => d.portfolio_code === code)
        const candidates = [
          { label: 'All Portfolios', data },
          { label: 'RRSP',  data: byCode('RR') },
          { label: 'TFSA',  data: byCode('T')  },
          { label: 'RE',    data: byCode('RE') },
          { label: 'RF',    data: byCode('RF') },
        ]
        setSections(candidates.filter(s => s.data.length))
      })
      .catch(console.error)
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Dividend Income</h1>

      {sections === null && <p className="text-muted-foreground text-sm">Loading…</p>}
      {sections !== null && sections.length === 0 && (
        <p className="text-muted-foreground text-sm">No dividend transactions found.</p>
      )}

      {sections?.map(s => (
        <Card key={s.label}>
          <CardHeader>
            <CardTitle>{s.label}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DividendTable data={s.data} />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
