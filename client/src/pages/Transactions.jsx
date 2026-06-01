import { useState, useEffect } from 'react'
import { fmtCurrency } from '../utils/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
const PER_PAGE = 20

const CASH_ONLY_TYPES = new Set(['DIVIDEND', 'CONTRIBUTION', 'WITHDRAWAL'])
const CASH_FLOW_TYPES = new Set(['CONTRIBUTION', 'WITHDRAWAL'])

function typeClass(t) { return t.toLowerCase().replace(/_/g, '-') }
function typeLabel(t) { return t.replace(/_/g, ' ') }

export default function Transactions({ portfolios }) {
  const [portfolioId, setPortfolioId] = useState('')
  const [allTxns, setAllTxns]         = useState([])
  const [page, setPage]               = useState(1)
  const [type, setType]               = useState('BUY')
  const [ticker, setTicker]           = useState('')
  const [quantity, setQuantity]       = useState('')
  const [price, setPrice]             = useState('')
  const [sharesTotal, setSharesTotal] = useState('')
  const [commission, setCommission]   = useState('')
  const [date, setDate]               = useState(new Date().toISOString().slice(0, 10))
  const [total, setTotal]             = useState('')
  const [dateDividend, setDateDividend] = useState(new Date().toISOString().slice(0, 10))

  const isCashOnly = CASH_ONLY_TYPES.has(type)
  const isCashFlow = CASH_FLOW_TYPES.has(type)

  const loadTxns = (pid) => {
    if (!pid) return
    fetch(`/api/portfolios/${pid}/transactions`)
      .then(r => r.json())
      .then(data => { setAllTxns(data); setPage(1) })
      .catch(console.error)
  }

  useEffect(() => { if (portfolioId) loadTxns(portfolioId) }, [portfolioId])

  const recalc = (q, p) => {
    const qty = parseFloat(q) || 0
    const px  = parseFloat(p) || 0
    if (qty > 0 && px > 0) setSharesTotal((qty * px).toFixed(2))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!portfolioId) { alert('Select a portfolio'); return }
    const txn = {
      portfolio_id: parseInt(portfolioId),
      ticker: isCashFlow ? 'CASH' : ticker.trim().toUpperCase(),
      type,
      date: isCashOnly ? dateDividend : date,
    }
    if (isCashOnly) {
      txn.quantity = 0; txn.price = 0; txn.total = parseFloat(total)
    } else {
      txn.quantity = parseFloat(quantity)
      txn.price    = parseFloat(price)
      const t = parseFloat(sharesTotal)
      if (t > 0) txn.total = t
      const c = parseFloat(commission) || 0
      if (c > 0) txn.commission = c
    }
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(txn)
      })
      if (!res.ok) throw new Error('Failed to add transaction')
      setTicker(''); setQuantity(''); setPrice(''); setSharesTotal('')
      setCommission(''); setTotal('')
      setDate(new Date().toISOString().slice(0, 10))
      loadTxns(portfolioId)
    } catch (err) { alert(err.message) }
  }

  const deleteTxn = async (id) => {
    if (!confirm('Delete this transaction?')) return
    try {
      await fetch(`/api/transactions/${id}`, { method: 'DELETE' })
      loadTxns(portfolioId)
    } catch (e) { alert(e.message) }
  }

  const totalPages = Math.ceil(allTxns.length / PER_PAGE)
  const pageTxns   = allTxns.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Transactions</h1>

      <Card>
        <CardHeader><CardTitle>Add Transaction</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Portfolio</label>
                <Select value={portfolioId} onValueChange={setPortfolioId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a portfolio…" />
                  </SelectTrigger>
                  <SelectContent>
                    {portfolios.map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!isCashFlow && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Ticker Symbol</label>
                  <Input placeholder="XEI.TO" value={ticker}
                    onChange={e => setTicker(e.target.value)} required={!isCashOnly} />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Type</label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BUY">Buy</SelectItem>
                    <SelectItem value="SELL">Sell</SelectItem>
                    <SelectItem value="DIVIDEND">Dividend</SelectItem>
                    <SelectItem value="DIVIDEND_REINVEST">Dividend Reinvestment</SelectItem>
                    <SelectItem value="CONTRIBUTION">Contribution</SelectItem>
                    <SelectItem value="WITHDRAWAL">Withdrawal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!isCashOnly && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Quantity</label>
                  <Input type="number" step="0.0001" placeholder="10" value={quantity}
                    onChange={e => { setQuantity(e.target.value); recalc(e.target.value, price) }} required />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Price / Share</label>
                  <Input type="number" step="0.01" placeholder="150.00" value={price}
                    onChange={e => { setPrice(e.target.value); recalc(quantity, e.target.value) }} required />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Total</label>
                  <Input type="number" step="0.01" placeholder="0.00" value={sharesTotal}
                    onChange={e => setSharesTotal(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Commission</label>
                  <Input type="number" step="0.01" placeholder="0.00" min="0" value={commission}
                    onChange={e => setCommission(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Date</label>
                  <Input type="date" value={date} onChange={e => setDate(e.target.value)} required />
                </div>
              </div>
            )}

            {isCashOnly && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">{isCashFlow ? 'Amount' : 'Total Amount'}</label>
                  <Input type="number" step="0.01" placeholder="0.00" value={total}
                    onChange={e => setTotal(e.target.value)} required />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Date</label>
                  <Input type="date" value={dateDividend} onChange={e => setDateDividend(e.target.value)} required />
                </div>
              </div>
            )}

            <Button type="submit" className="w-fit">Add Transaction</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Transaction History</CardTitle></CardHeader>
        <CardContent className="p-0">
          {allTxns.length === 0
            ? <p className="text-muted-foreground text-sm px-4 pb-4">No transactions yet.</p>
            : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ticker</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Shares</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageTxns.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.ticker}</TableCell>
                        <TableCell>
                          <span className={`type ${typeClass(t.type)}`}>{typeLabel(t.type)}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{t.quantity > 0 ? t.quantity : '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{parseFloat(t.price) > 0 ? fmtCurrency(parseFloat(t.price)) : '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtCurrency(parseFloat(t.total))}</TableCell>
                        <TableCell>{new Date(t.date).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() => deleteTxn(t.id)}>Delete</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-4 p-4 border-t">
                    <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>Previous</Button>
                    <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                    <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page === totalPages}>Next</Button>
                  </div>
                )}
              </>
            )
          }
        </CardContent>
      </Card>
    </div>
  )
}
