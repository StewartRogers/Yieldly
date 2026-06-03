import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { fmtCurrency, fmtCurrencyOr, fmtPct, retClass } from '../utils/format'
import StockInfoModal from '../components/StockInfoModal'
import HoldingTransactionsModal from '../components/HoldingTransactionsModal'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function HoldingCard({ holding, onEdit, onShowTxns }) {
  const hasMarket = holding.market_price > 0

  const rows = [
    { label: 'Buy price', value: fmtCurrency(holding.buy_price) },
    { label: 'Market',    value: hasMarket ? fmtCurrency(holding.market_price) : '—', muted: !hasMarket },
    { label: 'Buy total', value: fmtCurrency(holding.buy_total) },
    { label: 'Mkt total', value: hasMarket ? fmtCurrency(holding.market_value) : '—', muted: !hasMarket },
    holding.sale_total > 0
      ? { label: 'Sale total', value: fmtCurrency(holding.sale_total) }
      : null,
    { label: 'Div paid', value: fmtCurrencyOr(holding.dividends_paid) },
    hasMarket && holding.dividend_yield > 0
      ? { label: 'Yield', value: holding.dividend_yield.toFixed(2) + '%' }
      : null,
  ].filter(Boolean)

  return (
    <div className="ptf-card">
      {/* Header */}
      <div className="ptf-card-header">
        <div>
          <div className="ptf-card-ticker-row">
            <button
              className="ptf-card-ticker"
              onClick={() => onShowTxns(holding.ticker)}
            >
              {holding.ticker}
            </button>
            {holding.investment_type && (
              <Badge variant="secondary" className="ptf-card-type-badge">{holding.investment_type}</Badge>
            )}
          </div>
          <div className="ptf-card-shares">
            Owned: {holding.shares.toFixed(2)}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ptf-card-edit-btn"
          onClick={() => onEdit(holding)}
        >
          Edit
        </Button>
      </div>

      {/* Detail rows */}
      <div className="ptf-card-rows">
        {rows.map(row => (
          <div key={row.label} className="ptf-card-row">
            <span className="ptf-card-row-label">{row.label}</span>
            <span className={`ptf-card-row-value${row.muted ? ' ptf-card-row-value--muted' : ''}`}>
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {/* Dividend frequency footer */}
      {holding.dividend_frequency && (
        <div className="ptf-card-div-footer">
          Freq · {holding.dividend_frequency}
          {holding.dividend_per_share > 0 && <> · ${holding.dividend_per_share.toFixed(2)}/sh</>}
          {holding.annual_payout > 0 && <> · Annual {fmtCurrency(holding.annual_payout)}</>}
        </div>
      )}

      {/* Return — most prominent element */}
      <div className="ptf-card-return-row">
        <div className="ptf-card-return-left">
          <span className="ptf-card-return-label">Return</span>
          {hasMarket ? (
            <span className={`ptf-card-return-value ${retClass(holding.return)}`}>
              {fmtCurrency(holding.return)}
            </span>
          ) : (
            <span className="ptf-card-return-value ptf-card-return-value--none">—</span>
          )}
        </div>
        {hasMarket && (
          <span className={`ptf-card-return-pct ${retClass(holding.return)}`}>
            {holding.return >= 0 ? '▲' : '▼'} {Math.abs(holding.return_percent).toFixed(1)}%
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="ptf-card-actions">
        <Button variant="outline" size="sm" className="ptf-card-action-btn" onClick={() => onEdit(holding)}>
          ✎ Edit
        </Button>
        <Button variant="ghost" size="sm" className="ptf-card-action-btn" onClick={() => onShowTxns(holding.ticker)}>
          ⊟ Txns
        </Button>
      </div>
    </div>
  )
}

function AddHoldingCard({ portfolioCode, onClick }) {
  return (
    <button
      onClick={onClick}
      className="ptf-add-card"
    >
      <span className="ptf-add-card-plus">+</span>
      <span className="ptf-add-card-label">Add holding to {portfolioCode}</span>
    </button>
  )
}

export default function Portfolios({ portfolios, onPortfoliosChange }) {
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
    fetch(`/api/portfolios/${selectedId}/summary`)
      .then(r => r.json())
      .then(data => setHoldings(data.filter(h => h.shares > 0.00005)))
      .catch(console.error)
  }, [selectedId])

  const reloadHoldings = () => {
    if (!selectedId) return
    fetch(`/api/portfolios/${selectedId}/summary`)
      .then(r => r.json())
      .then(data => setHoldings(data.filter(h => h.shares > 0.00005)))
  }

  const createPortfolio = async () => {
    if (!newName.trim() || !newCode.trim()) return
    try {
      const res = await fetch('/api/portfolios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), code: newCode.trim() })
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const p = await res.json()
      setNewName(''); setNewCode('')
      onPortfoliosChange()
      setSelectedId(p.id)
    } catch (e) { alert(e.message) }
  }

  const refreshPrices = async () => {
    if (!selectedId) return
    setRefreshing(true)
    try {
      const res = await fetch(`/api/portfolios/${selectedId}/refresh-prices`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      const result = await res.json()
      alert(result.message)
      reloadHoldings()
    } catch (e) { alert(e.message) }
    finally { setRefreshing(false) }
  }

  const updateOrder = async (ordered) => {
    await Promise.all(ordered.map((p, i) =>
      fetch(`/api/portfolios/${p.id}/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_order: i + 1 })
      })
    ))
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

      {/* ── Toolbar row 1: portfolio tabs + create form ── */}
      <div className="ptf-toolbar-row">
        <div className="ptf-tabs-wrap">
          {localPortfolios.length === 0
            ? <p className="text-muted-foreground text-sm">No portfolios yet.</p>
            : localPortfolios.map(p => (
              <button
                key={p.id}
                className={`ptf-tab${selectedId === p.id ? ' ptf-tab--active' : ''}`}
                onClick={() => setSelectedId(p.id)}
                draggable
                onDragStart={(e) => handleDragStart(e, p.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, p.id)}
                title="Drag to reorder"
              >
                {p.name || p.code}
              </button>
            ))
          }
          {localPortfolios.length > 0 && (
            <span className="ptf-drag-hint">drag to reorder</span>
          )}
        </div>

        <div className="ptf-create-form">
          <Input
            placeholder="New name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="h-8 w-36 text-sm"
            onKeyDown={e => e.key === 'Enter' && createPortfolio()}
          />
          <Input
            placeholder="Code"
            value={newCode}
            onChange={e => setNewCode(e.target.value)}
            maxLength={5}
            className="h-8 w-20 text-sm"
            onKeyDown={e => e.key === 'Enter' && createPortfolio()}
          />
          <Button size="sm" onClick={createPortfolio} disabled={!newName.trim() || !newCode.trim()}>
            Create
          </Button>
        </div>
      </div>

      {/* ── Toolbar row 2: view toggle + stats + refresh ── */}
      {selectedPortfolio && (
        <div className="ptf-toolbar-row ptf-toolbar-row--secondary">
          <div className="flex items-center gap-2">
            <div className="view-toggle">
              <button className={`view-btn${view === 'card' ? ' active' : ''}`} onClick={() => setView('card')}>
                ■ Cards
              </button>
              <button className={`view-btn${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')}>
                ≡ List
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="ptf-stats-label">
              {selectedPortfolio.name || selectedPortfolio.code}
              {' · '}{holdings.length} holding{holdings.length !== 1 ? 's' : ''}
              {totalMktValue > 0 && <> · {fmtCurrency(totalMktValue)}</>}
            </span>
            <Button variant="outline" size="sm" onClick={refreshPrices} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : '↻ Refresh Prices'}
            </Button>
          </div>
        </div>
      )}

      {/* ── Holdings ── */}
      {holdings.length === 0 && selectedPortfolio ? (
        <div className="ptf-grid">
          <AddHoldingCard
            portfolioCode={selectedPortfolio?.name || selectedPortfolio?.code}
            onClick={() => navigate('/transactions')}
          />
        </div>
      ) : view === 'card' ? (
        <div className="ptf-grid">
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
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Shares</TableHead>
                    <TableHead className="text-right">Buy</TableHead>
                    <TableHead className="text-right">Mkt</TableHead>
                    <TableHead className="text-right">Buy Total</TableHead>
                    <TableHead className="text-right">Mkt Total</TableHead>
                    <TableHead className="text-right">Div Paid</TableHead>
                    <TableHead className="text-right">Yield</TableHead>
                    <TableHead className="text-right">Return</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holdings.map(h => (
                    <TableRow key={h.ticker}>
                      <TableCell className="font-semibold text-primary">{h.ticker}</TableCell>
                      <TableCell>
                        {h.investment_type
                          ? <Badge variant="secondary" className="text-xs">{h.investment_type}</Badge>
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{h.shares.toFixed(4)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtCurrency(h.buy_price)}</TableCell>
                      <TableCell className="text-right tabular-nums">{h.market_price > 0 ? fmtCurrency(h.market_price) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtCurrency(h.buy_total)}</TableCell>
                      <TableCell className="text-right tabular-nums">{h.market_price > 0 ? fmtCurrency(h.market_value) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtCurrencyOr(h.dividends_paid)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {h.market_price > 0 && h.dividend_yield > 0 ? fmtPct(h.dividend_yield) : '—'}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${h.market_price > 0 ? retClass(h.return) : ''}`}>
                        {h.market_price > 0
                          ? <>{fmtCurrency(h.return)} <span className="text-xs">({h.return_percent.toFixed(1)}%)</span></>
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setStockModal(h)}>Edit</Button>
                          <Button variant="ghost"   size="sm" className="h-7 text-xs" onClick={() => setTxModal(h.ticker)}>Txns</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
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
