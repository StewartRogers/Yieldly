import { useState, useEffect } from 'react'
import { PenLine, Check, Pencil, X } from 'lucide-react'
import { fmtCurrencyTrim } from '../utils/format'
import { buildPivot, sumPivots, pivotValue, momChange, yearTotal, yoyChange } from '../utils/historyMatrix'
import { Input } from '@/components/ui/input'
import { getValueSnapshots, getContributionsMonthly, setValueSnapshot } from '../api/client'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const YEAR_SPAN = 6

function todayISO() {
  return new Date().toLocaleDateString('en-CA')
}

// Last calendar day of `month` (1-indexed) in `year`, as YYYY-MM-DD.
function monthEndISO(year, month) {
  const d = new Date(year, month, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtPctChange(v) {
  if (v == null) return <span className="dim">—</span>
  const sign = v >= 0 ? '▲' : '▼'
  return <span className={v >= 0 ? 'up' : 'down'}>{sign} {Math.abs(v).toFixed(1)}%</span>
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
    return <td className="num">{cell ? fmtCurrencyTrim(cell.value) : '—'}</td>
  }

  return (
    <td
      className="num cursor-pointer select-none"
      onClick={startEdit}
      title={cell ? 'Click to correct this value' : 'Click to add a value'}
    >
      <span className="editable num">
        {cell ? fmtCurrencyTrim(cell.value) : '—'}
        {cell?.source === 'manual' && <sup title="Manually entered" style={{ marginLeft: 2, color: 'var(--tc-muted)' }}>*</sup>}
        <span className="pen"><PenLine size={10} /></span>
      </span>
    </td>
  )
}

// Widest formatted cell text across the whole matrix (values + headers),
// used to size every data column identically to the narrowest fit.
function measureColCh(pivot, years, cashAddsByYear, currentYear, currentMonth) {
  let maxLen = 'MoM %'.length
  years.forEach(y => {
    maxLen = Math.max(maxLen, String(y).length)
    if (cashAddsByYear[y] > 0) maxLen = Math.max(maxLen, fmtCurrencyTrim(cashAddsByYear[y]).length)
    for (let m = 1; m <= 12; m++) {
      const v = pivotValue(pivot, y, m)
      if (v != null) maxLen = Math.max(maxLen, fmtCurrencyTrim(v).length)
      const pct = momChange(pivot, y, m)
      if (pct != null) maxLen = Math.max(maxLen, (Math.abs(pct).toFixed(1) + '%').length + 2)
    }
    const total = yearTotal(pivot, y, currentYear, currentMonth)
    if (total != null) maxLen = Math.max(maxLen, fmtCurrencyTrim(total).length)
    const yoy = yoyChange(pivot, y, currentYear, currentMonth)
    if (yoy != null) maxLen = Math.max(maxLen, (Math.abs(yoy).toFixed(1) + '%').length + 2)
  })
  return maxLen + 8
}

function ValueMatrix({ pivot, cashAddsByYear, editable, onSave }) {
  const now         = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const years = Array.from({ length: YEAR_SPAN }, (_, i) => currentYear - YEAR_SPAN + 1 + i)
  const lastYear = years[years.length - 1]

  const hasCashAdds = years.some(y => cashAddsByYear[y] > 0)
  const colCh = measureColCh(pivot, years, cashAddsByYear, currentYear, currentMonth)
  const colStyle = { width: `${colCh}ch`, minWidth: `${colCh}ch`, maxWidth: `${colCh}ch` }
  const labelCh = (hasCashAdds ? 'Cash Adds' : 'Month').length + 6
  const labelStyle = { width: `${labelCh}ch`, minWidth: `${labelCh}ch` }

  return (
    <div className="tbl-wrap">
      <table className="tbl matrix">
        <colgroup>
          <col style={labelStyle} />
          {years.map(y => <col key={y} style={colStyle} />)}
          <col style={colStyle} />
        </colgroup>
        <thead>
          <tr>
            <th>Month</th>
            {years.map(y => <th key={y}>{y}</th>)}
            <th>MoM %</th>
          </tr>
        </thead>
        <tbody>
          {hasCashAdds && (
            <tr className="total">
              <td>Cash Adds</td>
              {years.map(y => (
                <td key={y} className="num">{cashAddsByYear[y] > 0 ? fmtCurrencyTrim(cashAddsByYear[y]) : '—'}</td>
              ))}
              <td className="num dim">—</td>
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
                <td className="num">{fmtPctChange(momChange(pivot, lastYear, m))}</td>
              </tr>
            )
          })}
          <tr className="total">
            <td>Total</td>
            {years.map(y => (
              <td key={y} className="num">{fmtCurrencyTrim(yearTotal(pivot, y, currentYear, currentMonth))}</td>
            ))}
            <td className="num dim">—</td>
          </tr>
          <tr className="total">
            <td>YoY %</td>
            {years.map(y => (
              <td key={y} className="num">{fmtPctChange(yoyChange(pivot, y, currentYear, currentMonth))}</td>
            ))}
            <td className="num dim">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default function History({ portfolios = [] }) {
  const [snapshots, setSnapshots]       = useState(null)
  const [contributions, setContributions] = useState([])
  const [selected, setSelected]         = useState('ALL')
  const [editMode, setEditMode]         = useState(false)

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

  const filteredContrib = selected === 'ALL'
    ? contributions
    : contributions.filter(c => c.portfolio_code === selected)
  const cashAddsByYear = {}
  filteredContrib.forEach(c => { cashAddsByYear[c.year] = (cashAddsByYear[c.year] || 0) + c.total })

  const handleSave = async (year, month, value) => {
    const portfolioId = portfolioIdByCode[selected]
    if (!portfolioId) return
    const now = new Date()
    const cell = pivot[year]?.[month]
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1
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
              onClick={() => { setSelected(p.code); setEditMode(false) }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Value matrix ── */}
      <div className="tc-card">
        <div className="tc-card-head">
          <div className="t">Value by month</div>
          <div className="row" style={{ gap: 12 }}>
            <div className="a">CAD</div>
            {selected !== 'ALL' && (
              <button
                type="button"
                className={`tc-btn sm${editMode ? '' : ' ghost'}`}
                onClick={() => setEditMode(v => !v)}
              >
                {editMode ? <><X size={13} /> Done</> : <><Pencil size={13} /> Edit</>}
              </button>
            )}
          </div>
        </div>
        {snapshots === null && (
          <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>Loading…</p>
        )}
        {snapshots !== null && (
          <ValueMatrix pivot={pivot} cashAddsByYear={cashAddsByYear} editable={selected !== 'ALL' && editMode} onSave={handleSave} />
        )}
      </div>

      <div className="row between" style={{ flexWrap: 'wrap', gap: 18, marginTop: 12 }}>
        <span className="note">
          <PenLine size={11} />
          {selected === 'ALL'
            ? ' Switch to a single portfolio to edit values'
            : editMode ? ' Click a cell to backfill or correct a value' : ' Click Edit to backfill or correct values'}
        </span>
        <span className="note">* manually entered</span>
      </div>
    </div>
  )
}
