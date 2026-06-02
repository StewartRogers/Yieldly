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

  return (
    <Card className="flex flex-col gap-0 py-0 overflow-hidden">
      <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b">
        <div>
          <button
            className="font-bold text-primary text-lg leading-none hover:underline focus:outline-primary"
            onClick={() => onShowTxns(holding.ticker)}
          >
            {holding.ticker}
          </button>
          {holding.investment_type && (
            <Badge variant="secondary" className="ml-2 text-xs align-middle">{holding.investment_type}</Badge>
          )}
          <div className="text-xs text-muted-foreground mt-1">{holding.shares.toFixed(2)} shares</div>
        </div>
        <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={() => onEdit(holding)}>
          Edit
        </Button>
      </div>

      <div className="px-4 py-3 flex flex-col gap-1.5 text-sm flex-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Buy price</span>
          <span className="tabular-nums">{fmtCurrency(holding.buy_price)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Market</span>
          <span className={`tabular-nums ${!hasMarket ? 'text-muted-foreground' : ''}`}>
            {hasMarket ? fmtCurrency(holding.market_price) : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Buy total</span>
          <span className="tabular-nums">{fmtCurrency(holding.buy_total)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Mkt total</span>
          <span className={`tabular-nums ${!hasMarket ? 'text-muted-foreground' : ''}`}>
            {hasMarket ? fmtCurrency(holding.market_value) : '—'}
          </span>
        </div>
        {holding.sale_total > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Sale total</span>
            <span className="tabular-nums">{fmtCurrency(holding.sale_total)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Div paid</span>
          <span className="tabular-nums">{fmtCurrencyOr(holding.dividends_paid)}</span>
        </div>
        {hasMarket && holding.dividend_yield > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Yield</span>
            <span className="tabular-nums">{holding.dividend_yield.toFixed(2)}%</span>
          </div>
        )}
      </div>

      {holding.dividend_frequency && (
        <div className="px-4 py-2 border-t bg-muted/40 text-xs text-muted-foreground">
          {holding.dividend_frequency} · {fmtCurrency(holding.dividend_per_share)}/sh
          {holding.annual_payout > 0 && <> · {fmtCurrency(holding.annual_payout)}/yr</>}
        </div>
      )}

      <div className="px-4 py-3 border-t flex items-center justify-between">
        {hasMarket ? (
          <span className={`text-sm font-semibold tabular-nums ${retClass(holding.return)}`}>
            Return {fmtCurrency(holding.return)} ({holding.return_percent.toFixed(2)}%)
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">No market price</span>
        )}
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onShowTxns(holding.ticker)}>
            Txns
          </Button>
        </div>
      </div>
    </Card>
  )
}

function AddHoldingCard({ portfolioCode, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border min-h-[200px] p-6 text-muted-foreground hover:bg-muted/50 hover:border-primary/40 transition-colors gap-2 w-full"
    >
      <span className="text-3xl font-light">+</span>
      <span className="text-sm">Add holding to {portfolioCode}</span>
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

      {/* Row 1: Tabs + inline create form */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="portfolio-tabs flex-1" style={{ marginBottom: 0, border: 'none' }}>
          {localPortfolios.length === 0
            ? <p className="text-muted-foreground text-sm py-2">No portfolios yet.</p>
            : localPortfolios.map(p => (
              <button
                key={p.id}
                className={`portfolio-tab${selectedId === p.id ? ' active' : ''}`}
                onClick={() => setSelectedId(p.id)}
                draggable
                onDragStart={(e) => handleDragStart(e, p.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, p.id)}
                title="Drag to reorder"
              >
                {p.code}
              </button>
            ))
          }
        </div>

        {/* Inline create form */}
        <div className="flex items-center gap-2 shrink-0">
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

      {/* Row 2: Context info + view toggle + refresh */}
      {selectedPortfolio && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <span className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{selectedPortfolio.code}</span>
            {selectedPortfolio.name && <> · {selectedPortfolio.name}</>}
            {' · '}{holdings.length} holding{holdings.length !== 1 ? 's' : ''}
            {totalMktValue > 0 && <> · {fmtCurrency(totalMktValue)}</>}
          </span>
          <div className="flex items-center gap-2">
            <div className="view-toggle">
              <button
                className={`view-btn${view === 'card' ? ' active' : ''}`}
                onClick={() => setView('card')}
              >
                ■ Cards
              </button>
              <button
                className={`view-btn${view === 'list' ? ' active' : ''}`}
                onClick={() => setView('list')}
              >
                ≡ List
              </button>
            </div>
            <Button variant="outline" size="sm" onClick={refreshPrices} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : '↻ Refresh Prices'}
            </Button>
          </div>
        </div>
      )}

      {/* Holdings */}
      {holdings.length === 0 && selectedPortfolio ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <AddHoldingCard
            portfolioCode={selectedPortfolio?.code}
            onClick={() => navigate('/transactions')}
          />
        </div>
      ) : view === 'card' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
              portfolioCode={selectedPortfolio.code}
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
