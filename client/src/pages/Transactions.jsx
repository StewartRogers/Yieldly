import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { fmtCurrency } from '../utils/format'
import { getPortfolioTransactions, createTransaction, createTransfer, deleteTransaction } from '../api/client'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { Trash2, X } from 'lucide-react'

const PER_PAGE = 20
const CASH_ONLY_TYPES = new Set(['DIVIDEND', 'CONTRIBUTION', 'WITHDRAWAL'])
const CASH_FLOW_TYPES = new Set(['CONTRIBUTION', 'WITHDRAWAL'])
// 'TRANSFER' is a form-only pseudo-type: submitting it calls createTransfer(),
// which fans out into a linked TRANSFER_OUT/TRANSFER_IN row pair server-side —
// those two real types only ever appear in transaction history, never in the form.
const TRANSFER_LEG_TYPES = new Set(['TRANSFER_IN', 'TRANSFER_OUT'])

const TYPE_BADGE = {
  BUY:               'buy',
  SELL:              'sell',
  DIVIDEND:          'div',
  DIVIDEND_REINVEST: 'reinvest',
  CONTRIBUTION:      'contrib',
  WITHDRAWAL:        'withdraw',
  TRANSFER_IN:       'transfer',
  TRANSFER_OUT:      'transfer',
}

const TYPE_LABEL = {
  BUY:               'Buy',
  SELL:              'Sell',
  DIVIDEND:          'Dividend',
  DIVIDEND_REINVEST: 'Reinvest',
  CONTRIBUTION:      'Contribution',
  WITHDRAWAL:        'Withdrawal',
  TRANSFER:          'Transfer',
  TRANSFER_IN:       'Transfer in',
  TRANSFER_OUT:      'Transfer out',
}

// Transaction-history type filter pills — the real row types (no bare
// 'TRANSFER', since rows are always stored as the IN/OUT leg).
const TYPE_FILTER_OPTIONS = [
  { value: 'BUY',                label: 'Buy' },
  { value: 'SELL',                label: 'Sell' },
  { value: 'DIVIDEND',           label: 'Dividend' },
  { value: 'DIVIDEND_REINVEST',  label: 'Dividend Reinvest' },
  { value: 'CONTRIBUTION',       label: 'Contribution' },
  { value: 'WITHDRAWAL',         label: 'Withdrawal' },
  { value: 'TRANSFER_IN',        label: 'Transfer in' },
  { value: 'TRANSFER_OUT',       label: 'Transfer out' },
]


// toISOString() converts to UTC, so it rolls to tomorrow's date once local
// time passes UTC midnight (e.g. ~7-8pm Eastern) — use the browser's own
// local calendar date instead.
const todayLocal = () => new Date().toLocaleDateString('en-CA')

function Pager({ page, totalPages, totalCount, onChange }) {
  if (totalPages <= 1) return null
  const pages = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else if (page <= 4) {
    pages.push(1, 2, 3, 4, 5, '…', totalPages)
  } else if (page >= totalPages - 3) {
    pages.push(1, '…', totalPages-4, totalPages-3, totalPages-2, totalPages-1, totalPages)
  } else {
    pages.push(1, '…', page-1, page, page+1, '…', totalPages)
  }
  return (
    <div className="row between" style={{ padding: '14px 20px' }}>
      <span className="muted-txt" style={{ fontSize: 12.5 }}>
        Showing <span className="num">{(page-1)*PER_PAGE+1}–{Math.min(page*PER_PAGE, totalCount)}</span>
      </span>
      <div className="pager">
        <button onClick={() => onChange(page-1)} disabled={page===1}>‹</button>
        {pages.map((p, i) =>
          typeof p === 'number'
            ? <button key={i} className={p === page ? 'active' : ''} onClick={() => onChange(p)}>{p}</button>
            : <span key={i} style={{ padding: '0 4px', color: 'var(--faint)' }}>…</span>
        )}
        <button onClick={() => onChange(page+1)} disabled={page===totalPages}>›</button>
      </div>
    </div>
  )
}

