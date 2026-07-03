import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { updateStockInfo } from '../api/client'

export default function StockInfoModal({ holding, portfolioId, onClose, onSaved }) {
  const [form, setForm] = useState({
    marketPrice: '', dividendFrequency: '', dividendPerShare: '',
    lastDividendDate: '', sector: '', investmentType: ''
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (holding) {
      setForm({
        marketPrice:       holding.market_price       || '',
        dividendFrequency: holding.dividend_frequency || '',
        dividendPerShare:  holding.dividend_per_share || '',
        lastDividendDate:  holding.last_dividend_date || '',
        sector:            holding.sector             || '',
        investmentType:    holding.investment_type    || '',
      })
    }
  }, [holding])

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }))
  const setVal = (key) => (val) => setForm(f => ({ ...f, [key]: val }))

  const toNumberOrNull = (raw) => {
    if (raw === '') return null
    const n = parseFloat(raw)
    return Number.isFinite(n) ? n : null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await updateStockInfo(portfolioId, holding.ticker, {
        market_price:       toNumberOrNull(form.marketPrice),
        dividend_frequency: form.dividendFrequency             || null,
        dividend_per_share: toNumberOrNull(form.dividendPerShare),
        last_dividend_date: form.lastDividendDate              || null,
        sector:             form.sector                        || null,
        investment_type:    form.investmentType                || null,
      })
      onSaved()
      onClose()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!holding} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update Stock — {holding?.ticker}</DialogTitle>
        </DialogHeader>

        <form id="stock-info-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Market Price</label>
              <Input type="number" step="0.01" placeholder="0.00"
                value={form.marketPrice} onChange={set('marketPrice')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Sector</label>
                <Input type="text" placeholder="e.g. Financials"
                  value={form.sector} onChange={set('sector')} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Type</label>
                <Select value={form.investmentType} onValueChange={setVal('investmentType')}>
                  <SelectTrigger className="w-full">
                    <span className="flex flex-1 text-left text-sm" style={{ color: form.investmentType ? undefined : 'var(--tc-muted)' }}>
                      {({ S: 'S — Stock', E: 'E — ETF/Index', X: 'X — Other' }[form.investmentType]) ?? '—'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="S">S — Stock</SelectItem>
                    <SelectItem value="E">E — ETF/Index</SelectItem>
                    <SelectItem value="X">X — Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-muted-foreground">Dividend Information</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Frequency</label>
                <Select value={form.dividendFrequency} onValueChange={setVal('dividendFrequency')}>
                  <SelectTrigger className="w-full">
                    <span className="flex flex-1 text-left text-sm" style={{ color: form.dividendFrequency ? undefined : 'var(--tc-muted)' }}>
                      {form.dividendFrequency || 'None'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Monthly">Monthly</SelectItem>
                    <SelectItem value="Quarterly">Quarterly</SelectItem>
                    <SelectItem value="Semi-Annual">Semi-Annual</SelectItem>
                    <SelectItem value="Annual">Annual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Per Share Amount</label>
                <Input type="number" step="0.01" placeholder="0.00"
                  value={form.dividendPerShare} onChange={set('dividendPerShare')} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Last Dividend Date</label>
              <Input type="date" value={form.lastDividendDate} onChange={set('lastDividendDate')} />
            </div>
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="stock-info-form" disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
