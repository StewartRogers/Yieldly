import { useState, useEffect } from 'react'
import { fmtCurrency } from '../utils/format'
import { getPortfolioTransactions, createTransaction, deleteTransaction } from '../api/client'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'

const PER_PAGE = 20
const CASH_ONLY_TYPES = new Set(['DIVIDEND', 'CONTRIBUTION', 'WITHDRAWAL'])
const CASH_FLOW_TYPES = new Set(['CONTRIBUTION', 'WITHDRAWAL'])

const TYPE_BADGE = {
  BUY:               'buy',
  SELL:              'sell',
  DIVIDEND:          'div',
  DIVIDEND_REINVEST: 'reinvest',
  CONTRIBUTION:      'contrib',
  WITHDRAWAL:        'withdraw',
}

const TYPE_LABEL = {
  BUY:               'Buy',
  SELL:              'Sell',
  DIVIDEND:          'Dividend',
  DIVIDEND_REINVEST: 'Reinvest',
  CONTRIBUTION:      'Contribution',
  WITHDRAWAL:        'Withdrawal',
}

const FIELD_LABEL = 'text-[11px] font-semibold uppercase tracking-[.08em] text-foreground/60'

function Pager({ page, totalPages, onChange }) {
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
        Showing <span className="num">{(page-1)*PER_PAGE+1}–{Math.min(page*PER_PAGE, totalPages*PER_PAGE)}</span>
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

export default function Transactions({ portfolios }) {
  const [formPortfolioId, setFormPortfolioId] = useState('')
  const [type, setType]                       = useState('BUY')
  const [ticker, setTicker]                   = useState('')
  const [quantity, setQuantity]               = useState('')
  const [price, setPrice]                     = useState('')
  const [total, setTotal]                     = useState('')
  const [commission, setCommission]           = useState('')
  const [date, setDate]                       = useState(new Date().toISOString().slice(0, 10))
  const [allTxns, setAllTxns]                 = useState([])
  const [historyFilter, setFilter]            = useState('ALL')
  const [page, setPage]                       = useState(1)
  const [loading, setLoading]                 = useState(false)

  const isCashOnly = CASH_ONLY_TYPES.has(type)
  const isCashFlow = CASH_FLOW_TYPES.has(type)

  useEffect(() => {
    const q = parseFloat(quantity) || 0
    const p = parseFloat(price) || 0
    if (!isCashOnly && q > 0 && p > 0) setTotal((q * p).toFixed(2))
  }, [quantity, price, isCashOnly])

  const loadAllTxns = () => {
    if (!portfolios?.length) return
    setLoading(true)
    Promise.all(
      portfolios.map(p =>
        getPortfolioTransactions(p.id)
          .then(txns => txns.map(t => ({ ...t, _portfolioId: p.id, _portfolioCode: p.code })))
      )
    )
      .then(results => {
        const merged = results.flat().sort((a, b) =>
          b.date !== a.date ? b.date.localeCompare(a.date) : b.id - a.id
        )
        setAllTxns(merged)
        setPage(1)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadAllTxns() }, [portfolios])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formPortfolioId) { alert('Select a portfolio'); return }
    const txn = {
      portfolio_id: parseInt(formPortfolioId),
      ticker: isCashFlow ? 'CASH' : ticker.trim().toUpperCase(),
      type, date,
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
      setTicker(''); setQuantity(''); setPrice(''); setTotal('')
      setCommission(''); setDate(new Date().toISOString().slice(0, 10))
      loadAllTxns()
    } catch (err) { alert(err.message) }
  }

  const deleteTxn = async (id) => {
    if (!confirm('Delete this transaction?')) return
    await deleteTransaction(id)
    loadAllTxns()
  }

  const filteredTxns = historyFilter === 'ALL'
    ? allTxns
    : allTxns.filter(t => t._portfolioId === parseInt(historyFilter))

  const totalPages = Math.max(1, Math.ceil(filteredTxns.length / PER_PAGE))
  const pageTxns   = filteredTxns.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const handleFilterChange = (f) => { setFilter(f); setPage(1) }

  return (
    <div>
      {/* ── Page head ── */}
      <div className="page-head">
        <div>
          <div className="eyebrow">Ledger</div>
          <div className="page-title mt2">Transactions</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 18, alignItems: 'start' }}>

        {/* ── Add Transaction form ── */}
        <div className="tc-card tc-card-pad">
          <div className="disp" style={{ fontSize: 17, fontWeight: 600, marginBottom: 14, color: 'var(--ink)' }}>
            Add transaction
          </div>
          <form onSubmit={handleSubmit} className="col" style={{ gap: 12 }}>

            <div className="tc-field">
              <label>Portfolio</label>
              <Select value={formPortfolioId} onValueChange={setFormPortfolioId}>
                <SelectTrigger className="h-9" style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {portfolios?.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="tc-field">
              <label>Type</label>
              <Select value={type} onValueChange={v => {
                setType(v); setTicker(''); setQuantity(''); setPrice(''); setTotal('')
              }}>
                <SelectTrigger className="h-9" style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BUY">Buy</SelectItem>
                  <SelectItem value="SELL">Sell</SelectItem>
                  <SelectItem value="DIVIDEND">Dividend</SelectItem>
                  <SelectItem value="DIVIDEND_REINVEST">Dividend Reinvest</SelectItem>
                  <SelectItem value="CONTRIBUTION">Contribution</SelectItem>
                  <SelectItem value="WITHDRAWAL">Withdrawal</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!isCashOnly && !isCashFlow && (
              <div className="tc-field">
                <label>Ticker</label>
                <Input className="h-9" placeholder="XEI.TO" value={ticker}
                  style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}
                  onChange={e => setTicker(e.target.value)} required />
              </div>
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
                  <label>{isCashFlow ? 'Amount' : 'Total'}</label>
                  <Input className="h-9" type="number" step="0.01" placeholder="0.00" value={total}
                    style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}
                    onChange={e => setTotal(e.target.value)} required />
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
            Buy · Sell · Dividend · Reinvest · Contribution · Withdrawal
          </div>
        </div>

        {/* ── Transaction history ── */}
        <div className="tc-card">
          <div className="tc-card-head">
            <div className="t">Transaction history</div>
            <div className="row" style={{ gap: 12 }}>
              <div className="pills">
                <button className={`pill${historyFilter === 'ALL' ? ' active' : ''}`} onClick={() => handleFilterChange('ALL')}>All types</button>
                {portfolios?.map(p => (
                  <button key={p.id} className={`pill${historyFilter === String(p.id) ? ' active' : ''}`} onClick={() => handleFilterChange(String(p.id))}>
                    {p.code}
                  </button>
                ))}
              </div>
              {!loading && (
                <span className="a muted-txt">
                  <span className="num">{filteredTxns.length}</span> records
                </span>
              )}
            </div>
          </div>

          {loading && <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>Loading…</p>}
          {!loading && filteredTxns.length === 0 && (
            <p className="muted-txt text-sm" style={{ padding: '16px 20px' }}>No transactions yet.</p>
          )}
          {!loading && filteredTxns.length > 0 && (
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
                              onClick={() => deleteTxn(t.id)}
                              title="Delete transaction"
                              aria-label="Delete transaction"
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
              <Pager page={page} totalPages={totalPages} onChange={setPage} />
            </>
          )}
        </div>
      </div>

      {/* ── Badge legend ── */}
      <div className="row mt4" style={{ flexWrap: 'wrap', gap: 14 }}>
        {['buy','sell','div','reinvest','contrib','withdraw'].map(cls => {
          const labels = { buy:'Buy', sell:'Sell', div:'Dividend', reinvest:'Reinvest', contrib:'Contribution', withdraw:'Withdrawal' }
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
