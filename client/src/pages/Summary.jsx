import { useState, useEffect } from 'react'
import { fmtCurrency, fmtCurrencyOr } from '../utils/format'
import { Card, CardContent, CardHeader, CardAction } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
      <td className="summary-td text-right">
        <form className="cash-inline-form" onSubmit={save}>
          <Input className="h-7 w-28 text-right tabular-nums" type="number" step="0.01"
            value={input} onChange={e => setInput(e.target.value)} placeholder="Amount" autoFocus />
          <Button type="submit" size="sm" className="h-7 px-2">Save</Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={cancel}>✕</Button>
          {error && <span className="text-destructive text-xs">{error}</span>}
        </form>
      </td>
    )
  }

  if (portfolio.cash === null) {
    return (
      <td className="summary-td text-right">
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={startEdit}>Set</Button>
      </td>
    )
  }

  return (
    <td
      className={`summary-td text-right tabular-nums cursor-pointer select-none group/cash${portfolio.cash < 0 ? ' text-destructive' : ''}`}
      onClick={startEdit}
      title="Click to edit"
    >
      {fmtCurrency(portfolio.cash)}
      <span className="ml-1 text-muted-foreground text-xs opacity-0 group-hover/cash:opacity-100 transition-opacity">✎</span>
    </td>
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
        <table className="summary-overview-table">
          <thead>
            <tr>
              <th className="summary-th text-left">Portfolio</th>
              <th className="summary-th text-right">Cash Balance</th>
              <th className="summary-th text-right">Buy Total</th>
              <th className="summary-th text-right">Sale Total</th>
              <th className="summary-th text-right">Cash Invested</th>
              <th className="summary-th text-right">Market Value</th>
            </tr>
          </thead>
          <tbody>
            {data.map(p => (
              <tr key={p.id} className="summary-row">
                <td className="summary-td summary-portfolio-name">
                  {p.name || p.code}
                </td>
                <CashCell portfolio={p} onRefresh={onRefresh} />
                <td className="summary-td text-right tabular-nums">{p.buy_total > 0 ? fmtCurrency(p.buy_total) : '—'}</td>
                <td className="summary-td text-right tabular-nums">{p.sale_total > 0 ? fmtCurrency(p.sale_total) : '—'}</td>
                <td className="summary-td text-right tabular-nums">{fmtCurrency(p.cash_invested)}</td>
                <td className="summary-td text-right tabular-nums">{p.market_value > 0 ? fmtCurrency(p.market_value) : '—'}</td>
              </tr>
            ))}
            <tr className="summary-total-row">
              <td className="summary-td summary-total-label">Grand total</td>
              <td className="summary-td text-right tabular-nums">
                {allCashSet ? fmtCurrency(totalCash) : '—'}
              </td>
              <td className="summary-td text-right tabular-nums">{totalBuy > 0 ? fmtCurrency(totalBuy) : '—'}</td>
              <td className="summary-td text-right tabular-nums">{totalSale > 0 ? fmtCurrency(totalSale) : '—'}</td>
              <td className="summary-td text-right tabular-nums">{fmtCurrency(totalInv)}</td>
              <td className="summary-td text-right tabular-nums">{totalMkt > 0 ? fmtCurrency(totalMkt) : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="px-5 py-3 text-xs text-muted-foreground border-t border-border">
        Cash Invested = Buy Total − Sale Total. Click a Cash Balance cell to edit inline.
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
      <div className="flex items-center justify-end gap-2 px-5 pb-4">
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
        <table className="summary-acb-table">
          <thead>
            <tr>
              <th className="summary-th text-left acb-label-col sticky left-0 z-10 bg-muted">
                {mode === 'month' ? 'Month' : 'Quarter'}
              </th>
              {years.map(y => (
                <th key={y} className="summary-th text-right">{y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, endMonth }) => (
              <tr key={label} className="summary-row">
                <td className="summary-td acb-label-col font-medium text-muted-foreground sticky left-0 z-10 bg-card">
                  {label}
                </td>
                {years.map(y => {
                  if (isFuture(y, endMonth)) {
                    return <td key={y} className="summary-td text-right text-muted-foreground">—</td>
                  }
                  let v = lookup[y]?.[endMonth]
                  if (v == null && mode === 'quarter') {
                    for (let m = endMonth - 1; m >= endMonth - 2; m--) {
                      if (lookup[y]?.[m] != null) { v = lookup[y][m]; break }
                    }
                  }
                  return (
                    <td key={y} className="summary-td text-right tabular-nums">
                      {v != null ? fmtCurrencyOr(v) : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
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

      {refreshMsg && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${refreshMsg.success ? 'status-success' : 'status-error'}`}>
          <strong>{refreshMsg.text}</strong>
          {refreshMsg.errors?.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer">{refreshMsg.errors.length} error(s)</summary>
              {refreshMsg.errors.map((e, i) => <div key={i}>{e.ticker}: {e.error}</div>)}
            </details>
          )}
        </div>
      )}

      {/* Portfolio Overview */}
      <Card>
        <CardHeader className="border-b px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="summary-eyebrow">Portfolio Overview</p>
              <h1 className="summary-display-heading">All accounts at a glance</h1>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0 pt-1">
              {updatedAt && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  prices updated {fmtUpdatedTime(updatedAt)}
                </span>
              )}
              <Button size="sm" onClick={refreshAll} disabled={refreshing}>
                {refreshing ? 'Refreshing…' : '↻ Refresh All Prices'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {overview.length === 0
            ? <p className="text-muted-foreground text-sm px-5 py-4">Loading…</p>
            : <OverviewTable data={overview} onRefresh={loadOverview} />
          }
        </CardContent>
      </Card>

      {/* ACB Matrix */}
      <Card>
        <CardHeader className="border-b px-5 py-4">
          <div>
            <p className="summary-eyebrow">Book Value of Holdings</p>
            <h2 className="summary-section-heading">End-of-month ACB · all portfolios</h2>
          </div>
        </CardHeader>
        <CardContent className="p-0 pt-4">
          {acb.length === 0
            ? <p className="text-muted-foreground text-sm px-5 pb-4">Loading…</p>
            : <ACBTable data={acb} />
          }
        </CardContent>
      </Card>
    </div>
  )
}
