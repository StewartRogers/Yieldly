import { useState, useEffect } from 'react'
import { RefreshCw, PenLine, Check, ClipboardCopy, FileText } from 'lucide-react'
import { fmtCurrency, fmtCurrencyTrim } from '../utils/format'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { getOverview, refreshAllPrices, updateCashBalance, getPortfolioSummary } from '../api/client'

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
      await updateCashBalance(portfolio.id, value)
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
          <Input className="h-7 w-28 text-right tabular-nums" type="text" inputMode="decimal"
            aria-label={`Cash balance for ${portfolio.name || portfolio.code}`}
            value={input} onChange={e => setInput(e.target.value)} placeholder="Amount" autoFocus />
          <button type="submit" className="tc-btn sm ghost" title="Save" style={{ padding: '0 6px' }}><Check size={13} /></button>
          <button type="button" className="tc-btn sm ghost" onClick={cancel} title="Cancel" style={{ padding: '0 6px' }}>✕</button>
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

function OverviewTable({ data, onRefresh, totalCash, totalInv, totalMkt }) {
  const allCashSet = data.every(p => p.cash !== null)
  const totalVal   = totalMkt + totalCash

  return (
    <>
      <div className="tbl-wrap no-inner-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Portfolio</th>
              <th>Cash balance</th>
              <th>Cash invested</th>
              <th>Market value</th>
              <th>Total value</th>
            </tr>
          </thead>
          <tbody>
            {data.map(p => {
              const mkt = p.market_value > 0 ? p.market_value : 0
              const cash = p.cash ?? 0
              const total = mkt + cash
              return (
                <tr key={p.id}>
                  <td>{p.name || p.code}</td>
                  <CashCell portfolio={p} onRefresh={onRefresh} />
                  <td className="num">{fmtCurrencyTrim(p.cash_invested)}</td>
                  <td className="num">{p.market_value > 0 ? fmtCurrencyTrim(p.market_value) : '—'}</td>
                  <td className="num">{p.cash !== null || p.market_value > 0 ? fmtCurrencyTrim(total) : '—'}</td>
                </tr>
              )
            })}
            <tr className="total">
              <td>Grand total</td>
              <td style={{ textAlign: 'right' }}>
                <span className="editable num" style={{ cursor: 'default' }}>
                  {allCashSet ? fmtCurrency(totalCash) : '—'}
                  <span className="pen" style={{ visibility: 'hidden' }}><PenLine size={10} /></span>
                </span>
              </td>
              <td className="num">{fmtCurrencyTrim(totalInv)}</td>
              <td className="num">{totalMkt > 0 ? fmtCurrencyTrim(totalMkt) : '—'}</td>
              <td className="num">{allCashSet && totalMkt > 0 ? fmtCurrencyTrim(totalVal) : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

function HoldingsExportCard({ portfolios }) {
  const toast = useToast()
  const [selected, setSelected]     = useState(() => new Set(portfolios.map(p => p.id)))
  const [text, setText]             = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError]     = useState('')

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const generate = async () => {
    const chosen = portfolios.filter(p => selected.has(p.id))
    if (chosen.length === 0) {
      setGenError('Select at least one portfolio.')
      setText('')
      return
    }
    setGenError('')
    setGenerating(true)
    try {
      const results = await Promise.all(chosen.map(p => getPortfolioSummary(p.id)))
      const sections = chosen.map((p, i) => {
        const holdings = results[i]
          .filter(h => h.shares > 0)
          .sort((a, b) => a.ticker.localeCompare(b.ticker))
        const label = p.name || p.code
        const cash = p.cash ?? 0
        const mkt = p.market_value > 0 ? p.market_value : 0
        const header = `${label} - ${fmtCurrency(mkt + cash)}`
        const cashLine = `CASH - 0 - ${fmtCurrency(cash)}`
        const lines = holdings.map(h => {
          const year = h.first_buy_date ? h.first_buy_date.slice(0, 4) : '—'
          const shares = h.shares.toLocaleString('en-CA', { maximumFractionDigits: 4 })
          return `${h.ticker} - ${shares} - ${fmtCurrency(h.market_value)} - ${year}`
        })
        return [header, cashLine, ...lines].join('\n')
      })
      setText(sections.join('\n\n'))
    } catch (e) {
      setGenError(e.message || 'Could not generate summary')
    } finally {
      setGenerating(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied to clipboard')
    } catch {
      toast.error('Could not copy — select the text and copy manually')
    }
  }

  return (
    <div className="tc-card">
      <div className="tc-card-head">
        <div className="t">Export holdings as text</div>
        <div className="a">For pasting into an AI chat or notes</div>
      </div>
      <div className="tc-card-pad flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-foreground">Portfolios to include</span>
          <div className="flex flex-col gap-2">
            {portfolios.map(p => (
              <label key={p.id} className="tc-checkbox-label">
                <input
                  type="checkbox"
                  className="tc-checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                />
                {p.name || p.code}
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button type="button" className="tc-btn sm primary" onClick={generate} disabled={generating}>
            <FileText size={13} /> {generating ? 'Generating…' : 'Generate summary'}
          </button>
          {text && (
            <button type="button" className="tc-btn sm ghost" onClick={copy}>
              <ClipboardCopy size={13} /> Copy
            </button>
          )}
        </div>

        {genError && <p className="text-destructive text-sm">{genError}</p>}

        {text && (
          <Textarea
            readOnly
            value={text}
            aria-label="Generated holdings summary"
            className="min-h-48 font-mono text-sm"
            onFocus={e => e.target.select()}
          />
        )}
      </div>
    </div>
  )
}

export default function Summary({ pricesTick = 0 }) {
  // null = not loaded yet, [] = loaded and genuinely empty. Initialising to []
  // made those two states indistinguishable, so a brand-new account with no
  // portfolios sat on "Loading…" forever while the header read "0 accounts".
  const [overview, setOverview]     = useState(null)
  const [loadError, setLoadError]   = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState(null)
  const [updatedAt, setUpdatedAt]   = useState(null)

  const loadOverview = () => {
    setLoadError('')
    return getOverview()
      .then(data => { setOverview(data); setUpdatedAt(new Date()) })
      .catch(e => setLoadError(e.message || 'Could not load your accounts'))
  }

  /* Initial load + ACB (ACB data doesn't change on price refresh) */
  useEffect(() => {
    loadOverview()
  }, [])

  /* Re-fetch market values when nav refresh fires */
  useEffect(() => {
    if (pricesTick > 0) loadOverview()
  }, [pricesTick])

  const refreshAll = async () => {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const result = await refreshAllPrices()
      setRefreshMsg({ success: true, text: result.message, errors: result.errors })
      loadOverview()
    } catch (e) {
      setRefreshMsg({ success: false, text: e.message })
    } finally {
      setRefreshing(false)
    }
  }

  /* derived totals — `overview` is null until the first load resolves */
  const rows          = overview ?? []
  const totalMkt      = rows.reduce((s, p) => s + p.market_value, 0)
  const totalCash     = rows.reduce((s, p) => s + (p.cash ?? 0), 0)
  const totalInvested = rows.reduce((s, p) => s + p.cash_invested, 0)
  const totalValue    = totalMkt + totalCash
  const allTimePL     = totalMkt - totalInvested
  const allTimePct    = totalInvested > 0 ? (allTimePL / totalInvested) * 100 : 0
  const cashAccounts  = rows.filter(p => p.cash != null).length
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
          {rows.length > 0 && (
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
      {rows.length > 0 && (
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
            {overview === null ? '—' : `${rows.length} accounts`}
            {updatedAt && <> · <span className="faint-txt">prices updated {fmtTime(updatedAt)}</span></>}
          </div>
        </div>
        {loadError ? (
          <div style={{ padding: '16px 20px' }}>
            <p className="text-destructive text-sm">{loadError}</p>
            <button type="button" className="tc-btn sm ghost mt2" onClick={loadOverview}>Try again</button>
          </div>
        ) : overview === null ? (
          <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>Loading…</p>
        ) : rows.length === 0 ? (
          <div style={{ padding: '16px 20px' }}>
            <p className="muted-txt text-sm">No portfolios yet.</p>
            <p className="faint-txt text-sm mt2">Create one on the Portfolios page to start tracking holdings.</p>
          </div>
        ) : (
          <OverviewTable data={rows} onRefresh={loadOverview} totalCash={totalCash} totalInv={totalInvested} totalMkt={totalMkt} />
        )}
      </div>

      {rows.length > 0 && <HoldingsExportCard portfolios={rows} />}

      <div className="row between">
        <span className="note"><PenLine size={11} /> Tap a cash balance to edit inline</span>
        <span className="note">Cash invested = Buy total − Sale total</span>
      </div>

    </div>
  )
}