/* custom: shadcn Select can't do free-text typeahead — hand-rolled combobox styled with TC tokens */
function TickerCombobox({ value, options, onChange, placeholder, required }) {
  const [open, setOpen]           = useState(false)
  const [highlight, setHighlight] = useState(0)
  const wrapRef                   = useRef(null)

  const matches = (value ? options.filter(t => t.includes(value) && t !== value) : options)
  const showList = open && matches.length > 0

  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const choose = t => { onChange(t); setOpen(false) }

  const onKeyDown = e => {
    if (!showList) {
      if (e.key === 'ArrowDown' && matches.length) { setOpen(true); setHighlight(0); e.preventDefault() }
      return
    }
    if (e.key === 'ArrowDown')      { setHighlight(h => Math.min(h + 1, matches.length - 1)); e.preventDefault() }
    else if (e.key === 'ArrowUp')   { setHighlight(h => Math.max(h - 1, 0)); e.preventDefault() }
    else if (e.key === 'Enter')     { choose(matches[highlight]); e.preventDefault() }
    else if (e.key === 'Escape')    { setOpen(false) }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <Input
        className="h-9"
        placeholder={placeholder}
        value={value}
        style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}
        onChange={e => { onChange(e.target.value.toUpperCase()); setOpen(true); setHighlight(0) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        required={required}
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
      />
      {showList && (
        <ul
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
            maxHeight: 200, overflowY: 'auto', margin: 0, padding: 4, listStyle: 'none',
            background: 'var(--panel)', border: '1px solid var(--line-2)', borderRadius: 8,
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {matches.map((t, i) => (
            <li
              key={t}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={e => { e.preventDefault(); choose(t) }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                color: 'var(--ink)',
                background: i === highlight ? 'var(--panel-2)' : 'transparent',
              }}
            >
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function Transactions({ portfolios }) {
  const toast = useToast()
  const [formPortfolioId, setFormPortfolioId] = useState('')
  const [toPortfolioId, setToPortfolioId]     = useState('')
  const [type, setType]                       = useState('BUY')
  const [market, setMarket]                   = useState('TMX')
  const [ticker, setTicker]                   = useState('')
  const [quantity, setQuantity]               = useState('')
  const [price, setPrice]                     = useState('')
  const [cashTotal, setCashTotal]             = useState('')
  const [commission, setCommission]           = useState('')
  const [date, setDate]                       = useState(todayLocal())
  const [allTxns, setAllTxns]                 = useState([])
  const [historyFilter, setFilter]            = useState('ALL')
  const [tickerFilter, setTickerFilter]       = useState('')
  const [typeFilter, setTypeFilter]           = useState([])
  const [page, setPage]                       = useState(1)
  const [loading, setLoading]                 = useState(false)
  const [loadError, setLoadError]             = useState('')

  const isTransfer = type === 'TRANSFER'
  const isCashOnly = CASH_ONLY_TYPES.has(type) || isTransfer
  const isCashFlow = CASH_FLOW_TYPES.has(type)

  // Tickers acquired in the selected portfolio — drives autocomplete + non-Buy validation
  const ownedTickers = useMemo(() => {
    if (!formPortfolioId) return []
    const pid = parseInt(formPortfolioId)
    const set = new Set()
    for (const t of allTxns) {
      if (t._portfolioId !== pid || t.ticker === 'CASH') continue
      if (t.type === 'BUY' || t.type === 'DIVIDEND_REINVEST') set.add(t.ticker)
    }
    return [...set].sort()
  }, [allTxns, formPortfolioId])

  // Derived during render rather than mirrored into state by an effect. The
  // effect only ever wrote (never cleared), so setting quantity back to 0
  // after typing a valid pair left the previous product sitting in the
  // read-only Total field — uncorrectable by the user, and submitted as
  // {quantity: 0, price: 0, total: 1000}.
  const autoTotal = (() => {
    const q = parseFloat(quantity) || 0
    const p = parseFloat(price) || 0
    return q > 0 && p > 0 ? (q * p).toFixed(2) : ''
  })()
  // `total` is the user-entered amount on cash-only forms, the computed
  // product otherwise. One value, so submit and display can never disagree.
  const total = isCashOnly ? cashTotal : autoTotal

  // Monotonic batch id. loadAllTxns fires one request per portfolio and is
  // called after every create/transfer/delete, so two batches are easily in
  // flight at once. Batch order is not completion order: an older batch
  // resolving last used to overwrite newer data — deleting two rows quickly
  // made the first one reappear in the list, with every derived total wrong
  // until the next reload.
  const txnsReq = useRef(0)

  const loadAllTxns = useCallback(() => {
    if (!portfolios?.length) return
    const reqId = ++txnsReq.current
    setLoading(true)
    setLoadError('')
    Promise.all(
      portfolios.map(p =>
        getPortfolioTransactions(p.id)
          .then(txns => txns.map(t => ({ ...t, _portfolioId: p.id, _portfolioCode: p.code })))
      )
    )
      .then(results => {
        if (reqId !== txnsReq.current) return
        const merged = results.flat().sort((a, b) =>
          b.date !== a.date ? b.date.localeCompare(a.date) : b.id - a.id
        )
        setAllTxns(merged)
        // NOTE: deliberately does NOT reset the page. Resetting here threw the
        // user back to page 1 after every delete, so clearing a run of bad
        // imported rows meant paging back in each time. `clampedPage` below
        // keeps the view valid when the list shrinks instead.
      })
      .catch(e => {
        if (reqId !== txnsReq.current) return
        setLoadError(e.message || 'Could not load transactions')
      })
      .finally(() => {
        // Don't let a superseded batch clear the spinner while the newer one
        // is still running.
        if (reqId === txnsReq.current) setLoading(false)
      })
  }, [portfolios])

  useEffect(() => { loadAllTxns() }, [loadAllTxns])

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (isTransfer) {
      if (!formPortfolioId || !toPortfolioId) { toast.error('Select both portfolios'); return }
      if (formPortfolioId === toPortfolioId) { toast.error('From and To portfolios must differ'); return }
      const amount = parseFloat(total)
      if (!(amount > 0)) { toast.error('Enter a positive amount'); return }
      try {
        await createTransfer({
          from_portfolio_id: parseInt(formPortfolioId),
          to_portfolio_id:   parseInt(toPortfolioId),
          amount, date,
        })
        setCashTotal(''); setToPortfolioId(''); setDate(todayLocal())
        loadAllTxns()
      } catch (err) { toast.error(err.message) }
      return
    }

    if (!formPortfolioId) { toast.error('Select a portfolio'); return }
    // Non-Buy ticketed transactions must reference a stock already held in this portfolio
    if (!isCashFlow && type !== 'BUY') {
      const tk = ticker.trim().toUpperCase()
      if (!ownedTickers.includes(tk)) {
        toast.error(`You don't own ${tk || 'that stock'} in this portfolio. Add a Buy transaction first, or pick an existing holding.`)
        return
      }
    }
    const txn = {
      portfolio_id: parseInt(formPortfolioId),
      ticker: isCashFlow ? 'CASH' : ticker.trim().toUpperCase(),
      type, date, market,
    }
    if (isCashOnly) {
      txn.quantity = 0; txn.price = 0; txn.total = parseFloat(total)
    } else {
      txn.quantity = parseFloat(quantity)
      txn.price    = parseFloat(price)
      const t = parseFloat(total)
      if (t > 0) txn.total = t
      const c = parseFloat(commission) || 0
      if (c > 0) txn.commission = c
    }
    try {
      await createTransaction(txn)
      setTicker(''); setQuantity(''); setPrice(''); setCashTotal('')
      setCommission(''); setDate(todayLocal()); setMarket('TMX')
      loadAllTxns()
    } catch (err) { toast.error(err.message) }
  }

  const deleteTxn = async (t) => {
    const msg = TRANSFER_LEG_TYPES.has(t.type)
      ? 'Delete this transfer? This removes both the outgoing and incoming entries.'
      : 'Delete this transaction?'
    if (!confirm(msg)) return
    try {
      await deleteTransaction(t.id)
      loadAllTxns()
    } catch (err) { toast.error(err.message) }
  }

  const filteredTxns = allTxns
    .filter(t => historyFilter === 'ALL' || t._portfolioId === parseInt(historyFilter))
    .filter(t => !tickerFilter || t.ticker.includes(tickerFilter))
    .filter(t => typeFilter.length === 0 || typeFilter.includes(t.type))

  const totalPages = Math.max(1, Math.ceil(filteredTxns.length / PER_PAGE))
  // Clamp rather than reset. If the list shrinks (a delete, or a filter that
  // matches fewer rows) an out-of-range `page` would slice to [] and render a
  // table header with zero rows, while Pager hides itself when totalPages <= 1
  // — leaving no way to navigate back.
  const clampedPage = Math.min(page, totalPages)
  const pageTxns    = filteredTxns.slice((clampedPage - 1) * PER_PAGE, clampedPage * PER_PAGE)

  // The portfolio pills are a scope selector, not a row filter — "Clear
  // filters" deliberately leaves the selected account alone rather than
  // yanking the user out of the portfolio they're looking at.
  const hasRowFilter = !!tickerFilter || typeFilter.length > 0
  const clearFilters = () => {
    setTickerFilter(''); setTypeFilter([]); setPage(1)
  }

  const handleFilterChange = (f) => { setFilter(f); setPage(1) }
  const handleTickerFilterChange = (v) => { setTickerFilter(v.toUpperCase()); setPage(1) }
  const handleTypeFilterChange = (v) => { setTypeFilter(v); setPage(1) }
  const toggleTypeFilter = (v) => {
    setTypeFilter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
    setPage(1)
  }

  return (
    <div>
      {/* ── Page head ── */}
      <div className="page-head">
        <div>
          <div className="eyebrow">Ledger</div>
          <div className="page-title mt2">Transactions</div>
        </div>
      </div>

      <div className="tx-layout">

        {/* ── Add Transaction form ── */}
        <div className="tc-card tc-card-pad">
          <div className="disp" style={{ fontSize: 17, fontWeight: 600, marginBottom: 14, color: 'var(--ink)' }}>
            Add transaction
          </div>
          <form onSubmit={handleSubmit} className="col" style={{ gap: 12 }}>

            {!isTransfer ? (
              <div className="tc-field">
                <label>Portfolio</label>
                <Select value={formPortfolioId} onValueChange={setFormPortfolioId}>
                  <SelectTrigger className="h-9 w-full" style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}>
                    {/* base-ui Select.Value shows raw value string, so we render the label ourselves */}
                    <span className="flex flex-1 text-left text-sm truncate" style={{ color: formPortfolioId ? 'var(--ink)' : 'var(--tc-muted)' }}>
                      {formPortfolioId
                        ? (() => { const p = portfolios?.find(p => String(p.id) === formPortfolioId); return p ? `${p.code} — ${p.name}` : 'Select…' })()
                        : 'Select portfolio…'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {portfolios?.map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="grid-2">
                <div className="tc-field">
                  <label>From portfolio</label>
                  <Select value={formPortfolioId} onValueChange={setFormPortfolioId}>
                    <SelectTrigger className="h-9 w-full" style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}>
                      <span className="flex flex-1 text-left text-sm truncate" style={{ color: formPortfolioId ? 'var(--ink)' : 'var(--tc-muted)' }}>
                        {formPortfolioId
                          ? (() => { const p = portfolios?.find(p => String(p.id) === formPortfolioId); return p ? p.code : 'Select…' })()
                          : 'Select…'}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {portfolios?.map(p => (
                        <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="tc-field">
                  <label>To portfolio</label>
                  <Select value={toPortfolioId} onValueChange={setToPortfolioId}>
                    <SelectTrigger className="h-9 w-full" style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}>
                      <span className="flex flex-1 text-left text-sm truncate" style={{ color: toPortfolioId ? 'var(--ink)' : 'var(--tc-muted)' }}>
                        {toPortfolioId
                          ? (() => { const p = portfolios?.find(p => String(p.id) === toPortfolioId); return p ? p.code : 'Select…' })()
                          : 'Select…'}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {portfolios?.map(p => (
                        <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="tc-field">
              <label>Type</label>
              <Select value={type} onValueChange={v => {
                setType(v); setTicker(''); setQuantity(''); setPrice(''); setCashTotal(''); setToPortfolioId('')
              }}>
                <SelectTrigger className="h-9 w-full" style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}>
                  <span className="flex flex-1 text-left text-sm">{TYPE_LABEL[type] ?? type}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BUY">Buy</SelectItem>
                  <SelectItem value="SELL">Sell</SelectItem>
                  <SelectItem value="DIVIDEND">Dividend</SelectItem>
                  <SelectItem value="DIVIDEND_REINVEST">Dividend Reinvest</SelectItem>
                  <SelectItem value="CONTRIBUTION">Contribution</SelectItem>
                  <SelectItem value="WITHDRAWAL">Withdrawal</SelectItem>
                  <SelectItem value="TRANSFER">Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!isCashFlow && !isTransfer && (
              <>
                <div className="tc-field">
                  <label>Ticker</label>
                  <TickerCombobox
                    value={ticker}
                    options={ownedTickers}
                    onChange={setTicker}
                    placeholder="XEI.TO"
                    required
                  />
                </div>
                <div className="tc-field">
                  <label>Market</label>
                  <Select value={market} onValueChange={setMarket}>
                    <SelectTrigger className="h-9 w-full" style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}>
                      <span className="flex flex-1 text-left text-sm">{{ TMX: 'TMX (Toronto)', NYSE: 'NYSE (New York)', NASDAQ: 'NASDAQ' }[market] ?? market}</span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TMX">TMX (Toronto)</SelectItem>
                      <SelectItem value="NYSE">NYSE (New York)</SelectItem>
                      <SelectItem value="NASDAQ">NASDAQ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {!isCashOnly && (
              <>
                <div className="grid-2">
                  <div className="tc-field">
                    <label>Quantity</label>
                    <Input className="h-9" type="number" step="0.0001" placeholder="100" value={quantity}
                      style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}
                      onChange={e => setQuantity(e.target.value)} required />
                  </div>
                  <div className="tc-field">
                    <label>Price / share</label>
                    <Input className="h-9" type="number" step="0.01" placeholder="139.20" value={price}
                      style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}
                      onChange={e => setPrice(e.target.value)} required />
                  </div>
                </div>

                <div className="tc-field">
                  <label>Total (auto)</label>
                  {/* tabIndex={-1}: intentional skip target — read-only derived field */}
                  <Input
                    className="h-9"
                    style={{ background: 'var(--panel-2)', borderStyle: 'dashed', borderColor: 'var(--line-2)', color: 'var(--ink)' }}
                    type="number" step="0.01"
                    value={total}
                    readOnly
                    tabIndex={-1}
                  />
                </div>

                <div className="grid-2">
                  <div className="tc-field">
                    <label>Commission</label>
                    <Input className="h-9" type="number" step="0.01" placeholder="9.95" min="0" value={commission}
                      style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}
                      onChange={e => setCommission(e.target.value)} />
                  </div>
                  <div className="tc-field">
                    <label>Date</label>
                    <Input className="h-9" type="date" value={date}
                      style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}
                      onChange={e => setDate(e.target.value)} required />
                  </div>
                </div>
              </>
            )}

            {isCashOnly && (
              <div className="grid-2">
                <div className="tc-field">
                  <label>{(isCashFlow || isTransfer) ? 'Amount' : 'Total'}</label>
                  <Input className="h-9" type="number" step="0.01" placeholder="0.00" value={total}
                    style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}
                    onChange={e => setCashTotal(e.target.value)} required />
                </div>
                <div className="tc-field">
                  <label>Date</label>
                  <Input className="h-9" type="date" value={date}
                    style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}
                    onChange={e => setDate(e.target.value)} required />
                </div>
              </div>
            )}

            <button type="submit" className="tc-btn primary block mt2">+ Add transaction</button>
          </form>

          <div className="note" style={{ justifyContent: 'center', textAlign: 'center', lineHeight: 1.5, marginTop: 12 }}>
            Buy · Sell · Dividend · Reinvest · Contribution · Withdrawal · Transfer
          </div>
        </div>

        {/* ── Transaction history ── */}
        <div className="tc-card">
          <div className="tc-card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div className="t">Transaction history</div>
            <div className="row" style={{ gap: 12 }}>
              <div className="pills">
                <button className={`pill${historyFilter === 'ALL' ? ' active' : ''}`} onClick={() => handleFilterChange('ALL')}>All portfolios</button>
                {portfolios?.map(p => (
                  <button key={p.id} className={`pill${historyFilter === String(p.id) ? ' active' : ''}`} onClick={() => handleFilterChange(String(p.id))}>
                    {p.code}
                  </button>
                ))}
              </div>
              <div style={{ position: 'relative' }}>
                <Input
                  className="h-8 w-32"
                  placeholder="Ticker…"
                  value={tickerFilter}
                  onChange={e => handleTickerFilterChange(e.target.value)}
                  style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)', paddingRight: tickerFilter ? 24 : undefined }}
                  aria-label="Filter by ticker"
                />
                {tickerFilter && (
                  <button
                    type="button"
                    onClick={() => handleTickerFilterChange('')}
                    aria-label="Clear ticker filter"
                    style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', color: 'var(--tc-muted)', display: 'flex' }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              {!loading && (
                <span className="a muted-txt">
                  <span className="num">{filteredTxns.length}</span> records
                </span>
              )}
            </div>
            {/* `pills full` rather than an inline width:100% — see .pills.full
                in style.css: a percentage width here made the toolbar's
                max-content width the card's minimum, overflowing phones. */}
            <div className="pills full">
              <button className={`pill${typeFilter.length === 0 ? ' active' : ''}`} onClick={() => handleTypeFilterChange([])}>All types</button>
              {TYPE_FILTER_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  className={`pill${typeFilter.includes(value) ? ' active' : ''}`}
                  onClick={() => toggleTypeFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading && <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>Loading…</p>}
          {!loading && loadError && (
            <div style={{ padding: '16px 20px' }}>
              <p className="text-destructive text-sm">{loadError}</p>
              <button type="button" className="tc-btn sm ghost mt2" onClick={loadAllTxns}>Try again</button>
            </div>
          )}
          {!loading && !loadError && filteredTxns.length === 0 && (
            // Distinguish "you have no transactions" from "your filters match
            // nothing" — with a filter active, the old copy claimed the entire
            // ledger was empty.
            hasRowFilter ? (
              <div style={{ padding: '16px 20px' }}>
                <p className="muted-txt text-sm">No transactions match these filters.</p>
                <button type="button" className="tc-btn sm ghost mt2" onClick={clearFilters}>Clear filters</button>
              </div>
            ) : historyFilter !== 'ALL' ? (
              <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>No transactions in this portfolio yet.</p>
            ) : (
              <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>No transactions yet.</p>
            )
          )}
          {!loading && !loadError && filteredTxns.length > 0 && (
            <>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Type</th>
                      <th>Shares</th>
                      <th>Price</th>
                      <th>Total</th>
                      <th>Date</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageTxns.map(t => {
                      const badgeClass = TYPE_BADGE[t.type] || 'type'
                      return (
                        <tr key={t.id}>
                          <td>
                            <span className="ticker" style={{ color: t.ticker === 'CASH' ? 'var(--faint)' : undefined }}>
                              {t.ticker}
                            </span>
                            {TRANSFER_LEG_TYPES.has(t.type) && t.transfer_peer_code && (
                              <div className="muted-txt" style={{ fontSize: 11, marginTop: 2 }}>
                                {t.type === 'TRANSFER_OUT' ? `→ ${t.transfer_peer_code}` : `← ${t.transfer_peer_code}`}
                              </div>
                            )}
                          </td>
                          <td>
                            <span className={`tc-badge ${badgeClass}`}>
                              <span className="dot" />
                              {TYPE_LABEL[t.type] || t.type}
                            </span>
                          </td>
                          <td className="num">{t.quantity > 0 ? t.quantity : '—'}</td>
                          <td className="num">{parseFloat(t.price) > 0 ? fmtCurrency(parseFloat(t.price)) : '—'}</td>
                          <td className="num">{fmtCurrency(parseFloat(t.total))}</td>
                          <td className="num" style={{ color: 'var(--tc-muted)' }}>{t.date}</td>
                          <td>
                            <button
                              className="tc-btn sm ghost danger"
                              onClick={() => deleteTxn(t)}
                              title={TRANSFER_LEG_TYPES.has(t.type) ? 'Delete transfer' : 'Delete transaction'}
                              aria-label={TRANSFER_LEG_TYPES.has(t.type) ? 'Delete transfer' : 'Delete transaction'}
                            >
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={clampedPage} totalPages={totalPages} totalCount={filteredTxns.length} onChange={setPage} />
            </>
          )}
        </div>
      </div>

      {/* ── Badge legend ── */}
      <div className="row mt4" style={{ flexWrap: 'wrap', gap: 14 }}>
        {['buy','sell','div','reinvest','contrib','withdraw','transfer'].map(cls => {
          const labels = { buy:'Buy', sell:'Sell', div:'Dividend', reinvest:'Reinvest', contrib:'Contribution', withdraw:'Withdrawal', transfer:'Transfer' }
          return (
            <span key={cls} className={`tc-badge ${cls}`}>
              <span className="dot" />{labels[cls]}
            </span>
          )
        })}
        <span className="note">each type has its own hue + dot</span>
      </div>
    </div>
  )
}
