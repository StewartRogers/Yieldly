import { useState, useEffect, useRef } from 'react'
import { fmtCurrency, fmtCurrencyOr, fmtPct, retClass } from '../utils/format'
import StockInfoModal from '../components/StockInfoModal'
import HoldingTransactionsModal from '../components/HoldingTransactionsModal'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
            className="font-semibold text-primary hover:underline focus:outline-primary"
            onClick={() => onShowTxns(holding.ticker)}
          >
            {holding.ticker}
          </button>
          <div className="text-xs text-muted-foreground mt-1">{holding.shares.toFixed(2)} shares</div>
        </div>
        <div className="flex items-center gap-2">
          {holding.investment_type && (
            <Badge variant="secondary" className="text-xs">{holding.investment_type}</Badge>
          )}
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onEdit(holding)}>Edit</Button>
        </div>
      </div>

      <div className="px-4 py-3 flex flex-col gap-1.5 text-sm flex-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Buy Price</span>
          <span className="tabular-nums">{fmtCurrency(holding.buy_price)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Market Price</span>
          <span className={`tabular-nums ${hasMarket ? '' : 'text-muted-foreground'}`}>
            {hasMarket ? fmtCurrency(holding.market_price) : 'Not set'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Buy Total</span>
          <span className="tabular-nums">{fmtCurrency(holding.buy_total)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Market Value</span>
          <span className={`tabular-nums ${hasMarket ? '' : 'text-muted-foreground'}`}>
            {hasMarket ? fmtCurrency(holding.market_value) : 'N/A'}
          </span>
        </div>
        {holding.sale_total > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Sale Total</span>
            <span className="tabular-nums">{fmtCurrency(holding.sale_total)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Dividends Paid</span>
          <span className="tabular-nums">{fmtCurrency(holding.dividends_paid)}</span>
        </div>
        {hasMarket && (
          <div className="flex justify-between font-medium pt-1 border-t mt-1">
            <span>Return</span>
            <span className={`tabular-nums ${retClass(holding.return)}`}>
              {fmtCurrency(holding.return)} ({holding.return_percent.toFixed(2)}%)
            </span>
          </div>
        )}
      </div>

      {holding.dividend_frequency && (
        <div className="px-4 py-3 border-t bg-muted/40 flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Frequency</span>
            <span>{holding.dividend_frequency}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Per Share</span>
            <span className="tabular-nums">{fmtCurrency(holding.dividend_per_share)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Annual Payout</span>
            <span className="tabular-nums">{fmtCurrency(holding.annual_payout)}</span>
          </div>
          {hasMarket && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Yield</span>
              <span className="tabular-nums">{holding.dividend_yield.toFixed(2)}%</span>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export default function Portfolios({ portfolios, onPortfoliosChange }) {
  const [localPortfolios, setLocalPortfolios] = useState([])
  const [selectedId, setSelectedId]           = useState(null)
  const [holdings, setHoldings]               = useState([])
  const [view, setView]                       = useState('card')
  const [showNewForm, setShowNewForm]         = useState(false)
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

  const createPortfolio = async () => {
    if (!newName.trim() || !newCode.trim()) { alert('Name and code required'); return }
    try {
      const res = await fetch('/api/portfolios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), code: newCode.trim() })
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const p = await res.json()
      setNewName(''); setNewCode(''); setShowNewForm(false)
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
      const data = await fetch(`/api/portfolios/${selectedId}/summary`).then(r => r.json())
      setHoldings(data.filter(h => h.shares > 0.00005))
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

  const reloadHoldings = () => {
    if (!selectedId) return
    fetch(`/api/portfolios/${selectedId}/summary`)
      .then(r => r.json())
      .then(data => setHoldings(data.filter(h => h.shares > 0.00005)))
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold">Portfolio Holdings</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {holdings.length > 0 && (
            <div className="flex rounded-lg border overflow-hidden">
              <button
                className={`px-3 py-1.5 text-sm transition-colors ${view === 'card' ? 'bg-primary text-white' : 'hover:bg-muted'}`}
                onClick={() => setView('card')}>Cards</button>
              <button
                className={`px-3 py-1.5 text-sm transition-colors ${view === 'list' ? 'bg-primary text-white' : 'hover:bg-muted'}`}
                onClick={() => setView('list')}>List</button>
            </div>
          )}
          {selectedId && (
            <Button variant="outline" size="sm" onClick={refreshPrices} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh Prices'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setShowNewForm(v => !v)}>
            + New Portfolio
          </Button>
        </div>
      </div>

      {showNewForm && (
        <Card className="max-w-lg">
          <CardHeader><CardTitle>New Portfolio</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Portfolio Name</label>
                <Input placeholder="e.g., Retirement Fund" value={newName} onChange={e => setNewName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Portfolio Code</label>
                <Input placeholder="e.g., RR" maxLength={5} value={newCode} onChange={e => setNewCode(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={createPortfolio}>Create Portfolio</Button>
              <Button variant="outline" onClick={() => setShowNewForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Portfolio selector tabs (custom for drag-and-drop support) */}
      <div className="flex flex-wrap gap-2">
        {localPortfolios.length === 0
          ? <p className="text-muted-foreground text-sm">No portfolios yet.</p>
          : localPortfolios.map(p => (
            <button
              key={p.id}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                selectedId === p.id
                  ? 'bg-primary text-white border-primary'
                  : 'bg-card border-border hover:bg-muted'
              }`}
              onClick={() => setSelectedId(p.id)}
              draggable
              onDragStart={(e) => handleDragStart(e, p.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, p.id)}
            >
              {p.name} <span className="opacity-70">({p.code})</span>
            </button>
          ))
        }
      </div>

      {holdings.length === 0
        ? <p className="text-muted-foreground text-sm">No holdings yet. Add your first transaction!</p>
        : view === 'card'
          ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {holdings.map(h => (
                <HoldingCard
                  key={h.ticker}
                  holding={h}
                  onEdit={setStockModal}
                  onShowTxns={ticker => setTxModal(ticker)}
                />
              ))}
            </div>
          )
          : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead className="text-right">Shares</TableHead>
                        <TableHead className="text-right">Buy Price</TableHead>
                        <TableHead className="text-right">Mkt Price</TableHead>
                        <TableHead className="text-right">Buy Total</TableHead>
                        <TableHead className="text-right">Sale Total</TableHead>
                        <TableHead className="text-right">Dividends</TableHead>
                        <TableHead>Pay Date</TableHead>
                        <TableHead className="text-right">Return</TableHead>
                        <TableHead className="text-right">Return %</TableHead>
                        <TableHead className="text-right">Yield</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {holdings.map(h => (
                        <TableRow key={h.ticker}>
                          <TableCell className="font-medium text-primary">{h.ticker}</TableCell>
                          <TableCell className="text-right tabular-nums">{h.shares.toFixed(4)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtCurrency(h.buy_price)}</TableCell>
                          <TableCell className="text-right tabular-nums">{h.market_price > 0 ? fmtCurrency(h.market_price) : '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtCurrency(h.buy_total)}</TableCell>
                          <TableCell className="text-right tabular-nums">{h.sale_total > 0 ? fmtCurrency(h.sale_total) : '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtCurrencyOr(h.dividends_paid)}</TableCell>
                          <TableCell>{h.last_dividend_date || '—'}</TableCell>
                          <TableCell className={`text-right tabular-nums ${h.market_price > 0 ? retClass(h.return) : ''}`}>
                            {h.market_price > 0 ? fmtCurrency(h.return) : '—'}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums ${h.market_price > 0 ? retClass(h.return_percent) : ''}`}>
                            {h.market_price > 0 ? fmtPct(h.return_percent) : '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {h.market_price > 0 && h.dividend_yield > 0 ? fmtPct(h.dividend_yield) : '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setStockModal(h)}>Edit</Button>
                              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setTxModal(h.ticker)}>Txns</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )
      }

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
