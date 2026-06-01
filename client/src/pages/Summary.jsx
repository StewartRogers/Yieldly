import { useState, useEffect } from 'react'
import { fmtCurrency, fmtCurrencyOr } from '../utils/format'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

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
      <TableCell>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={startEdit}>Set</Button>
      </TableCell>
    )
  }

  return (
    <TableCell className={`text-right tabular-nums${portfolio.cash < 0 ? ' text-destructive' : ''}`}>
      {fmtCurrency(portfolio.cash)}
      <Button variant="ghost" size="sm" className="h-6 w-6 ml-1 p-0 text-muted-foreground" title="Edit" onClick={startEdit}>✎</Button>
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
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead></TableHead>
            {data.map(p => <TableHead key={p.id} className="text-right" title={p.name}>{p.code}</TableHead>)}
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-medium">Cash Balance</TableCell>
            {data.map(p => <CashCell key={p.id} portfolio={p} onRefresh={onRefresh} />)}
            <TableCell className="text-right tabular-nums">{allCashSet ? fmtCurrency(totalCash) : '—'}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Buy Total</TableCell>
            {data.map(p => <TableCell key={p.id} className="text-right tabular-nums">{p.buy_total > 0 ? fmtCurrency(p.buy_total) : '—'}</TableCell>)}
            <TableCell className="text-right tabular-nums">{totalBuy > 0 ? fmtCurrency(totalBuy) : '—'}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Sale Total</TableCell>
            {data.map(p => <TableCell key={p.id} className="text-right tabular-nums">{p.sale_total > 0 ? fmtCurrency(p.sale_total) : '—'}</TableCell>)}
            <TableCell className="text-right tabular-nums">{totalSale > 0 ? fmtCurrency(totalSale) : '—'}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Cash Invested</TableCell>
            {data.map(p => <TableCell key={p.id} className="text-right tabular-nums">{fmtCurrency(p.cash_invested)}</TableCell>)}
            <TableCell className="text-right tabular-nums">{fmtCurrency(totalInv)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Market Value</TableCell>
            {data.map(p => <TableCell key={p.id} className="text-right tabular-nums">{p.market_value > 0 ? fmtCurrency(p.market_value) : '—'}</TableCell>)}
            <TableCell className="text-right tabular-nums">{totalMkt > 0 ? fmtCurrency(totalMkt) : '—'}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}

function MonthlyACBTable({ data }) {
  const years  = [...new Set(data.map(d => d.year))].sort((a, b) => a - b).slice(-5)
  const lookup = {}
  data.forEach(d => {
    if (!lookup[d.year]) lookup[d.year] = {}
    lookup[d.year][d.month] = d.total_acb
  })

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead></TableHead>
            {years.map(y => <TableHead key={y} className="text-right">{y}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {MONTHS.map((label, i) => (
            <TableRow key={label}>
              <TableCell className="font-medium">{label}</TableCell>
              {years.map(y => {
                const v = lookup[y]?.[i + 1]
                return <TableCell key={y} className="text-right tabular-nums">{v != null ? fmtCurrencyOr(v) : ''}</TableCell>
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export default function Summary() {
  const [overview, setOverview]     = useState([])
  const [acb, setAcb]               = useState([])
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState(null)

  const loadOverview = () =>
    fetch('/api/overview').then(r => r.json()).then(setOverview).catch(console.error)

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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Summary</h1>
        <Button variant="outline" onClick={refreshAll} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh All Prices'}
        </Button>
      </div>

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
        <CardHeader>
          <CardTitle>Portfolio Overview</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {overview.length === 0
            ? <p className="text-muted-foreground text-sm px-4 pb-4">Loading…</p>
            : <OverviewTable data={overview} onRefresh={loadOverview} />
          }
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Book Value of Holdings</CardTitle>
          <CardDescription>End-of-month cost basis (ACB) across all portfolios</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {acb.length === 0
            ? <p className="text-muted-foreground text-sm px-4 pb-4">Loading…</p>
            : <MonthlyACBTable data={acb} />
          }
        </CardContent>
      </Card>
    </div>
  )
}
