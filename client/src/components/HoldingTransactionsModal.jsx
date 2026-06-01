import { useState, useEffect } from 'react'
import { fmtCurrency } from '../utils/format'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function typeLabel(t) { return t.replace(/_/g, ' ') }

export default function HoldingTransactionsModal({ portfolioId, ticker, onClose }) {
  const [txns, setTxns]       = useState(null)
  const [summary, setSummary] = useState(null)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!portfolioId || !ticker) return
    setTxns(null); setSummary(null); setError(null)
    fetch(`/api/portfolios/${portfolioId}/transactions/ticker/${ticker}`)
      .then(r => r.json())
      .then(data => {
        setTxns(data)
        let shares = 0, cost = 0, commission = 0
        data.forEach(t => {
          const isBuy  = t.type === 'BUY' || t.type === 'DIVIDEND_REINVEST'
          const isSell = t.type === 'SELL'
          if (isBuy)  { shares += t.quantity; cost += t.total; commission += (t.commission || 0) }
          if (isSell) { shares -= t.quantity }
        })
        setSummary({ shares, cost, commission,
          acb: shares > 0 ? (cost + commission) / shares : 0 })
      })
      .catch(e => setError(e.message))
  }, [portfolioId, ticker])

  return (
    <Dialog open={!!ticker} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{ticker} — Transactions</DialogTitle>
        </DialogHeader>

        {summary && (
          <div className="flex flex-wrap gap-4 rounded-lg bg-muted px-4 py-3 text-sm">
            <span><span className="font-medium">Net Shares:</span> {summary.shares.toFixed(4)}</span>
            <span><span className="font-medium">Total Cost:</span> {fmtCurrency(summary.cost)}</span>
            <span><span className="font-medium">Commission:</span> {summary.commission > 0 ? fmtCurrency(summary.commission) : '—'}</span>
            <span><span className="font-medium">ACB / Share:</span> {summary.shares > 0 ? fmtCurrency(summary.acb) : '—'}</span>
          </div>
        )}

        <div className="overflow-y-auto flex-1">
          {error && <p className="text-muted-foreground text-sm p-4">{error}</p>}
          {txns === null && !error && <p className="text-muted-foreground text-sm p-4">Loading…</p>}
          {txns !== null && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Shares</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txns.map(t => (
                  <TableRow key={t.id}>
                    <TableCell>{t.date}</TableCell>
                    <TableCell>
                      <span className={`type ${t.type.toLowerCase().replace(/_/g, '-')}`}>
                        {typeLabel(t.type)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.quantity > 0 ? t.quantity.toFixed(4) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.price > 0 ? fmtCurrency(t.price) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCurrency(t.total)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.commission > 0 ? fmtCurrency(t.commission) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
