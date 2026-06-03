import { useState, useEffect } from 'react'
import { RefreshCw, PenLine } from 'lucide-react'
import { fmtCurrency, fmtCurrencyOr } from '../utils/format'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const QUARTERS = ['Q1','Q2','Q3','Q4']
const QUARTER_END_MONTHS = [3, 6, 9, 12]

function fmtTime(date) {
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
      <td style={{ textAlign: 'right' }}>
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
      <td style={{ textAlign: 'right' }}>
        <button className="tc-btn sm" onClick={startEdit}>Set</button>
      </td>
    )
  }

  return (
    <td style={{ textAlign: 'right' }} onClick={startEdit} title="Click to edit" className="cursor-pointer select-none">
      <span className="editable num">
        {fmtCurrency(portfolio.cash)}
        <span className="pen"><PenLine size={10} /></span>
      </span>
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
    <>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Portfolio</th>
              <th>Cash balance</th>
              <th>Buy total</th>
              <th>Sale total</th>
              <th>Cash invested</th>
              <th>Market value</th>
            </tr>
          </thead>
          <tbody>
            {data.map(p => (
              <tr key={p.id}>
                <td>{p.name || p.code}</td>
                <CashCell portfolio={p} onRefresh={onRefresh} />
                <td className="num">{p.buy_total > 0 ? fmtCurrency(p.buy_total) : '—'}</td>
                <td className="num">{p.sale_total > 0 ? fmtCurrency(p.sale_total) : '—'}</td>
                <td className="num">{fmtCurrency(p.cash_invested)}</td>
                <td className="num">{p.market_value > 0 ? fmtCurrency(p.market_value) : '—'}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Grand total</td>
              <td className="num">{allCashSet ? fmtCurrency(totalCash) : '—'}</td>
              <td className="num">{totalBuy > 0 ? fmtCurrency(totalBuy) : '—'}</td>
              <td className="num">{totalSale > 0 ? fmtCurrency(totalSale) : '—'}</td>
              <td className="num">{fmtCurrency(totalInv)}</td>
              <td className="num">{totalMkt > 0 ? fmtCurrency(totalMkt) : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

function ACBTable({ data, mode, setMode }) {
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
    <div className="tbl-wrap">
      <table className="tbl matrix">
        <thead>
          <tr>
            <th>{mode === 'month' ? 'Month' : 'Quarter'}</th>
            {years.map(y => <th key={y}>{y}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, endMonth }) => (
            <tr key={label}>
              <td>{label}</td>
              {years.map(y => {
                if (isFuture(y, endMonth)) {
                  return <td key={y} className="num dim">—</td>
                }
                let v = lookup[y]?.[endMonth]
                if (v == null && mode === 'quarter') {
                  for (let m = endMonth - 1; m >= endMonth - 2; m--) {
                    if (lookup[y]?.[m] != null) { v = lookup[y][m]; break }
                  }
                }
                return (
                  <td key={y} className="num">{v != null ? fmtCurrencyOr(v) : '—'}</td>
                )
              })}
            </tr>
          ))}
          <tr className="total">
            <td>Dec close</td>
            {years.map(y => {
              const dec = lookup[y]?.[12]
              const isThisYear = y === currentYear
              return (
                <td key={y} className={`num${dec == null ? ' dim' : ''}`}>
                  {dec != null ? fmtCurrencyOr(dec) : isThisYear ? 'in progress' : '—'}
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default function Summary({ pricesTick = 0 }) {
  const [overview, setOverview]     = useState([])
  const [acb, setAcb]               = useState([])
  const [acbMode, setAcbMode]       = useState('month')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState(null)
  const [updatedAt, setUpdatedAt]   = useState(null)

  const loadOverview = () =>
    fetch('/api/overview')
      .then(r => r.json())
      .then(data => { setOverview(data); setUpdatedAt(new Date()) })
      .catch(console.error)

  /* Initial load + ACB (ACB data doesn't change on price refresh) */
  useEffect(() => {
    loadOverview()
    fetch('/api/summary/monthly-acb').then(r => r.json()).then(setAcb).catch(console.error)
  }, [])

  /* Re-fetch market values when nav refresh fires */
  useEffect(() => {
    if (pricesTick > 0) loadOverview()
  }, [pricesTick])

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

  /* derived totals */
  const totalMkt      = overview.reduce((s, p) => s + p.market_value, 0)
  const totalCash     = overview.reduce((s, p) => s + (p.cash ?? 0), 0)
  const totalInvested = overview.reduce((s, p) => s + p.cash_invested, 0)
  const totalValue    = totalMkt + totalCash
  const allTimePL     = totalMkt - totalInvested
  const allTimePct    = totalInvested > 0 ? (allTimePL / totalInvested) * 100 : 0
  const cashAccounts  = overview.filter(p => p.cash != null).length
  const isGain        = allTimePL >= 0

  const fmtTotal = (n) => {
    const s = Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return s.includes('.') ? [s.slice(0, s.lastIndexOf('.')), s.slice(s.lastIndexOf('.'))] : [s, '.00']
  }
  const [totalWhole, totalCents] = fmtTotal(totalValue)

  return (
    <div className="flex flex-col gap-6">

      {refreshMsg && (
        <div className={`banner${refreshMsg.success ? ' ok' : ' warn'}`}>
          <span style={{ fontSize: 18 }}>{refreshMsg.success ? '✓' : '✕'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{refreshMsg.text}</div>
            {refreshMsg.errors?.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm">{refreshMsg.errors.length} error(s)</summary>
                {refreshMsg.errors.map((e, i) => <div key={i} className="text-sm">{e.ticker}: {e.error}</div>)}
              </details>
            )}
          </div>
        </div>
      )}

      {/* ── Hero total ── */}
      <div className="page-head">
        <div>
          <div className="eyebrow">
            Total portfolio value{updatedAt ? ` · as of ${fmtTime(updatedAt)}` : ''}
          </div>
          {overview.length > 0 && (
            <>
              <div className="hero-total mt2">
                <span className="num">${totalWhole}</span>
                <span className="cents">{totalCents}</span>
              </div>
              <div className="deltas">
                <span className={`tag-delta ${isGain ? 'up' : 'down'}`}>
                  {isGain ? '▲' : '▼'}&nbsp;
                  <span className="num">{isGain ? '+' : '−'}{fmtCurrency(Math.abs(allTimePL))}</span>
                </span>
                <span className={`tag-delta ${isGain ? 'up' : 'down'}`}>
                  <span className="num">{isGain ? '+' : ''}{allTimePct.toFixed(1)}%</span>&nbsp;all-time
                </span>
              </div>
            </>
          )}
        </div>
        <button
          className="tc-btn primary"
          onClick={refreshAll}
          disabled={refreshing}
          aria-label="Refresh all prices"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh All Prices'}
        </button>
      </div>

      {/* ── KPI strip ── */}
      {overview.length > 0 && (
        <div className="kpis grid-3">
          <div className="kpi">
            <div className="k">All-time return</div>
            <div className={`v num ${isGain ? 'up' : 'down'}`}>
              {isGain ? '+' : ''}{allTimePct.toFixed(1)}%
            </div>
            <div className="d">on invested capital</div>
          </div>
          <div className="kpi">
            <div className="k">All-time P/L</div>
            <div className={`v num ${isGain ? 'up' : 'down'}`}>
              {isGain ? '+' : '−'}{fmtCurrency(Math.abs(allTimePL))}
            </div>
            <div className="d">market vs cost</div>
          </div>
          <div className="kpi">
            <div className="k">Cash available</div>
            <div className="v num">{totalCash > 0 ? fmtCurrency(totalCash) : '—'}</div>
            <div className="d">across {cashAccounts} accounts</div>
          </div>
        </div>
      )}

      {/* ── Portfolio overview card ── */}
      <div className="tc-card">
        <div className="tc-card-head">
          <div className="t">Portfolio overview</div>
          <div className="a">
            {overview.length} accounts
            {updatedAt && <> · <span className="faint-txt">prices updated {fmtTime(updatedAt)}</span></>}
          </div>
        </div>
        {overview.length === 0
          ? <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>Loading…</p>
          : <OverviewTable data={overview} onRefresh={loadOverview} />
        }
      </div>

      <div className="row between">
        <span className="note"><PenLine size={11} /> Tap a cash balance to edit inline</span>
        <span className="note">Cash invested = Buy total − Sale total</span>
      </div>

      {/* ── ACB matrix ── */}
      <div className="page-head mt6" style={{ marginBottom: 14 }}>
        <div>
          <div className="eyebrow">Book value of holdings</div>
          <div className="page-title mt2">End-of-month ACB · all portfolios</div>
        </div>
        <div className="seg">
          <button className={acbMode === 'month' ? 'active' : ''} onClick={() => setAcbMode('month')}>
            By month
          </button>
          <button className={acbMode === 'quarter' ? 'active' : ''} onClick={() => setAcbMode('quarter')}>
            By quarter
          </button>
        </div>
      </div>

      <div className="tc-card">
        {acb.length === 0
          ? <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>Loading…</p>
          : <ACBTable data={acb} mode={acbMode} setMode={setAcbMode} />
        }
      </div>
    </div>
  )
}
