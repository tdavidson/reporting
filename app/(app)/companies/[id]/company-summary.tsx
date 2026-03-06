'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Sparkles, RefreshCw, Trash2, Upload, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

interface SummaryData {
  summary: string | null
  period_label?: string | null
  generated_at?: string | null
}

interface Props {
  companyId: string
  fundId: string
  hasClaudeKey?: boolean
  hasOpenAIKey?: boolean
  defaultAIProvider?: string
}

const ACCEPTED_TYPES = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.jpg,.jpeg,.png'
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB
const TEXT_ONLY_THRESHOLD = 10 * 1024 * 1024 // 10 MB — files above this get text-only extraction

export function CompanySummary({ companyId, fundId, hasClaudeKey, hasOpenAIKey, defaultAIProvider }: Props) {
  const [data, setData] = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<string>(defaultAIProvider ?? 'anthropic')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showProviderToggle = hasClaudeKey && hasOpenAIKey

  // Load the latest stored summary
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/companies/${companyId}/summary`)
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [companyId])

  // Generate a new summary via POST
  async function generate() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/companies/${companyId}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(showProviderToggle ? { provider: selectedProvider } : {}),
      })
      const result = await res.json()
      if (res.ok) {
        setData(result)
      } else {
        setError(result.error ?? 'Unable to generate summary.')
      }
    } catch {
      setError('Unable to generate summary at this time.')
    } finally {
      setGenerating(false)
    }
  }

  async function clear() {
    setClearing(true)
    setError(null)
    try {
      const res = await fetch(`/api/companies/${companyId}/summary`, { method: 'DELETE' })
      if (res.ok) {
        setData({ summary: null })
      }
    } catch {
      setError('Failed to clear summary.')
    } finally {
      setClearing(false)
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_FILE_SIZE) {
      setError('File exceeds 50 MB limit')
      return
    }

    const isOversized = file.size > TEXT_ONLY_THRESHOLD

    setUploading(true)
    setError(null)
    setWarning(null)

    try {
      const supabase = createClient()
      const storagePath = `${fundId}/${companyId}/${crypto.randomUUID()}-${file.name}`

      const { error: uploadError } = await supabase
        .storage
        .from('company-documents')
        .upload(storagePath, file)

      if (uploadError) {
        setError(`Upload failed: ${uploadError.message}`)
        return
      }

      const fileExt = file.name.split('.').pop()
      const res = await fetch(`/api/companies/${companyId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storagePath,
          filename: file.name,
          fileType: file.type || `application/${fileExt}`,
          fileSize: file.size,
          ...(isOversized ? { textOnly: true } : {}),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to register document')
      } else if (isOversized) {
        setWarning('File exceeds 10 MB — only extracted text was stored.')
      }
    } catch {
      setError('Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  useEffect(() => { load() }, [load])

  // Loading skeleton
  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-5 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Analyst</span>
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-3 bg-muted rounded w-full" />
          <div className="h-3 bg-muted rounded w-5/6" />
          <div className="h-3 bg-muted rounded w-4/6" />
        </div>
      </div>
    )
  }

  // No summary yet — show generate button
  if (!data?.summary) {
    return (
      <div className="rounded-lg border border-dashed bg-card p-5 mb-6">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          onChange={handleUpload}
          className="hidden"
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Analyst</span>
          </div>
          <div className="flex items-center gap-1">
            {showProviderToggle && (
              <select
                className="h-7 rounded-md border border-input bg-transparent px-2 text-xs text-muted-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value)}
                disabled={generating}
              >
                <option value="anthropic">Claude</option>
                <option value="openai">OpenAI</option>
              </select>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-muted-foreground"
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5 mr-1.5" />
              )}
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
            <Button size="sm" variant="outline" onClick={generate} disabled={generating} className="text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              {generating ? 'Analyzing…' : 'Analyze'}
            </Button>
          </div>
        </div>
        {generating && (
          <div className="animate-pulse space-y-2 mt-3">
            <div className="h-3 bg-muted rounded w-full" />
            <div className="h-3 bg-muted rounded w-5/6" />
            <div className="h-3 bg-muted rounded w-4/6" />
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive mt-3">{error}</p>
        )}
        {warning && (
          <p className="text-sm text-amber-600 mt-3">{warning}</p>
        )}
      </div>
    )
  }

  // Render the summary with paragraph breaks
  const paragraphs = data.summary.split('\n\n').filter(p => p.trim())

  return (
    <div className="rounded-lg border bg-card p-5 mb-6">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        onChange={handleUpload}
        className="hidden"
      />
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Analyst</span>
          {data.generated_at && (
            <span className="text-[10px] text-muted-foreground">
              · {new Date(data.generated_at).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric', year: 'numeric',
              })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {showProviderToggle && (
            <select
              className="h-7 rounded-md border border-input bg-transparent px-2 text-xs text-muted-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              disabled={generating}
            >
              <option value="anthropic">Claude</option>
              <option value="openai">OpenAI</option>
            </select>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Upload document"
            className="text-muted-foreground"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5 mr-1.5" />
            )}
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={generate}
            disabled={generating || clearing}
            title="Regenerate summary"
            className="h-7 px-2 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={clear}
            disabled={generating || clearing}
            title="Clear and start fresh"
            className="h-7 px-2 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-sm leading-relaxed">{p}</p>
        ))}
      </div>
      {generating && (
        <div className="animate-pulse space-y-2 mt-3 pt-3 border-t">
          <div className="h-3 bg-muted rounded w-full" />
          <div className="h-3 bg-muted rounded w-5/6" />
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive mt-3 pt-3 border-t">{error}</p>
      )}
      {warning && (
        <p className="text-sm text-amber-600 mt-3 pt-3 border-t">{warning}</p>
      )}
    </div>
  )
}
