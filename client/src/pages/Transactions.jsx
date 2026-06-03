import { useState, useEffect } from 'react'
import { fmtCurrency } from '../utils/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const PER_PAGE = 20
const CASH_ONLY_TYPES  = new Set(['DIVIDEND', 'CONTRIBUTION', 'WITHDRAWAL'])
const CASH_FLOW_TYPES  = new Set(['CONTRIBUTION', 'WITHDRAWAL'])

function typeClass(t) { return t.toLowerCase().replace(/_/g, '-') }
function typeLabel(t) { return t.replace(/_/g, ' ') }

function PageButtons({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null

  const pages = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else if (page <= 4) {
    pages.push(1, 2, 3, 4, 5, '…', totalPages)
  } else if (page >= totalPages - 3) {
    pages.push(1, '…', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
  } else {
    pages.push(1, '…', page - 1, page, page + 1, '…', totalPages)
  }

  return (
    <div className="flex items-center justify-center gap-1 p-3 border-t flex-wrap">
      <Button variant="outline" size="sm" onClick={() => onChange(page - 1)} disabled={page === 1}>Prev</Button>
      {pages.map((p, i) =>
        typeof p === 'number'
          ? <Button
              key={i}
              variant={p === page ? 'default' : 'outline'}
              size="sm"
              className="w-8 px-0 text-xs"
              onClick={() => onChange(p)}
            >{p}</Button>
          : <span key={i} className="px-1 text-foreground/70 text-sm">…</span>
      )}
      <Button variant="outline" size="sm" onClick={() => onChange(page + 1)} disabled={page === totalPages}>Next</Button>
    </div>
  )
}

const LABEL = 'text-xs font-medium uppercase tracking-wide text-foreground/70'

export default function Transactions({ portfolios }) {
  const [formPortfolioId, setFormPortfolioId] = useState('')
  const [type, setType]                       = useState('BUY')
  const [ticker, setTicker]                   = useState('')
  const [quantity, setQuantity]               = useState('')
  const [price, setPrice]                     = useState('')
  const [total, setTotal]                     = useState('')
  const [commission, setCommission]           = useState('')
  const [date, setDate]                       = useState(new Date().toISOString().slice(0, 10))

  const [allTxns, setAllTxns]       = useState([])
  const [historyFilter, setFilter]  = useState('ALL')
  const [page, setPage]             = useState(1)
  const [loading, setLoading]       = useState(false)

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
        fetch(`/api/portfolios/${p.id}/transactions`)
          .then(r => r.json())
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
      type,
      date,
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
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(txn)
      })
      if (!res.ok) throw new Error('Failed to add transaction')
      setTicker(''); setQuantity(''); setPrice(''); setTotal('')
      setCommission(''); setDate(new Date().toISOString().slice(0, 10))
      loadAllTxns()
    } catch (err) { alert(err.message) }
  }

  const deleteTxn = async (id) => {
    if (!confirm('Delete this transaction?')) return
    await fetch(`/api/transactions/${id}`, { method: 'DELETE' })
    loadAllTxns()
  }

  const filteredTxns = historyFilter === 'ALL'
    ? allTxns
    : allTxns.filter(t => t._portfolioId === parseInt(historyFilter))

  const totalPages = Math.ceil(filteredTxns.length / PER_PAGE)
  const pageTxns   = filteredTxns.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const handleFilterChange = (f) => { setFilter(f); setPage(1) }

  // F4: Tailwind grid instead of inline style; F4 also adds mobile responsiveness
  return (
    <div className="grid gap-6 grid-cols-1 lg:grid-cols-[minmax(0,320px)_1fr]">

      {/* LEFT — Add Transaction form (F7: p-4 not p-5) */}
      <div className="rounded-xl border bg-muted/40 p-4 flex flex-col gap-4 self-start">
        <h2 className="text-base font-semibold">Add transaction</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className={LABEL}>Portfolio</label>
            <Select value={formPortfolioId} onValueChange={setFormPortfolioId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {portfolios?.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className={LABEL}>Type</label>
            <Select value={type} onValueChange={v => { setType(v); setTicker(''); setQuantity(''); setPrice(''); setTotal('') }}>
              <SelectTrigger className="h-9">
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
            <div className="flex flex-col gap-1">
              <label className={LABEL}>Ticker</label>
              <Input className="h-9" placeholder="XEI.TO" value={ticker}
                onChange={e => setTicker(e.target.value)} required />
            </div>
          )}

          {!isCashOnly && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className={LABEL}>Quantity</label>
                  <Input className="h-9" type="number" step="0.0001" placeholder="100" value={quantity}
                    onChange={e => setQuantity(e.target.value)} required />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={LABEL}>Price / share</label>
                  <Input className="h-9" type="number" step="0.01" placeholder="139.20" value={price}
                    onChange={e => setPrice(e.target.value)} required />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className={LABEL}>
                  Total <span className="normal-case font-normal text-foreground/70">(auto)</span>
                </label>
                {/* F1: tabIndex={-1} intentional skip target — read-only derived field */}
                <Input
                  className="h-9 bg-muted/60 text-foreground/70 cursor-default"
                  type="number" step="0.01"
                  value={total}
                  readOnly
                  tabIndex={-1}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className={LABEL}>Commission</label>
                  <Input className="h-9" type="number" step="0.01" placeholder="9.95" min="0" value={commission}
                    onChange={e => setCommission(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={LABEL}>Date</label>
                  <Input className="h-9" type="date" value={date} onChange={e => setDate(e.target.value)} required />
                </div>
              </div>
            </>
          )}

          {isCashOnly && (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className={LABEL}>
                  {isCashFlow ? 'Amount' : 'Total amount'}
                </label>
                <Input className="h-9" type="number" step="0.01" placeholder="0.00" value={total}
                  onChange={e => setTotal(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1">
                <label className={LABEL}>Date</label>
                <Input className="h-9" type="date" value={date} onChange={e => setDate(e.target.value)} required />
              </div>
            </div>
          )}

          <Button type="submit" className="w-full mt-1">+ Add transaction</Button>
        </form>

        <p className="text-xs text-foreground/70">
          Types: Buy · Sell · Dividend · Reinvest · Contribution · Withdrawal
        </p>
      </div>

      {/* RIGHT — Transaction History */}
      <Card>
        <CardHeader className="border-b pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Transaction history</CardTitle>
              {!loading && (
                <p className="text-xs text-foreground/70 mt-1">
                  {filteredTxns.length} record{filteredTxns.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
            {/* F6: added focus-visible ring; F9: gap-2 not gap-1.5; F1: text-foreground/70 on inactive */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => handleFilterChange('ALL')}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  historyFilter === 'ALL'
                    ? 'bg-primary text-white border-primary'
                    : 'bg-card border-border text-foreground/70 hover:bg-muted'
                }`}
              >
                All
              </button>
              {portfolios?.map(p => (
                <button
                  key={p.id}
                  onClick={() => handleFilterChange(String(p.id))}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                    historyFilter === String(p.id)
                      ? 'bg-primary text-white border-primary'
                      : 'bg-card border-border text-foreground/70 hover:bg-muted'
                  }`}
                >
                  {p.code}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading && <p className="text-foreground/70 text-sm px-4 py-4">Loading…</p>}
          {!loading && filteredTxns.length === 0 && (
            <p className="text-foreground/70 text-sm px-4 py-4">No transactions yet.</p>
          )}
          {!loading && filteredTxns.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ticker</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Shares</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="w-[110px]">Date</TableHead>
                      <TableHead className="w-[40px]"></TableHead>
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
                        <TableCell className="tabular-nums text-foreground/70">{t.date}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => deleteTxn(t.id)}
                            title="Delete"
                          >
                            ✕
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <PageButtons page={page} totalPages={totalPages} onChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
