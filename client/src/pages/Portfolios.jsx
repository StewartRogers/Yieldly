import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, LayoutGrid, List, GripVertical } from 'lucide-react'
import { fmtCurrency, fmtCurrencyOr, fmtPct, retClass } from '../utils/format'
import StockInfoModal from '../components/StockInfoModal'
import HoldingTransactionsModal from '../components/HoldingTransactionsModal'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { getPortfolioSummary, createPortfolio, refreshPortfolioPrices, updatePortfolioOrder } from '../api/client'

function HoldingCard({ holding, onEdit, onShowTxns }) {
  const hasMarket = holding.market_price > 0

  const kvRows = [
    ['Shares',    holding.shares.toFixed(2)],
    ['Buy price', fmtCurrency(holding.buy_price)],
    ['Market',    hasMarket ? fmtCurrency(holding.market_price) : '—'],
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
  const [view, setView]                       = useState('card')
  const [newName, setNewName]                 = useState('')
  const [newCode, setNewCode]                 = useState('')
  const [refreshing, setRefreshing]           = useState(false)
  const [stockModal, setStockModal]           = useState(null)
  const [txModal, setTxModal]                 = useState(null)
  const dragId = useRef(null)

  useEffect(() => { setLocalPortfolios(portfolios) }, [portfolios])

  useEffect(() => {
    if (localPortfolios.length > 0 && !selectedId) {
      setSelectedId(localPortfolios[0].id)
    }
  }, [localPortfolios])

  useEffect(() => {
    if (!selectedId) return
    getPortfolioSummary(selectedId)
      .then(data => setHoldings(data.filter(h => h.shares > 0.00005)))
      .catch(console.error)
  }, [selectedId])

  const reloadHoldings = () => {
    if (!selectedId) return
    getPortfolioSummary(selectedId)
      .then(data => setHoldings(data.filter(h => h.shares > 0.00005)))
      .catch(console.error)
  }

  /* Re-fetch market values when nav refresh fires */
  useEffect(() => {
    if (pricesTick > 0) reloadHoldings()
  }, [pricesTick])

  const handleCreatePortfolio = async () => {
    if (!newName.trim() || !newCode.trim()) return
    try {
      const p = await createPortfolio({ name: newName.trim(), code: newCode.trim() })
      setNewName(''); setNewCode('')
      onPortfoliosChange()
      setSelectedId(p.id)
    } catch (e) { alert(e.message) }
  }

  const refreshPrices = async () => {
    if (!selectedId) return
    setRefreshing(true)
    try {
      const result = await refreshPortfolioPrices(selectedId)
      alert(result.message)
      reloadHoldings()
    } catch (e) { alert(e.message) }
    finally { setRefreshing(false) }
  }

  const updateOrder = async (ordered) => {
    await Promise.all(ordered.map((p, i) => updatePortfolioOrder(p.id, i + 1)))
  }

  const handleDragStart = (e, id) => { dragId.current = id; e.dataTransfer.effectAllowed = 'move' }
  const handleDragOver  = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }
  const handleDrop = async (e, targetId) => {
    e.preventDefault()
    if (dragId.current === targetId) return
    const reordered = [...localPortfolios]
    const fromIdx   = reordered.findIndex(p => p.id === dragId.current)
    const toIdx     = reordered.findIndex(p => p.id === targetId)
    const [moved]   = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    setLocalPortfolios(reordered)
    await updateOrder(reordered)
    onPortfoliosChange()
    dragId.current = null
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
            placeholder="New name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="h-9 w-36 text-sm"
            style={{ background: 'var(--inset)', borderColor: 'var(--line-2)', color: 'var(--ink)' }}
            onKeyDown={e => e.key === 'Enter' && handleCreatePortfolio()}
          />
          <Input
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
            <span className="muted-txt" style={{ fontSize: 13.5 }}>
              {selectedPortfolio.name || selectedPortfolio.code} · {holdings.length} holding{holdings.length !== 1 ? 's' : ''}
              {totalMktValue > 0 && <> · <span className="num">{fmtCurrency(totalMktValue)}</span></>}
            </span>
            <button className="tc-btn sm" onClick={refreshPrices} disabled={refreshing}>
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh Prices'}
            </button>
          </div>
        </div>
      )}

      {/* ── Holdings: Card view ── */}
      {view === 'card' && (
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
      {view === 'list' && (
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
                    <td className="num">{fmtCurrency(h.buy_price)}</td>
                    <td className="num">{h.market_price > 0 ? fmtCurrency(h.market_price) : '—'}</td>
                    <td className="num">{fmtCurrency(h.buy_total)}</td>
                    <td className="num">{h.market_price > 0 ? fmtCurrency(h.market_value) : '—'}</td>
                    <td className="num">{fmtCurrencyOr(h.dividends_paid)}</td>
                    <td className="num">{h.market_price > 0 && h.dividend_yield > 0 ? fmtPct(h.dividend_yield) : '—'}</td>
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
                    <td className="num">{fmtCurrency(holdings.reduce((s, h) => s + h.buy_total, 0))}</td>
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
