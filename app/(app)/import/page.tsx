'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, CheckCircle2, AlertCircle, Upload, FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'

interface ImportResult {
  companiesCreated: number
  companiesMatched: number
  metricsCreated: number
  metricsMatched: number
  metricValuesCreated: number
  metricValuesSkipped: number
  sendersCreated: number
  errors: string[]
}

interface InvestmentImportResult {
  investmentsCreated: number
  proceedsCreated: number
  unrealizedCreated: number
  companiesMatched: number
  companiesCreated: number
  errors: string[]
}

interface FileMatch {
  file: File
  filename: string
  companyId: string | null
  companyName: string | null
  confidence: string
  status: 'pending' | 'uploading' | 'done' | 'error'
  error?: string
  textOnly?: boolean
}

interface Company {
  id: string
  name: string
}

const ACCEPTED_DOC_TYPES = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.jpg,.jpeg,.png'
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB
const TEXT_ONLY_THRESHOLD = 10 * 1024 * 1024 // 10 MB — files above this get text-only extraction

export default function ImportPage() {
  const [text, setText] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Document upload state
  const [docFiles, setDocFiles] = useState<FileMatch[]>([])
  const [matching, setMatching] = useState(false)
  const [uploadingAll, setUploadingAll] = useState(false)
  const [docError, setDocError] = useState<string | null>(null)
  const [docSuccess, setDocSuccess] = useState<string | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [fundId, setFundId] = useState<string | null>(null)
  const docInputRef = useRef<HTMLInputElement>(null)

  // Investment import state
  const [investmentText, setInvestmentText] = useState('')
  const [investmentImporting, setInvestmentImporting] = useState(false)
  const [investmentResult, setInvestmentResult] = useState<InvestmentImportResult | null>(null)
  const [investmentError, setInvestmentError] = useState<string | null>(null)

  // Load companies for the dropdown and get fund_id
  useEffect(() => {
    async function loadCompanies() {
      try {
        const res = await fetch('/api/companies')
        if (res.ok) {
          const data = await res.json()
          const list = data.companies ?? data ?? []
          setCompanies(list)
        }
      } catch { /* ignore */ }
    }
    async function loadFundId() {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data } = await supabase
          .from('fund_members')
          .select('fund_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle() as { data: { fund_id: string } | null }
        if (data) setFundId(data.fund_id)
      } catch { /* ignore */ }
    }
    loadCompanies()
    loadFundId()
  }, [])

  async function handleImport() {
    if (!text.trim()) return
    setImporting(true)
    setResult(null)
    setError(null)

    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Import failed')
        return
      }

      setResult(data)
    } catch {
      setError('Something went wrong')
    } finally {
      setImporting(false)
    }
  }

  async function handleDocFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return

    setDocError(null)
    setDocSuccess(null)

    const fileList = Array.from(files)

    const initialMatches: FileMatch[] = fileList.map(f => ({
      file: f,
      filename: f.name,
      companyId: null,
      companyName: null,
      confidence: 'pending',
      status: 'pending',
    }))
    setDocFiles(initialMatches)

    // Auto-match using Claude
    setMatching(true)
    try {
      const res = await fetch('/api/import/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: fileList.map(f => f.name) }),
      })

      if (res.ok) {
        const data = await res.json()
        if (data.fundId) setFundId(data.fundId)
        const matchMap = new Map<string, { companyId: string | null; companyName: string | null; confidence: string }>()
        for (const m of data.matches ?? []) {
          matchMap.set(m.filename, { companyId: m.companyId, companyName: m.companyName, confidence: m.confidence })
        }

        setDocFiles(prev => prev.map(f => {
          const match = matchMap.get(f.filename)
          if (match) {
            return { ...f, companyId: match.companyId, companyName: match.companyName, confidence: match.confidence }
          }
          return f
        }))
      } else {
        const data = await res.json()
        setDocError(data.error ?? 'Auto-matching failed')
      }
    } catch {
      setDocError('Auto-matching failed')
    } finally {
      setMatching(false)
    }

    // Reset input
    if (docInputRef.current) docInputRef.current.value = ''
  }

  function updateFileCompany(filename: string, companyId: string) {
    const company = companies.find(c => c.id === companyId)
    setDocFiles(prev => prev.map(f =>
      f.filename === filename
        ? { ...f, companyId, companyName: company?.name ?? null, confidence: 'manual' }
        : f
    ))
  }

  async function handleUploadAll() {
    const filesToUpload = docFiles.filter(f => f.companyId && f.status !== 'done')
    if (filesToUpload.length === 0) return

    setUploadingAll(true)
    setDocError(null)
    setDocSuccess(null)

    const supabase = createClient()
    let successCount = 0
    let errorCount = 0

    for (const fileMatch of filesToUpload) {
      setDocFiles(prev => prev.map(f =>
        f.filename === fileMatch.filename ? { ...f, status: 'uploading' } : f
      ))

      try {
        if (fileMatch.file.size > MAX_FILE_SIZE) {
          throw new Error('File exceeds 50 MB limit')
        }
        const isOversized = fileMatch.file.size > TEXT_ONLY_THRESHOLD
        const storagePath = `${fundId}/${fileMatch.companyId}/${crypto.randomUUID()}-${fileMatch.filename}`

        // Upload to Storage
        const { error: uploadError } = await supabase
          .storage
          .from('company-documents')
          .upload(storagePath, fileMatch.file)

        if (uploadError) throw new Error(uploadError.message)

        // Register via API
        const res = await fetch(`/api/companies/${fileMatch.companyId}/documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storagePath,
            filename: fileMatch.filename,
            fileType: fileMatch.file.type || `application/${fileMatch.filename.split('.').pop()}`,
            fileSize: fileMatch.file.size,
            ...(isOversized ? { textOnly: true } : {}),
          }),
        })

        if (!res.ok) {
          let errorMsg = 'Registration failed'
          try {
            const data = await res.json()
            errorMsg = data.error ?? errorMsg
          } catch {
            errorMsg = `Server error (${res.status}). The file may be too large to process.`
          }
          throw new Error(errorMsg)
        }

        let result: { textOnly?: boolean } = {}
        try {
          result = await res.json()
        } catch {
          // Non-JSON response — treat as success since status was ok
        }

        setDocFiles(prev => prev.map(f =>
          f.filename === fileMatch.filename
            ? { ...f, status: 'done', textOnly: isOversized && result.textOnly }
            : f
        ))
        successCount++
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed'
        setDocFiles(prev => prev.map(f =>
          f.filename === fileMatch.filename ? { ...f, status: 'error', error: message } : f
        ))
        errorCount++
      }
    }

    setUploadingAll(false)
    if (successCount > 0) {
      setDocSuccess(`${successCount} document${successCount > 1 ? 's' : ''} uploaded successfully${errorCount > 0 ? `, ${errorCount} failed` : ''}`)
    }
    if (errorCount > 0 && successCount === 0) {
      setDocError('All uploads failed')
    }
  }

  async function handleInvestmentImport() {
    if (!investmentText.trim()) return
    setInvestmentImporting(true)
    setInvestmentResult(null)
    setInvestmentError(null)

    try {
      const res = await fetch('/api/import/investments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: investmentText }),
      })

      const data = await res.json()
      if (!res.ok) {
        setInvestmentError(data.error ?? 'Import failed')
        return
      }

      setInvestmentResult(data)
    } catch {
      setInvestmentError('Something went wrong')
    } finally {
      setInvestmentImporting(false)
    }
  }

  const matchedCount = docFiles.filter(f => f.companyId).length
  const unmatchedCount = docFiles.filter(f => !f.companyId).length

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Import</h1>
        <AnalystToggleButton />
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
      <div className="flex-1 min-w-0 max-w-3xl w-full">
      {/* Document Upload Section */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight mb-2">Document Upload</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Upload documents (strategy decks, board materials, reports) and auto-match them to portfolio companies. These provide additional context for the AI analyst.
        </p>

        {docError && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{docError}</AlertDescription>
          </Alert>
        )}

        {docSuccess && (
          <Alert className="mb-4">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>{docSuccess}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div>
            <input
              ref={docInputRef}
              type="file"
              multiple
              accept={ACCEPTED_DOC_TYPES}
              onChange={handleDocFilesSelected}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => docInputRef.current?.click()}
              disabled={matching || uploadingAll}
            >
              <Upload className="h-4 w-4 mr-2" />
              Select Files
            </Button>
            <p className="text-xs text-muted-foreground mt-1.5">Max 50 MB per file. Files over 10 MB will have text extracted only.</p>
          </div>

          {matching && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Matching filenames to companies...
            </div>
          )}

          {docFiles.length > 0 && !matching && (
            <>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-3 py-2 font-medium">Filename</th>
                      <th className="text-left px-3 py-2 font-medium">Matched Company</th>
                      <th className="text-left px-3 py-2 font-medium w-20">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docFiles.map((f, i) => (
                      <tr key={i} className="border-b last:border-b-0">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate">{f.filename}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={f.companyId ?? 'unmatched'}
                            onValueChange={(val) => updateFileCompany(f.filename, val)}
                          >
                            <SelectTrigger className="h-8 text-xs w-48">
                              <SelectValue placeholder="Select company..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unmatched">
                                <span className="text-muted-foreground">No match</span>
                              </SelectItem>
                              {companies.map(c => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          {f.status === 'pending' && f.companyId && (
                            <span className="text-xs text-muted-foreground">Ready</span>
                          )}
                          {f.status === 'pending' && !f.companyId && (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                          {f.status === 'uploading' && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          )}
                          {f.status === 'done' && !f.textOnly && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                          )}
                          {f.status === 'done' && f.textOnly && (
                            <span className="text-xs text-amber-600" title="File exceeded 10 MB — only extracted text was stored (no native PDF/image)">Text only</span>
                          )}
                          {f.status === 'error' && (
                            <span className="text-xs text-destructive" title={f.error}>Failed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {matchedCount} matched{unmatchedCount > 0 ? `, ${unmatchedCount} unmatched` : ''}
                </p>
                <Button
                  onClick={handleUploadAll}
                  disabled={uploadingAll || matchedCount === 0}
                >
                  {uploadingAll && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {uploadingAll ? 'Uploading...' : `Upload ${matchedCount} File${matchedCount !== 1 ? 's' : ''}`}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Paste Data Section */}
      <div className="mt-12 pt-8 border-t">
        <h2 className="text-xl font-semibold tracking-tight mb-2">Paste Company Metrics</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Paste CSV or spreadsheet data from Google Sheets. Claude will parse it to create companies, metrics, and historical values.
        </p>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && (
          <Alert className="mb-4">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-1">
                <p className="font-medium">Import complete</p>
                <ul className="text-sm space-y-0.5">
                  <li>{result.companiesCreated} companies created{result.companiesMatched > 0 ? `, ${result.companiesMatched} matched existing` : ''}</li>
                  <li>{result.metricsCreated} metrics created{result.metricsMatched > 0 ? `, ${result.metricsMatched} matched existing` : ''}</li>
                  <li>{result.metricValuesCreated} metric values imported{result.metricValuesSkipped > 0 ? `, ${result.metricValuesSkipped} skipped (already exist)` : ''}</li>
                  {result.sendersCreated > 0 && (
                    <li>{result.sendersCreated} authorized senders added</li>
                  )}
                </ul>
                {result.errors.length > 0 && (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-destructive">Issues:</p>
                    <ul className="text-sm text-destructive space-y-0.5">
                      {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <Textarea
            placeholder={`Paste your spreadsheet data here...\n\nExample:\nCompany, Fund, Sector, Stage, Email, MRR Q1 2025, MRR Q2 2025\nAcme Corp, Fund I, SaaS, Series A, cfo@acme.com, 50000, 65000\nBeta Inc, Fund II, Fintech, Seed, founder@beta.io, 12000, 15000`}
            value={text}
            onChange={e => setText(e.target.value)}
            rows={16}
            className="font-mono text-sm"
          />

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Supports CSV, tab-separated, or any tabular text format.
            </p>
            <Button onClick={handleImport} disabled={importing || !text.trim()}>
              {importing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {importing ? 'Importing...' : 'Import'}
            </Button>
          </div>
        </div>
      </div>

      {/* Investment Data Section */}
      <div className="mt-12 pt-8 border-t">
        <h2 className="text-xl font-semibold tracking-tight mb-2">Paste Investment Data</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Paste investment transaction data (rounds, proceeds, valuations). AI will parse and match to existing portfolio companies.
        </p>

        {investmentError && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{investmentError}</AlertDescription>
          </Alert>
        )}

        {investmentResult && (
          <Alert className="mb-4">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-1">
                <p className="font-medium">Import complete</p>
                <ul className="text-sm space-y-0.5">
                  {investmentResult.investmentsCreated > 0 && (
                    <li>{investmentResult.investmentsCreated} investment transaction{investmentResult.investmentsCreated !== 1 ? 's' : ''} created</li>
                  )}
                  {investmentResult.proceedsCreated > 0 && (
                    <li>{investmentResult.proceedsCreated} proceeds transaction{investmentResult.proceedsCreated !== 1 ? 's' : ''} created</li>
                  )}
                  {investmentResult.unrealizedCreated > 0 && (
                    <li>{investmentResult.unrealizedCreated} unrealized change{investmentResult.unrealizedCreated !== 1 ? 's' : ''} created</li>
                  )}
                  <li>{investmentResult.companiesMatched} compan{investmentResult.companiesMatched !== 1 ? 'ies' : 'y'} matched</li>
                  {investmentResult.companiesCreated > 0 && (
                    <li>{investmentResult.companiesCreated} compan{investmentResult.companiesCreated !== 1 ? 'ies' : 'y'} created</li>
                  )}
                </ul>
                {investmentResult.errors.length > 0 && (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-destructive">Issues:</p>
                    <ul className="text-sm text-destructive space-y-0.5">
                      {investmentResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <Textarea
            placeholder={`Paste investment data here...\n\nExample:\nCompany, Round, Date, Amount Invested, Shares, Price/Share\nAcme Corp, Series A, 2024-03-15, 500000, 50000, 10.00\nBeta Inc, Seed, 2023-11-01, 250000, 100000, 2.50`}
            value={investmentText}
            onChange={e => setInvestmentText(e.target.value)}
            rows={12}
            className="font-mono text-sm"
          />

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Supports CSV, tab-separated, or free-form text. New companies will be created automatically.
            </p>
            <Button onClick={handleInvestmentImport} disabled={investmentImporting || !investmentText.trim()}>
              {investmentImporting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {investmentImporting ? 'Importing...' : 'Import Investments'}
            </Button>
          </div>
        </div>
      </div>
    </div>
    <AnalystPanel />
    </div>
    </div>
  )
}
