import { useState, useRef } from 'react'
import { importCsv, exportData, importData, getDataCounts } from '../api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const FORMAT_COLUMNS = [
  { col: 'portfolio', example: 'RRSP',       notes: 'must exist' },
  { col: 'ticker',    example: 'RY',          notes: 'blank for cash flows' },
  { col: 'type',      example: 'Buy',         notes: 'Buy · Sell · Dividend · Dividend_Reinvest · Contribution · Withdrawal' },
  { col: 'quantity',  example: '100',         notes: 'number' },
  { col: 'price',     example: '139.20',      notes: 'per share' },
  { col: 'commission',example: '9.95',        notes: 'optional' },
  { col: 'date',      example: '2026-05-31',  notes: 'YYYY-MM-DD' },
]

const SAMPLE_HEADER = 'portfolio,ticker,type,quantity,price,commission,date'
const SAMPLE_ROW    = 'RRSP,RY,Buy,100,139.20,9.95,2026-05-31'

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function downloadTemplate() {
  const content = [SAMPLE_HEADER, SAMPLE_ROW, ''].join('\n')
  download(new Blob([content], { type: 'text/csv' }), 'yieldly-template.csv')
}

function downloadJSON(data, filename) {
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename)
}

const todayStamp = () => new Date().toISOString().slice(0, 10)
const counts = (d) => ({
  portfolios:   d?.portfolios?.length   ?? 0,
  transactions: d?.transactions?.length ?? 0,
  stock_info:   d?.stock_info?.length   ?? 0,
})

