import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, LayoutGrid, List, GripVertical, Pencil } from 'lucide-react'
import { fmtCurrency, fmtCurrencyOr, fmtPrice, fmtPct, retClass, fmtFreqCode } from '../utils/format'
import StockInfoModal from '../components/StockInfoModal'
import HoldingTransactionsModal from '../components/HoldingTransactionsModal'
import { Input } from '@/components/ui/input'
import { getPortfolioSummary, createPortfolio, refreshPortfolioPrices, updatePortfolioOrder, updatePortfolio } from '../api/client'

function HoldingCard({ holding, onEdit, onShowTxns }) {
  const hasMarket = holding.market_price > 0

  const kvRows = [
    ['Shares',    holding.shares.toFixed(4)],
    ['Buy price', fmtPrice(holding.buy_price)],
    ['Market',    hasMarket ? fmtPrice(holding.market_price) : '—'],
    ['Mkt total', hasMarket ? fmtCurrency(holding.market_value) : '—'],
    holding.sale_total > 0 ? ['Sale total', fmtCurrency(holding.sale_total)] : null,
    ['Div paid',  fmtCurrencyOr(holding.dividends_paid)],
    hasMarket && holding.dividend_yield > 0 ? ['Yield', holding.dividend_yield.toFixed(2) + '%'] : null,
    holding.dividend_frequency ? ['Freq · /sh', `${holding.dividend_frequency} · ${holding.dividend_per_share > 0 ? '$' + holding.dividend_per_share.toFixed(2) : '—'}`] : null,
    holding.annual_payout > 0 ? ['Annual', fmtCurrency(holding.annual_payout)] : null,
  ].filter(Boolean)

  const isGain = holding.return >= 0

  return (
    <div className="hold">
      <div className="top">
        <div>
          <div className="tk">{holding.ticker}</div>
          {holding.investment_type && <div className="nm">{holding.investment_type}</div>}
        </div>
        <span className="tc-badge type">
          <span className="dot" />
          {holding.investment_type || 'Stock'}
        </span>
      </div>

      <div className="kv">
        {kvRows.map(([k, v]) => [
          <span key={k}      className="k">{k}</span>,
          <span key={k+'_v'} className="v">{v}</span>,
        ])}
      </div>

      {hasMarket && (
        <div className="ret">
          <span className="lbl">Total return</span>
          <span className={`val num ${isGain ? 'up' : 'down'}`}>
            {isGain ? '+' : '−'}{fmtCurrency(Math.abs(holding.return))} · {isGain ? '+' : '−'}{Math.abs(holding.return_percent).toFixed(1)}%
          </span>
        </div>
      )}

      <div className="foot">
        <button className="tc-btn sm block" onClick={() => onEdit(holding)}>Edit</button>
        <button className="tc-btn sm primary block" onClick={() => onShowTxns(holding.ticker)}>Transactions</button>
      </div>
    </div>
  )
}

function AddHoldingCard({ portfolioCode, onClick }) {
  return (
    <button className="hold add" onClick={onClick} aria-label={`Add holding to ${portfolioCode}`}>
      <div style={{ textAlign: 'center' }}>
        <div className="plus">+</div>
        <div style={{ fontSize: 13 }}>Add holding to {portfolioCode}</div>
      </div>
    </button>
  )
}

