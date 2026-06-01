import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function Import({ onImported }) {
  const [file, setFile]           = useState(null)
  const [csvData, setCsvData]     = useState(null)
  const [importing, setImporting] = useState(false)
  const [status, setStatus]       = useState(null)

  const handleFileChange = (e) => {
    const f = e.target.files[0]
    if (!f) return
    setFile(f)
    setStatus(null)
    const reader = new FileReader()
    reader.onload = (ev) => setCsvData(ev.target.result)
    reader.readAsText(f)
  }

  const handleImport = async () => {
    if (!csvData) { alert('Select a CSV file first'); return }
    setImporting(true)
    setStatus(null)
    try {
      const res = await fetch('/api/import/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvData })
      })
      if (!res.ok) throw new Error('Failed to import CSV')
      const result = await res.json()
      if (result.imported === 0 && result.errors === 0) {
        setStatus({ type: 'error', message: 'No data imported — file may be empty or invalid.' })
      } else if (result.errors > 0) {
        setStatus({ type: 'error', message: `Imported ${result.imported} transactions with ${result.errors} error(s).`, errors: result.details?.errors })
      } else {
        setStatus({ type: 'success', message: `Success! Imported ${result.imported} transactions.` })
        onImported()
      }
      setFile(null); setCsvData(null)
    } catch (e) {
      setStatus({ type: 'error', message: e.message })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Import Data</h1>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>CSV Import</CardTitle>
          <CardDescription>
            Format: Date, Symbol, Portfolio, Type, Quantity, Share Price, Total
            <br />
            Type codes: B=Buy, S=Sell, D=Dividend, DR=Dividend Reinvest
            <br />
            The Portfolio column should match an existing portfolio code.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <input type="file" id="csv-file" accept=".csv" className="hidden"
              onChange={handleFileChange} />
            <Button variant="outline" onClick={() => document.getElementById('csv-file').click()}>
              Choose CSV File
            </Button>
            {file && <span className="text-sm text-muted-foreground">{file.name}</span>}
          </div>

          <Button onClick={handleImport} disabled={!csvData || importing} className="w-fit">
            {importing ? 'Importing…' : 'Import CSV'}
          </Button>

          {status && (
            <div className={`rounded-lg border px-4 py-3 text-sm ${status.type === 'success' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
              <strong>{status.message}</strong>
              {status.errors?.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer">View {status.errors.length} error(s)</summary>
                  <pre className="mt-2 text-xs whitespace-pre-wrap">
                    {JSON.stringify(status.errors, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
