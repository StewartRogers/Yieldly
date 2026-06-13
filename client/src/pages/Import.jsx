import { useState, useRef } from 'react'
import { importCsv } from '../api/client'
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

function downloadTemplate() {
  const content = [SAMPLE_HEADER, SAMPLE_ROW, ''].join('\n')
  const blob    = new Blob([content], { type: 'text/csv' })
  const url     = URL.createObjectURL(blob)
  const a       = document.createElement('a')
  a.href = url; a.download = 'yieldly-template.csv'; a.click()
  URL.revokeObjectURL(url)
}

export default function Import({ onImported }) {
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
    // F4: Tailwind grid cols instead of inline style; F4 also adds mobile responsiveness
    <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">

      {/* LEFT — Upload */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Upload a CSV</CardTitle>
        </CardHeader>
        <CardContent className="py-6 flex flex-col gap-4">

          {/* F3: <button> makes the dropzone keyboard-accessible */}
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
              <Button size="sm" onClick={handleImport} disabled={importing}>
                {importing ? 'Importing…' : '↑ Import'}
              </Button>
            </div>
          )}

          {!file && csvData === null && (
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="w-fit">
              Choose file
            </Button>
          )}

          {/* F2: .status-success/.error/.warning from style.css instead of hardcoded palette classes */}
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

          {/* F8: shadcn Table instead of native <table> */}
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
              ↓ Download template
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