export default function Import({ onImported }) {
  return (
    <div className="flex flex-col gap-10">
      {/* ── SECTION 1 — CSV transaction import (additive) ───────────────── */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-foreground">Import transactions (CSV)</h2>
          <p className="text-sm text-foreground/60">
            Bulk-add transaction rows to portfolios that already exist. Adds only — never deletes existing data.
          </p>
        </div>
        <CsvImport onImported={onImported} />
      </section>

      {/* ── SECTION 2 — Full backup & restore (whole account) ───────────── */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-foreground">Full backup &amp; restore</h2>
          <p className="text-sm text-foreground/60">
            Move your entire account between servers — portfolios &amp; cash balances, the full transaction
            ledger, and holdings metadata (dividends, sector, type). Restoring <span className="font-medium">replaces everything</span>.
          </p>
        </div>
        <FullBackup onImported={onImported} />
      </section>
    </div>
  )
}

/* ─── CSV transaction import ──────────────────────────────────────────────── */
function CsvImport({ onImported }) {
  const [file, setFile]           = useState(null)
  const [csvData, setCsvData]     = useState(null)
  const [importing, setImporting] = useState(false)
  const [status, setStatus]       = useState(null)
  const [dragging, setDragging]   = useState(false)
  const fileInputRef              = useRef(null)

  const readFile = (f) => {
    if (!f || !f.name.endsWith('.csv')) return
    setFile(f)
    setStatus(null)
    const reader = new FileReader()
    reader.onload = ev => setCsvData(ev.target.result)
    reader.readAsText(f)
  }

  const handleFileChange = e => readFile(e.target.files[0])
  const handleDragOver   = e => { e.preventDefault(); setDragging(true) }
  const handleDragLeave  = () => setDragging(false)
  const handleDrop       = e => { e.preventDefault(); setDragging(false); readFile(e.dataTransfer.files[0]) }

  const handleImport = async () => {
    if (!csvData) return
    setImporting(true); setStatus(null)
    try {
      const result = await importCsv(csvData)
      if (result.imported === 0 && result.errors === 0) {
        setStatus({ type: 'error', imported: 0, errors: 0, details: [] })
      } else {
        setStatus({
          type:     result.errors > 0 ? 'partial' : 'success',
          imported: result.imported,
          skipped:  result.skipped || 0,
          errors:   result.errors  || 0,
          details:  result.details?.errors || [],
        })
        if (result.errors === 0) onImported()
      }
      setFile(null); setCsvData(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (e) {
      setStatus({ type: 'error', message: e.message, details: [] })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
      {/* LEFT — Upload */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Upload a CSV</CardTitle>
        </CardHeader>
        <CardContent className="py-6 flex flex-col gap-4">
          <button
            type="button"
            className={`w-full rounded-xl border-2 border-dashed p-10 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              dragging
                ? 'border-primary bg-primary/5'
                : 'border-border bg-muted/20 hover:bg-muted/40 hover:border-primary/40'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <p className="text-2xl mb-2">↓</p>
            <p className="font-semibold text-base">Drop your file here</p>
            <p className="text-sm text-foreground/70 mt-1">or click to browse · .csv up to 5 MB</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
            />
          </button>

          {file && (
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
              <div className="text-sm truncate">
                <span className="font-medium">{file.name}</span>
                <span className="ml-2 text-foreground/70">{(file.size / 1024).toFixed(0)} KB</span>
              </div>
              <Button size="sm" onClick={handleImport} disabled={importing} className="shrink-0">
                {importing ? 'Importing…' : 'Import'}
              </Button>
            </div>
          )}

          {!file && csvData === null && (
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="w-fit">
              Choose file
            </Button>
          )}

          {status && (
            <div className={`rounded-lg border px-4 py-4 flex flex-col gap-2 text-sm ${
              status.type === 'success' ? 'status-success'
              : status.type === 'partial' ? 'status-warning'
              : 'status-error'
            }`}>
              {status.type === 'success' && (
                <p className="font-semibold">✓ Import complete — {status.imported} rows added</p>
              )}
              {status.type === 'partial' && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">✓ Import complete</p>
                    <span className="badge-pos">{status.imported}</span>
                  </div>
                  <p>
                    {status.skipped > 0 && <>{status.skipped} skipped (duplicates) · </>}
                    {status.errors > 0 && <span className="font-medium">▼ {status.errors} error{status.errors !== 1 ? 's' : ''}</span>}
                  </p>
                </>
              )}
              {status.type === 'error' && status.message && (
                <p className="font-semibold">{status.message}</p>
              )}
              {status.details?.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer font-medium">View error detail</summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {status.details.map((e, i) => (
                      <li key={i} className="text-xs rounded bg-white/60 px-3 py-1 border border-current/10">
                        {typeof e === 'string' ? e : JSON.stringify(e)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* RIGHT — Expected format */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Expected format</CardTitle>
        </CardHeader>
        <CardContent className="py-6 flex flex-col gap-5">
          <p className="text-xs text-foreground/70">
            Header row required · one transaction per line · UTF-8
          </p>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left">Column</TableHead>
                  <TableHead className="text-left">Example</TableHead>
                  <TableHead className="text-left">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {FORMAT_COLUMNS.map(r => (
                  <TableRow key={r.col}>
                    <TableCell className="font-mono text-xs font-medium">{r.col}</TableCell>
                    <TableCell className="tabular-nums text-foreground/70">{r.example}</TableCell>
                    <TableCell className="text-xs text-foreground/70">{r.notes}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold text-foreground/70 uppercase tracking-wide">Sample row</p>
            <pre className="rounded-lg bg-muted px-4 py-3 text-xs font-mono overflow-x-auto select-all">
              {SAMPLE_HEADER}{'\n'}{SAMPLE_ROW}
            </pre>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              Download template
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* ─── Full backup & restore ───────────────────────────────────────────────── */
function FullBackup({ onImported }) {
  const [exporting, setExporting]   = useState(false)
  const [exportMsg, setExportMsg]   = useState(null)
  const [exportError, setExportError] = useState(null)
  const [restoring, setRestoring]   = useState(false)
  const [pending, setPending]       = useState(null)   // { data, incoming, name } awaiting confirmation
  const [current, setCurrent]       = useState(null)   // counts of data that will be wiped
  const [result, setResult]         = useState(null)
  const [error, setError]           = useState(null)
  const fileRef                     = useRef(null)

  // Reset the file input so re-selecting the same file fires onChange again.
  const clearInput = () => { if (fileRef.current) fileRef.current.value = '' }

  const handleExport = async () => {
    setExporting(true); setExportMsg(null); setExportError(null)
    try {
      const data = await exportData()
      downloadJSON(data, `yieldly-backup-${todayStamp()}.json`)
      const c = counts(data)
      setExportMsg(`${c.portfolios} portfolios · ${c.transactions} transactions · ${c.stock_info} holdings`)
    } catch (e) {
      setExportError(e.message)
    } finally {
      setExporting(false)
    }
  }

  const fail = (msg) => { setError(msg); clearInput() }

  const handleFile = async (f) => {
    setResult(null); setError(null); setPending(null); setCurrent(null)
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.json')) return fail('Please choose a .json backup file.')

    let parsed
    try {
      parsed = JSON.parse(await f.text())
    } catch {
      return fail('That file is not valid JSON.')
    }
    if (parsed?.version !== 1 || !Array.isArray(parsed.portfolios) || !Array.isArray(parsed.transactions)) {
      return fail('This does not look like a Yieldly backup file (version 1).')
    }

    // Show what is about to be wiped (counts only — no full download). If this
    // read fails, we still allow the restore; the confirmation just omits "before".
    try { setCurrent(await getDataCounts()) } catch { setCurrent(null) }
    setPending({ data: parsed, incoming: counts(parsed), name: f.name })
  }

  const confirmRestore = async () => {
    if (!pending || restoring) return
    setRestoring(true); setError(null)
    try {
      const res = await importData(pending.data)
      setResult(res.imported)
      cancel()
      onImported()
    } catch (e) {
      setError(e.message)
    } finally {
      setRestoring(false)
    }
  }

  const cancel = () => {
    setPending(null); setCurrent(null)
    clearInput()
  }

  return (
    <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
      {/* LEFT — Export */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Export a backup</CardTitle>
        </CardHeader>
        <CardContent className="py-6 flex flex-col gap-4">
          <p className="text-sm text-foreground/70">
            Downloads a single <span className="font-mono text-xs">.json</span> file containing every
            portfolio, transaction, and holding. Keep it private — it is a complete copy of your account data.
          </p>
          <ul className="text-xs text-foreground/60 flex flex-col gap-1 list-disc pl-5">
            <li>Portfolios — names, codes, order &amp; cash balances</li>
            <li>Transactions — the full ledger</li>
            <li>Holdings — dividend, sector &amp; type metadata</li>
          </ul>
          <Button onClick={handleExport} disabled={exporting} className="w-fit">
            {exporting ? 'Preparing…' : 'Download backup (.json)'}
          </Button>
          {exportMsg && (
            <div className="rounded-lg border px-4 py-3 text-sm status-success">
              ✓ Backup downloaded — {exportMsg}
            </div>
          )}
          {exportError && (
            <div className="rounded-lg border px-4 py-3 text-sm status-error">
              {exportError}
            </div>
          )}
        </CardContent>
      </Card>

      {/* RIGHT — Restore */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Restore from backup</CardTitle>
        </CardHeader>
        <CardContent className="py-6 flex flex-col gap-4">
          {!pending && (
            <>
              <p className="text-sm text-foreground/70">
                Load a backup file into this server. This <span className="font-medium">replaces all current
                data</span> with the contents of the file.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => handleFile(e.target.files[0])}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()} className="w-fit">
                Choose backup file…
              </Button>
            </>
          )}

          {/* Destructive confirmation */}
          {pending && (
            <div className="rounded-lg border px-4 py-4 flex flex-col gap-3 status-warning">
              <p className="font-semibold">Replace all data?</p>
              <p className="text-sm">
                Restoring <span className="font-mono text-xs">{pending.name}</span> cannot be undone.
              </p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide opacity-70">Will be deleted</span>
                  <BackupCounts c={current} fallback="current data" />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide opacity-70">Will be loaded</span>
                  <BackupCounts c={pending.incoming} />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="destructive" size="sm" onClick={confirmRestore} disabled={restoring}>
                  {restoring ? 'Restoring…' : 'Replace all data'}
                </Button>
                <Button variant="outline" size="sm" onClick={cancel} disabled={restoring}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {result && (
            <div className="rounded-lg border px-4 py-3 text-sm status-success">
              ✓ Restore complete — {result.portfolios} portfolios · {result.transactions} transactions · {result.stock_info} holdings
            </div>
          )}

          {error && (
            <div className="rounded-lg border px-4 py-3 text-sm status-error">
              {error}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function BackupCounts({ c, fallback }) {
  if (!c) return <span className="text-foreground/70">{fallback || '—'}</span>
  return (
    <ul className="tabular-nums">
      <li>{c.portfolios} portfolios</li>
      <li>{c.transactions} transactions</li>
      <li>{c.stock_info} holdings</li>
    </ul>
  )
}