export default function Portfolios({ portfolios, onPortfoliosChange, pricesTick = 0 }) {
  const navigate = useNavigate()
  const [localPortfolios, setLocalPortfolios] = useState([])
  const [selectedId, setSelectedId]           = useState(null)
  const [holdings, setHoldings]               = useState([])
  const [holdingsError, setHoldingsError]     = useState('')
  const [reorderError, setReorderError]       = useState('')
  const [view, setView]                       = useState('card')
  const [newName, setNewName]                 = useState('')
  const [newCode, setNewCode]                 = useState('')
  const [createError, setCreateError]         = useState('')
  const [editError, setEditError]             = useState('')
  const [refreshMsg, setRefreshMsg]           = useState('')
  const [refreshing, setRefreshing]           = useState(false)
  const [stockModal, setStockModal]           = useState(null)
  const [txModal, setTxModal]                 = useState(null)
  const [editing, setEditing]                 = useState(false)
  const [editName, setEditName]               = useState('')
  const [editCode, setEditCode]               = useState('')
  const dragId = useRef(null)

  useEffect(() => { setLocalPortfolios(portfolios) }, [portfolios])

  useEffect(() => {
    if (localPortfolios.length > 0 && !selectedId) {
      setSelectedId(localPortfolios[0].id)
    }
  }, [localPortfolios])

  // Monotonic request id. Switching portfolios fires a second /summary while
  // the first is still in flight; responses arrive in completion order, not
  // issue order, so a slow response for portfolio A could land under
  // portfolio B's tab — and then "Edit" on one of those rows would write A's
  // ticker metadata into B. Only the newest request is allowed to set state.
  const holdingsReq = useRef(0)

  const reloadHoldings = useCallback(() => {
    if (!selectedId) return
    const reqId = ++holdingsReq.current
    setHoldingsError('')
    getPortfolioSummary(selectedId)
      .then(data => {
        if (reqId !== holdingsReq.current) return
        setHoldings(data.filter(h => h.shares > 0.00005))
      })
      .catch(e => {
        if (reqId !== holdingsReq.current) return
        // Clear the rows too: leaving the previous portfolio's holdings on
        // screen under this portfolio's name and totals is indistinguishable
        // from real data in a money app.
        setHoldings([])
        setHoldingsError(e.message || 'Could not load holdings')
      })
  }, [selectedId])

  useEffect(() => { reloadHoldings() }, [reloadHoldings])

  /* Re-fetch market values when nav refresh fires */
  useEffect(() => {
    if (pricesTick > 0) reloadHoldings()
  }, [pricesTick, reloadHoldings])

  const handleCreatePortfolio = async () => {
    if (!newName.trim() || !newCode.trim()) return
    setCreateError('')
    try {
      const p = await createPortfolio({ name: newName.trim(), code: newCode.trim() })
      setNewName(''); setNewCode('')
      onPortfoliosChange()
      setSelectedId(p.id)
    } catch (e) { setCreateError(e.message) }
  }

  const refreshPrices = async () => {
    if (!selectedId) return
    setRefreshing(true)
    try {
      const result = await refreshPortfolioPrices(selectedId)
      setRefreshMsg(result.message)
      setTimeout(() => setRefreshMsg(''), 4000)
      reloadHoldings()
    } catch (e) { setRefreshMsg(e.message) }
    finally { setRefreshing(false) }
  }

  const updateOrder = async (ordered) => {
    await Promise.all(ordered.map((p, i) => updatePortfolioOrder(p.id, i + 1)))
  }

  const handleDragStart = (e, id) => { dragId.current = id; e.dataTransfer.effectAllowed = 'move' }
  const handleDragOver  = (e) => {
    // Only accept our own tab drags. Without this, handleDragOver's
    // preventDefault() made the tab strip a valid drop target for anything —
    // a file from the desktop, a text selection — and the drop below then ran
    // with dragId.current === null.
    if (dragId.current === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  const handleDrop = async (e, targetId) => {
    e.preventDefault()
    if (dragId.current === targetId) { dragId.current = null; return }

    const reordered = [...localPortfolios]
    const fromIdx   = reordered.findIndex(p => p.id === dragId.current)
    const toIdx     = reordered.findIndex(p => p.id === targetId)
    // findIndex returns -1 for an unrecognized drag, and splice(-1, 1) removes
    // the LAST element — so a stray drop silently reordered and persisted a
    // portfolio the user never touched.
    if (fromIdx === -1 || toIdx === -1) { dragId.current = null; return }

    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)

    const previous = localPortfolios
    setLocalPortfolios(reordered)
    dragId.current = null
    try {
      await updateOrder(reordered)
      onPortfoliosChange()
    } catch (err) {
      // Roll the optimistic reorder back rather than leaving an order on
      // screen that was never saved (it silently reverted on reload).
      setLocalPortfolios(previous)
      setReorderError(err.message || 'Could not save the new order')
      setTimeout(() => setReorderError(''), 5000)
    }
  }

  const startEdit = () => {
    if (!selectedPortfolio) return
    setEditName(selectedPortfolio.name || '')
    setEditCode(selectedPortfolio.code || '')
    setEditing(true)
  }

  const cancelEdit = () => { setEditing(false); setEditError('') }

  const saveEdit = async () => {
    setEditError('')
    try {
      await updatePortfolio(selectedId, { name: editName, code: editCode })
      setEditing(false)
      onPortfoliosChange()
    } catch (e) { setEditError(e.message) }
  }

  const selectedPortfolio = localPortfolios.find(p => p.id === selectedId)
  const totalMktValue     = holdings.reduce((s, h) => s + h.market_value, 0)

  return (
    <div className="flex flex-col gap-4">

      {/* ── Page head: title + create form ── */}
      <div className="page-head">
        <div>
          <div className="eyebrow">Holdings</div>
          <div className="page-title mt2">Portfolios</div>
        </div>
        <div className="row">
          <Input
            aria-label="New portfolio name"
            placeholder="New name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="h-9 w-36 text-sm"
            style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}
            onKeyDown={e => e.key === 'Enter' && handleCreatePortfolio()}
          />
          <Input
            aria-label="New portfolio code"
            placeholder="Code"
            value={newCode}
            onChange={e => setNewCode(e.target.value)}
            maxLength={5}
            className="h-9 w-20 text-sm"
            style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}
            onKeyDown={e => e.key === 'Enter' && handleCreatePortfolio()}
          />
          <button
            className="tc-btn primary"
            onClick={handleCreatePortfolio}
            disabled={!newName.trim() || !newCode.trim()}
          >
            + Create
          </button>
        </div>
        {createError && <p className="text-destructive text-xs" style={{ marginTop: 4 }}>{createError}</p>}
      </div>

      {/* ── Account tabs ── */}
      {localPortfolios.length > 0 && (
        <div className="acct-tabs">
          {localPortfolios.map(p => (
            <button
              key={p.id}
              className={`acct-tab${selectedId === p.id ? ' active' : ''}`}
              onClick={() => setSelectedId(p.id)}
              draggable
              onDragStart={(e) => handleDragStart(e, p.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, p.id)}
            >
              <span className="grip"><GripVertical size={12} /></span>
              {p.name || p.code}
            </button>
          ))}
          <span className="note" style={{ marginLeft: 6 }}>drag to reorder — saved</span>
          {reorderError && (
            <span className="text-destructive text-xs" style={{ marginLeft: 6 }}>{reorderError}</span>
          )}
        </div>
      )}

      {/* ── View toggle + stats ── */}
      {selectedPortfolio && (
        <div className="divider-row">
          <div className="row">
            <span className="eyebrow">View</span>
            <div className="seg">
              <button className={view === 'card' ? 'active' : ''} onClick={() => setView('card')}>
                <LayoutGrid size={13} /> Cards
              </button>
              <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
                <List size={13} /> List
              </button>
            </div>
          </div>
          <div className="row">
            {editing ? (
              <>
                <Input
                  aria-label="Portfolio name"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="Portfolio name"
                  className="h-7 w-36 text-sm"
                  style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
                  autoFocus
                />
                <Input
                  aria-label="Portfolio code"
                  value={editCode}
                  onChange={e => setEditCode(e.target.value.toUpperCase())}
                  placeholder="Code"
                  maxLength={5}
                  className="h-7 w-20 text-sm"
                  style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
                />
                <button className="tc-btn sm primary" onClick={saveEdit} disabled={!editName.trim() || !editCode.trim()}>Save</button>
                <button className="tc-btn sm ghost" onClick={cancelEdit}>Cancel</button>
                {editError && <span className="text-destructive text-xs">{editError}</span>}
              </>
            ) : (
              <>
                <span className="muted-txt" style={{ fontSize: 13.5 }}>
                  {selectedPortfolio.name || selectedPortfolio.code} · {holdings.length} holding{holdings.length !== 1 ? 's' : ''}
                  {totalMktValue > 0 && <> · <span className="num">{fmtCurrency(totalMktValue)}</span></>}
                </span>
                {/* custom: pencil trigger for inline portfolio name/code edit */}
                <button
                  className="tc-btn sm ghost"
                  onClick={startEdit}
                  title="Edit portfolio name and code"
                  style={{ padding: '0 6px' }}
                >
                  <Pencil size={12} />
                </button>
                <button className="tc-btn sm" onClick={refreshPrices} disabled={refreshing}>
                  <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                  {refreshing ? 'Refreshing…' : 'Refresh Prices'}
                </button>
                {refreshMsg && <span className="text-xs" style={{ color: 'var(--tc-muted)' }}>{refreshMsg}</span>}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Holdings load failure ── */}
      {holdingsError && (
        <div className="tc-card" style={{ padding: '16px 20px' }}>
          <p className="text-destructive text-sm">{holdingsError}</p>
          <button type="button" className="tc-btn sm ghost mt2" onClick={reloadHoldings}>Try again</button>
        </div>
      )}

      {/* ── Holdings: Card view ── */}
      {!holdingsError && view === 'card' && (
        <div className="holds">
          {holdings.map(h => (
            <HoldingCard
              key={h.ticker}
              holding={h}
              onEdit={setStockModal}
              onShowTxns={ticker => setTxModal(ticker)}
            />
          ))}
          {selectedPortfolio && (
            <AddHoldingCard
              portfolioCode={selectedPortfolio.name || selectedPortfolio.code}
              onClick={() => navigate('/transactions')}
            />
          )}
        </div>
      )}

      {/* ── Holdings: List view ── */}
      {!holdingsError && view === 'list' && (
        <div className="tc-card">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Type</th>
                  <th>Shares</th>
                  <th>Buy</th>
                  <th>Market</th>
                  <th>Buy total</th>
                  <th>Mkt total</th>
                  <th>Div paid</th>
                  <th>Yield</th>
                  <th>Freq</th>
                  <th>Return</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {holdings.map(h => (
                  <tr key={h.ticker}>
                    <td>
                      <span className="ticker">{h.ticker}</span>
                      {h.investment_type && <span className="sub"> {h.investment_type}</span>}
                    </td>
                    <td>
                      {h.investment_type && (
                        <span className="tc-badge type">
                          <span className="dot" />{h.investment_type}
                        </span>
                      )}
                    </td>
                    <td className="num">{h.shares.toFixed(4)}</td>
                    <td className="num">{fmtPrice(h.buy_price)}</td>
                    <td className="num">{h.market_price > 0 ? fmtPrice(h.market_price) : '—'}</td>
                    <td className="num">{fmtCurrency(h.buy_price * h.shares)}</td>
                    <td className="num">{h.market_price > 0 ? fmtCurrency(h.market_value) : '—'}</td>
                    <td className="num">{fmtCurrencyOr(h.dividends_paid)}</td>
                    <td className="num">{h.market_price > 0 && h.dividend_yield > 0 ? fmtPct(h.dividend_yield) : '—'}</td>
                    <td className="num">{fmtFreqCode(h.dividend_frequency)}</td>
                    <td className={`num ${h.market_price > 0 ? retClass(h.return) : ''}`}>
                      {h.market_price > 0
                        ? <>{h.return >= 0 ? '+' : '−'}{Math.abs(h.return_percent).toFixed(1)}%</>
                        : '—'}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button className="tc-btn sm ghost" onClick={() => setStockModal(h)}>Edit</button>
                        <button className="tc-btn sm ghost" onClick={() => setTxModal(h.ticker)}>Txns</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {holdings.length > 0 && (
                  <tr className="total">
                    <td>{holdings.length} holdings</td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td className="num">{fmtCurrency(holdings.reduce((s, h) => s + h.buy_price * h.shares, 0))}</td>
                    <td className="num">{totalMktValue > 0 ? fmtCurrency(totalMktValue) : '—'}</td>
                    <td className="num">{fmtCurrencyOr(holdings.reduce((s, h) => s + (h.dividends_paid || 0), 0))}</td>
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <StockInfoModal
        holding={stockModal}
        portfolioId={selectedId}
        onClose={() => setStockModal(null)}
        onSaved={() => { reloadHoldings(); setStockModal(null) }}
      />
      <HoldingTransactionsModal
        portfolioId={selectedId}
        ticker={txModal}
        onClose={() => setTxModal(null)}
      />
    </div>
  )
}
