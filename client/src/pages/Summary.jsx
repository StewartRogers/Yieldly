import { useState, useEffect } from 'react'
import { fmtCurrency, fmtCurrencyOr } from '../utils/format'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const QUARTERS = ['Q1','Q2','Q3','Q4']
const QUARTER_END_MONTHS = [3, 6, 9, 12]

function fmtUpdatedTime(date) {
  return date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })
}

function CashCell({ portfolio, onRefresh }) {
  const [editing, setEditing] = useState(false)
  const [input, setInput]     = useState('')
  const [error, setError]     = useState('')

  const startEdit = () => {
    setEditing(true)
    setInput(portfolio.cash != null ? String(portfolio.cash) : '')
    setError('')
  }
  const cancel = () => { setEditing(false); setError('') }

  const save = async (e) => {
    e.preventDefault()
    const raw   = input.trim()
    const value = raw === '' ? null : parseFloat(raw.replace(/[$,\s]/g, ''))
    if (raw !== '' && isNaN(value)) { setError('Invalid number'); return }
    try {
      const res = await fetch(`/api/portfolios/${portfolio.id}/cash-balance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cash_balance: value })
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setEditing(false)
      onRefresh()
    } catch (err) {
      setError(err.message)
    }
  }

  if (editing) {
    return (
      <TableCell>
        <form className="cash-inline-form" onSubmit={save}>
          <Input className="h-7 w-28 text-right tabular-nums" type="number" step="0.01"
            value={input} onChange={e => setInput(e.target.value)} placeholder="Amount" autoFocus />
          <Button type="submit" size="sm" className="h-7 px-2">Save</Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={cancel}>✕</Button>
          {error && <span className="text-destructive text-xs">{error}</span>}
        </form>
      </TableCell>
    )
  }

  if (portfolio.cash === null) {
    return (
      <TableCell className="text-right">
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={startEdit}>Set</Button>
      </TableCell>
    )
  }

  return (
    <TableCell
      className={`text-right tabular-nums cursor-pointer select-none group/cash${portfolio.cash < 0 ? ' text-destructive' : ''}`}
      onClick={startEdit}
      title="Click to edit"
    >
      {fmtCurrency(portfolio.cash)}
      <span className="ml-1 text-muted-foreground text-xs opacity-0 group-hover/cash:opacity-100 transition-opacity">✎</span>
    </TableCell>
  )
}

function OverviewTable({ data, onRefresh }) {
  const allCashSet = data.every(p => p.cash !== null)
  const totalCash  = data.reduce((s, p) => s + (p.cash ?? 0), 0)
  const totalBuy   = data.reduce((s, p) => s + p.buy_total, 0)
  const totalSale  = data.reduce((s, p) => s + p.sale_total, 0)
  const totalInv   = data.reduce((s, p) => s + p.cash_invested, 0)
  const totalMkt   = data.reduce((s, p) => s + p.market_value, 0)

  return (
    <div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[160px]">Portfolio</TableHead>
              <TableHead className="text-right">Cash Balance</TableHead>
              <TableHead className="text-right">Buy Total</TableHead>
              <TableHead className="text-right">Sale Total</TableHead>
              <TableHead className="text-right">Cash Invested</TableHead>
              <TableHead className="text-right">Market Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map(p => (
              <TableRow key={p.id}>
                <TableCell className="font-semibold">
                  {p.code}
                  {p.name && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{p.name}</span>
                  )}
                </TableCell>
                <CashCell portfolio={p} onRefresh={onRefresh} />
                <TableCell className="text-right tabular-nums">{p.buy_total > 0 ? fmtCurrency(p.buy_total) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{p.sale_total > 0 ? fmtCurrency(p.sale_total) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtCurrency(p.cash_invested)}</TableCell>
                <TableCell className="text-right tabular-nums">{p.market_value > 0 ? fmtCurrency(p.market_value) : '—'}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-bold bg-muted/40 border-t-2 border-border">
              <TableCell className="font-bold">Grand total</TableCell>
              <TableCell className="text-right tabular-nums font-bold">
                {allCashSet ? fmtCurrency(totalCash) : '—'}
              </TableCell>
              <TableCell className="text-right tabular-nums font-bold">{totalBuy > 0 ? fmtCurrency(totalBuy) : '—'}</TableCell>
              <TableCell className="text-right tabular-nums font-bold">{totalSale > 0 ? fmtCurrency(totalSale) : '—'}</TableCell>
              <TableCell className="text-right tabular-nums font-bold">{fmtCurrency(totalInv)}</TableCell>
              <TableCell className="text-right tabular-nums font-bold">{totalMkt > 0 ? fmtCurrency(totalMkt) : '—'}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <p className="px-4 py-2 text-xs text-muted-foreground">
        Cash Invested = Buy Total − Sale Total (active positions only). Click a Cash Balance cell to edit inline.
      </p>
    </div>
  )
}

function ACBTable({ data }) {
  const [mode, setMode] = useState('month')

  const now = new Date()
  const currentYear  = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const years = [...new Set(data.map(d => d.year))].sort((a, b) => a - b).slice(-5)

  const lookup = {}
  data.forEach(d => {
    if (!lookup[d.year]) lookup[d.year] = {}
    lookup[d.year][d.month] = d.total_acb
  })

  const isFuture = (year, month) =>
    year > currentYear || (year === currentYear && month > currentMonth)

  const rows = mode === 'month'
    ? MONTHS.map((label, i) => ({ label, endMonth: i + 1 }))
    : QUARTERS.map((label, qi) => ({ label, endMonth: QUARTER_END_MONTHS[qi] }))

  return (
    <div>
      <div className="flex items-center justify-end gap-2 px-4 pb-3">
        <div className="view-toggle">
          <button
            className={`view-btn${mode === 'month' ? ' active' : ''}`}
            onClick={() => setMode('month')}
          >
            By month
          </button>
          <button
            className={`view-btn${mode === 'quarter' ? ' active' : ''}`}
            onClick={() => setMode('quarter')}
          >
            By quarter
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[70px] sticky left-0 z-10 bg-muted">
                {mode === 'month' ? 'Month' : 'Quarter'}
              </TableHead>
              {years.map(y => (
                <TableHead key={y} className="text-right">{y}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ label, endMonth }) => (
              <TableRow key={label}>
                <TableCell className="font-medium text-muted-foreground sticky left-0 z-10 bg-card">
                  {label}
                </TableCell>
                {years.map(y => {
                  if (isFuture(y, endMonth)) {
                    return <TableCell key={y} className="text-right text-muted-foreground">—</TableCell>
                  }
                  let v = lookup[y]?.[endMonth]
                  if (v == null && mode === 'quarter') {
                    for (let m = endMonth - 1; m >= endMonth - 2; m--) {
                      if (lookup[y]?.[m] != null) { v = lookup[y][m]; break }
                    }
                  }
                  return (
                    <TableCell key={y} className="text-right tabular-nums">
                      {v != null ? fmtCurrencyOr(v) : '—'}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export default function Summary() {
  const [overview, setOverview]     = useState([])
  const [acb, setAcb]               = useState([])
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState(null)
  const [updatedAt, setUpdatedAt]   = useState(null)

  const loadOverview = () =>
    fetch('/api/overview')
      .then(r => r.json())
      .then(data => { setOverview(data); setUpdatedAt(new Date()) })
      .catch(console.error)

  useEffect(() => {
    loadOverview()
    fetch('/api/summary/monthly-acb').then(r => r.json()).then(setAcb).catch(console.error)
  }, [])

  const refreshAll = async () => {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const res = await fetch('/api/refresh-all-prices', { method: 'POST' })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      const result = await res.json()
      setRefreshMsg({ success: true, text: result.message, errors: result.errors })
      loadOverview()
    } catch (e) {
      setRefreshMsg({ success: false, text: e.message })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Summary</h1>

      {refreshMsg && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${refreshMsg.success ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          <strong>{refreshMsg.text}</strong>
          {refreshMsg.errors?.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer">{refreshMsg.errors.length} error(s)</summary>
              {refreshMsg.errors.map((e, i) => <div key={i}>{e.ticker}: {e.error}</div>)}
            </details>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="border-b">
          <CardTitle>
            <span className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Portfolio Overview
            </span>
            All accounts at a glance
          </CardTitle>
          <CardAction>
            <div className="flex items-center gap-3">
              {updatedAt && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  prices updated {fmtUpdatedTime(updatedAt)}
                </span>
              )}
              <Button size="sm" onClick={refreshAll} disabled={refreshing}>
                {refreshing ? 'Refreshing…' : '↻ Refresh All Prices'}
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          {overview.length === 0
            ? <p className="text-muted-foreground text-sm px-4 py-4">Loading…</p>
            : <OverviewTable data={overview} onRefresh={loadOverview} />
          }
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>
            <span className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Book Value of Holdings
            </span>
            End-of-month ACB · all portfolios
          </CardTitle>
          <CardDescription>Adjusted Cost Base history across all portfolios</CardDescription>
        </CardHeader>
        <CardContent className="p-0 pt-4">
          {acb.length === 0
            ? <p className="text-muted-foreground text-sm px-4 pb-4">Loading…</p>
            : <ACBTable data={acb} />
          }
        </CardContent>
      </Card>
    </div>
  )
}
