import { useState, useEffect } from 'react'
import { PenLine, Check } from 'lucide-react'
import { fmtCurrency } from '../utils/format'
import { Input } from '@/components/ui/input'
import { getValueSnapshots, getContributionsMonthly, setValueSnapshot } from '../api/client'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtKPI(v) {
  return v != null ? '$' + Math.round(v).toLocaleString('en-CA') : '—'
}

function fmtDelta(v) {
  if (v == null) return <span className="dim">—</span>
  const sign = v >= 0 ? '▲' : '▼'
  return <span className={v >= 0 ? 'up' : 'down'}>{sign} {v >= 0 ? '+' : '−'}{fmtCurrency(Math.abs(v))}</span>
}

function todayISO() {
  return new Date().toLocaleDateString('en-CA')
}

// Last calendar day of `month` (1-indexed) in `year`, as YYYY-MM-DD.
function monthEndISO(year, month) {
  const d = new Date(year, month, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Per-portfolio pivot: {year: {month: {value, date, source}}} — each cell is
// the LATEST snapshot dated within that year-month (not carried forward from
// a prior month), so a month with no data renders blank. This single rule
// gives end-of-month values for closed months and "latest so far" for the
// current month, with no special-casing.
function buildPivot(rows) {
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
function sumPivots(pivots) {
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

function pivotValue(pivot, year, month) {
  return pivot?.[year]?.[month]?.value ?? null
}

function SnapshotCell({ year, month, cell, editable, disabled, onSave }) {
  const [editing, setEditing] = useState(false)
  const [input, setInput]     = useState('')
  const [error, setError]     = useState('')
  const [saving, setSaving]   = useState(false)

  const startEdit = () => {
    if (!editable || disabled) return
    setEditing(true)
    setInput(cell ? String(Math.round(cell.value)) : '')
    setError('')
  }
  const cancel = () => { setEditing(false); setError('') }

  const save = async (e) => {
    e.preventDefault()
    const raw   = input.trim()
    const value = parseFloat(raw.replace(/[$,\s]/g, ''))
    if (raw === '' || isNaN(value) || value < 0) { setError('Invalid number'); return }
    setSaving(true)
    try {
      await onSave(year, month, value)
      setEditing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <td style={{ textAlign: 'right' }}>
        <form className="cash-inline-form" onSubmit={save}>
          <Input className="h-7 w-24 text-right tabular-nums" type="text" inputMode="decimal"
            value={input} onChange={e => setInput(e.target.value)} placeholder="Value" autoFocus disabled={saving} />
          <button type="submit" className="tc-btn sm ghost" title="Save" style={{ padding: '0 6px' }}><Check size={13} /></button>
          <button type="button" className="tc-btn sm ghost" onClick={cancel} title="Cancel" style={{ padding: '0 6px' }}>✕</button>
          {error && <span className="text-destructive text-xs">{error}</span>}
        </form>
      </td>
    )
  }

  if (!editable || disabled) {
    return <td className="num">{cell ? fmtCurrency(cell.value) : '—'}</td>
  }

  return (
    <td
      className="num cursor-pointer select-none"
      onClick={startEdit}
      title={cell ? 'Click to correct this value' : 'Click to add a value'}
    >
      <span className="editable num">
        {cell ? fmtCurrency(cell.value) : '—'}
        {cell?.source === 'manual' && <sup title="Manually entered" style={{ marginLeft: 2, color: 'var(--tc-muted)' }}>*</sup>}
        <span className="pen"><PenLine size={10} /></span>
      </span>
    </td>
  )
}

function ValueMatrix({ pivot, cashAddsByYear, editable, onSave }) {
  const now         = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const years = [...new Set([...Object.keys(pivot).map(Number), currentYear])]
    .sort((a, b) => a - b)
    .slice(-6)

  const hasCashAdds = years.some(y => cashAddsByYear[y] > 0)

  return (
    <div className="tbl-wrap">
      <table className="tbl matrix">
        <thead>
          <tr>
            <th>Month</th>
            {years.map(y => <th key={y}>{y}</th>)}
          </tr>
        </thead>
        <tbody>
          {hasCashAdds && (
            <tr className="total">
              <td>Cash Adds</td>
              {years.map(y => (
                <td key={y} className="num">{cashAddsByYear[y] > 0 ? fmtCurrency(cashAddsByYear[y]) : '—'}</td>
              ))}
            </tr>
          )}
          {MONTHS.map((label, i) => {
            const m = i + 1
            return (
              <tr key={label}>
                <td>{label}</td>
                {years.map(y => {
                  const isFuture = y > currentYear || (y === currentYear && m > currentMonth)
                  return (
                    <SnapshotCell
                      key={y}
                      year={y}
                      month={m}
                      cell={pivot[y]?.[m] || null}
                      editable={editable}
                      disabled={isFuture}
                      onSave={onSave}
                    />
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function History({ portfolios = [] }) {
  const [snapshots, setSnapshots]       = useState(null)
  const [contributions, setContributions] = useState([])
  const [selected, setSelected]         = useState('ALL')

  const load = () => {
    getValueSnapshots().then(setSnapshots).catch(console.error)
    getContributionsMonthly().then(setContributions).catch(console.error)
  }

  useEffect(() => { load() }, [])

  const codes = portfolios.map(p => ({ code: p.code, label: p.name || p.code }))
  const portfolioIdByCode = {}
  portfolios.forEach(p => { portfolioIdByCode[p.code] = p.id })
  const pills = [{ code: 'ALL', label: 'All' }, ...codes]

  const rowsByCode = {}
  ;(snapshots || []).forEach(s => {
    if (!rowsByCode[s.portfolio_code]) rowsByCode[s.portfolio_code] = []
    rowsByCode[s.portfolio_code].push(s)
  })

  const pivotByCode = {}
  Object.entries(rowsByCode).forEach(([code, rows]) => { pivotByCode[code] = buildPivot(rows) })

  const selectedCodes = selected === 'ALL' ? codes.map(c => c.code) : [selected]
  const pivot = selected === 'ALL'
    ? sumPivots(selectedCodes.map(c => pivotByCode[c] || {}))
    : (pivotByCode[selected] || {})

  /* Latest value: sum each portfolio's own most recent snapshot (dates need not align). */
  let latest = null
  {
    let total = 0, any = false, latestDate = null
    selectedCodes.forEach(code => {
      const rows = rowsByCode[code]
      if (!rows || !rows.length) return
      const last = rows[rows.length - 1]
      total += last.total_value
      any = true
      if (!latestDate || last.date > latestDate) latestDate = last.date
    })
    if (any) latest = { value: total, date: latestDate }
  }

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const prevMonthYear  = currentMonth === 1 ? currentYear - 1 : currentYear
  const prevMonth      = currentMonth === 1 ? 12 : currentMonth - 1

  const changeThisMonth = latest && pivotValue(pivot, prevMonthYear, prevMonth) != null
    ? latest.value - pivotValue(pivot, prevMonthYear, prevMonth)
    : null
  const changeYTD = latest && pivotValue(pivot, currentYear - 1, 12) != null
    ? latest.value - pivotValue(pivot, currentYear - 1, 12)
    : null

  const filteredContrib = selected === 'ALL'
    ? contributions
    : contributions.filter(c => c.portfolio_code === selected)
  const cashAddsByYear = {}
  filteredContrib.forEach(c => { cashAddsByYear[c.year] = (cashAddsByYear[c.year] || 0) + c.total })

  const handleSave = async (year, month, value) => {
    const portfolioId = portfolioIdByCode[selected]
    if (!portfolioId) return
    const cell = pivot[year]?.[month]
    const isCurrentMonth = year === currentYear && month === currentMonth
    const targetDate = cell?.date || (isCurrentMonth ? todayISO() : monthEndISO(year, month))
    await setValueSnapshot(portfolioId, targetDate, value)
    load()
  }

  return (
    <div>
      {/* ── Page head ── */}
      <div className="page-head">
        <div>
          <div className="eyebrow">Portfolio value</div>
          <div className="page-title mt2">End-of-month value by year</div>
          <div className="page-sub">Daily snapshot · end-of-month for closed months, latest for the current month</div>
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
      {snapshots !== null && latest && (
        <div className="kpis grid-3" style={{ marginBottom: 22 }}>
          <div className="kpi">
            <div className="k">Latest value</div>
            <div className="v num">{fmtKPI(latest.value)}</div>
            <div className="d">as of {latest.date}</div>
          </div>
          <div className="kpi">
            <div className="k">Change this month</div>
            <div className="v num">{fmtDelta(changeThisMonth)}</div>
            <div className="d">vs prior month-end</div>
          </div>
          <div className="kpi">
            <div className="k">Change YTD</div>
            <div className="v num">{fmtDelta(changeYTD)}</div>
            <div className="d">vs {currentYear - 1} year-end</div>
          </div>
        </div>
      )}

      {/* ── Value matrix ── */}
      <div className="tc-card">
        <div className="tc-card-head">
          <div className="t">Value by month</div>
          <div className="a">CAD</div>
        </div>
        {snapshots === null && (
          <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>Loading…</p>
        )}
        {snapshots !== null && (
          <ValueMatrix pivot={pivot} cashAddsByYear={cashAddsByYear} editable={selected !== 'ALL'} onSave={handleSave} />
        )}
      </div>

      <div className="row between" style={{ flexWrap: 'wrap', gap: 18, marginTop: 12 }}>
        <span className="note"><PenLine size={11} /> Click a cell to backfill or correct a value</span>
        <span className="note">* manually entered</span>
      </div>
    </div>
  )
}
