'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Lock, RefreshCw, Copy, Check, Save, FileText, Download, ExternalLink, ChevronDown, ChevronRight, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useFeatureVisibility } from '@/components/feature-visibility-context'

interface CompanyNarrative {
  company_id: string
  company_name: string
  narrative: string
  updated_by: string | null
  updated_at: string
}

interface CompanyPrompt {
  prompt: string
  mode: 'add' | 'replace'
}

interface Letter {
  id: string
  fund_id: string
  template_id: string | null
  period_year: number
  period_quarter: number
  is_year_end: boolean
  period_label: string
  portfolio_group: string
  portfolio_table_html: string | null
  company_narratives: CompanyNarrative[]
  full_draft: string | null
  generation_prompt: string | null
  generation_error: string | null
  company_prompts: Record<string, CompanyPrompt> | null
  status: string
  created_at: string
  updated_at: string
}

export default function LetterEditorPage() {
  const fv = useFeatureVisibility()
  const router = useRouter()
  const params = useParams()
  const letterId = params.id as string

  const [letter, setLetter] = useState<Letter | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [regenerating, setRegenerating] = useState<string | null>(null)
  const [regeneratingAll, setRegeneratingAll] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editingNarrative, setEditingNarrative] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [fullDraft, setFullDraft] = useState('')
  const [viewMode, setViewMode] = useState<'sections' | 'full'>('sections')
  const [exporting, setExporting] = useState<string | null>(null)
  const [googleDriveConnected, setGoogleDriveConnected] = useState(false)
  const [globalPromptOpen, setGlobalPromptOpen] = useState(false)
  const [globalPromptText, setGlobalPromptText] = useState('')
  const [savingGlobalPrompt, setSavingGlobalPrompt] = useState(false)
  const [editingCompanyPrompt, setEditingCompanyPrompt] = useState<string | null>(null)
  const [companyPromptText, setCompanyPromptText] = useState('')
  const [companyPromptMode, setCompanyPromptMode] = useState<'add' | 'replace'>('add')
  const [savingCompanyPrompt, setSavingCompanyPrompt] = useState(false)

  const loadLetter = useCallback(async () => {
    const res = await fetch(`/api/lp-letters/${letterId}`)
    if (res.ok) {
      const data = await res.json()
      setLetter(data)
      setFullDraft(data.full_draft ?? '')
      setGlobalPromptText(data.generation_prompt ?? '')
    }
    setLoading(false)
  }, [letterId])

  useEffect(() => {
    loadLetter()
  }, [loadLetter])

  // Poll for updates when letter is generating server-side
  useEffect(() => {
    if (!letter || letter.status !== 'generating') return
    const interval = setInterval(() => { loadLetter() }, 5000)
    return () => clearInterval(interval)
  }, [letter?.status, loadLetter])

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.googleDriveConnected) setGoogleDriveConnected(true)
      })
      .catch(() => {})
  }, [])

  const saveNarrative = async (companyId: string, text: string) => {
    if (!letter) return
    const narratives = [...(letter.company_narratives ?? [])]
    const idx = narratives.findIndex(n => n.company_id === companyId)
    if (idx >= 0) {
      narratives[idx] = { ...narratives[idx], narrative: text, updated_at: new Date().toISOString() }
    }

    setSaving(true)
    const res = await fetch(`/api/lp-letters/${letterId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_narratives: narratives }),
    })
    if (res.ok) {
      const updated = await res.json()
      setLetter(updated)
    }
    setSaving(false)
    setEditingNarrative(null)
  }

  const saveFullDraft = async () => {
    setSaving(true)
    const res = await fetch(`/api/lp-letters/${letterId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_draft: fullDraft }),
    })
    if (res.ok) {
      const updated = await res.json()
      setLetter(updated)
    }
    setSaving(false)
  }

  const regenerateCompany = async (companyId: string) => {
    setRegenerating(companyId)
    const res = await fetch(`/api/lp-letters/${letterId}/generate/${companyId}`, { method: 'POST' })
    if (res.ok) {
      await loadLetter()
    }
    setRegenerating(null)
  }

  const regenerateAll = async () => {
    setRegeneratingAll(true)
    const res = await fetch(`/api/lp-letters/${letterId}/generate`, { method: 'POST' })
    if (res.ok) {
      await loadLetter()
    }
    setRegeneratingAll(false)
  }

  const copyToClipboard = () => {
    const text = letter?.full_draft ?? fullDraft
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const exportLetter = async (format: 'markdown' | 'docx' | 'google-docs') => {
    setExporting(format)
    try {
      const res = await fetch(`/api/lp-letters/${letterId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Export failed' }))
        alert(err.error ?? 'Export failed')
        return
      }

      if (format === 'google-docs') {
        const { url } = await res.json()
        window.open(url, '_blank')
      } else {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const ext = format === 'docx' ? 'docx' : 'md'
        a.download = `${letter?.period_label ?? 'letter'}.${ext}`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch {
      alert('Export failed')
    } finally {
      setExporting(null)
    }
  }

  const saveGlobalPrompt = async () => {
    setSavingGlobalPrompt(true)
    const res = await fetch(`/api/lp-letters/${letterId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation_prompt: globalPromptText || null }),
    })
    if (res.ok) {
      const updated = await res.json()
      setLetter(updated)
    }
    setSavingGlobalPrompt(false)
  }

  const saveCompanyPrompt = async (companyId: string) => {
    if (!letter) return
    setSavingCompanyPrompt(true)
    const existing = letter.company_prompts ?? {}
    const updated = { ...existing }
    if (companyPromptText.trim()) {
      updated[companyId] = { prompt: companyPromptText.trim(), mode: companyPromptMode }
    } else {
      delete updated[companyId]
    }
    const res = await fetch(`/api/lp-letters/${letterId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_prompts: updated }),
    })
    if (res.ok) {
      const data = await res.json()
      setLetter(data)
    }
    setSavingCompanyPrompt(false)
    setEditingCompanyPrompt(null)
  }

  const openCompanyPrompt = (companyId: string) => {
    const cp = letter?.company_prompts?.[companyId]
    setCompanyPromptText(cp?.prompt ?? '')
    setCompanyPromptMode(cp?.mode ?? 'add')
    setEditingCompanyPrompt(companyId)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!letter) {
    return (
      <div className="p-8">
        <p className="text-sm text-destructive">Letter not found.</p>
        <Link href="/letters" className="text-sm underline mt-2">Back to letters</Link>
      </div>
    )
  }

  const narratives: CompanyNarrative[] = Array.isArray(letter.company_narratives) ? letter.company_narratives : []
  const hasContent = narratives.length > 0 || letter.full_draft

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      {/* Header */}
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Link href="/letters" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              {fv.lp_letters === 'admin' && <Lock className="h-4 w-4 text-amber-500" />}{letter.period_label}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">{letter.portfolio_group}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={copyToClipboard}>
            {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          {hasContent && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportLetter('docx')}
              disabled={!!exporting}
            >
              {exporting === 'docx' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
              Download .docx
            </Button>
          )}
          {hasContent && googleDriveConnected && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportLetter('google-docs')}
              disabled={!!exporting}
            >
              {exporting === 'google-docs' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <ExternalLink className="h-3.5 w-3.5 mr-1.5" />}
              Google Docs
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={regenerateAll}
            disabled={regeneratingAll}
          >
            {regeneratingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            Regenerate all
          </Button>
        </div>
      </div>

      {/* View mode toggle */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setViewMode('sections')}
          className={`text-xs px-3 py-1 rounded-md ${viewMode === 'sections' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
        >
          By company
        </button>
        <button
          onClick={() => setViewMode('full')}
          className={`text-xs px-3 py-1 rounded-md ${viewMode === 'full' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
        >
          Full draft
        </button>
      </div>

      {/* Global prompt editor */}
      <div className="rounded-lg border mb-4">
        <button
          onClick={() => setGlobalPromptOpen(!globalPromptOpen)}
          className="flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm hover:bg-muted/50"
        >
          {globalPromptOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <span className="font-medium">Generation prompt</span>
          {letter.generation_prompt && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">customized</span>
          )}
        </button>
        {globalPromptOpen && (
          <div className="px-4 pb-3 space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Custom instructions applied to all company narratives during generation.
            </p>
            <Textarea
              value={globalPromptText}
              onChange={e => setGlobalPromptText(e.target.value)}
              placeholder="e.g., Write in a concise, data-driven style. Focus on ARR growth and burn rate..."
              rows={4}
              className="text-sm"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={saveGlobalPrompt}
                disabled={savingGlobalPrompt || globalPromptText === (letter.generation_prompt ?? '')}
              >
                {savingGlobalPrompt ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                Save prompt
              </Button>
            </div>
          </div>
        )}
      </div>

      {!hasContent && !regeneratingAll && letter.status === 'generating' && (
        <div className="rounded-lg border bg-muted/30 p-8 text-center space-y-3">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Generation is in progress. This may take a few minutes...
          </p>
          <p className="text-xs text-muted-foreground/60">This page will update automatically when ready.</p>
        </div>
      )}

      {!hasContent && !regeneratingAll && letter.status !== 'generating' && (
        <div className="rounded-lg border border-dashed p-12 text-center space-y-3">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground" />
          {letter.generation_error ? (
            <>
              <p className="text-sm text-destructive">Generation failed</p>
              <p className="text-xs text-muted-foreground">{letter.generation_error}</p>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">No content has been generated for this letter yet.</p>
              <p className="text-xs text-muted-foreground/60">Click below to generate AI-written narratives for each portfolio company.</p>
            </>
          )}
          <Button size="sm" onClick={regenerateAll}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            {letter.generation_error ? 'Retry generation' : 'Generate letter'}
          </Button>
        </div>
      )}

      {regeneratingAll && (
        <div className="rounded-lg border bg-muted/30 p-8 text-center space-y-3">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Generating narratives for all companies. This may take a few minutes...
          </p>
        </div>
      )}

      {/* Section view */}
      {viewMode === 'sections' && hasContent && !regeneratingAll && (
        <div className="space-y-6">
          {/* Portfolio table */}
          {letter.portfolio_table_html && (
            <div className="rounded-lg border p-4">
              <h2 className="font-medium text-sm mb-3">Portfolio Summary</h2>
              <div
                className="prose prose-sm dark:prose-invert max-w-none [&_table]:w-full [&_table]:text-xs [&_th]:px-2 [&_th]:py-1.5 [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_td]:border [&_thead]:bg-muted/50"
                dangerouslySetInnerHTML={{ __html: letter.portfolio_table_html }}
              />
            </div>
          )}

          {/* Company narratives */}
          {narratives.map(n => (
            <div key={n.company_id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-sm">{n.company_name}</h3>
                <div className="flex items-center gap-2">
                  {editingNarrative !== n.company_id && (
                    <button
                      onClick={() => { setEditingNarrative(n.company_id); setEditText(n.narrative) }}
                      className="text-[11px] text-primary hover:underline"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    onClick={() => editingCompanyPrompt === n.company_id ? setEditingCompanyPrompt(null) : openCompanyPrompt(n.company_id)}
                    className={`text-[11px] flex items-center gap-1 ${
                      letter.company_prompts?.[n.company_id] ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <MessageSquare className="h-3 w-3" />
                    Prompt
                  </button>
                  <button
                    onClick={() => regenerateCompany(n.company_id)}
                    disabled={regenerating === n.company_id}
                    className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    {regenerating === n.company_id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Regenerate
                  </button>
                </div>
              </div>

              {editingNarrative === n.company_id ? (
                <div className="space-y-2">
                  <Textarea
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    rows={8}
                    className="text-sm"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => saveNarrative(n.company_id, editText)}
                      disabled={saving}
                    >
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingNarrative(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed">
                  {n.narrative}
                </div>
              )}

              {/* Per-company prompt editor */}
              {editingCompanyPrompt === n.company_id && (
                <div className="mt-3 pt-3 border-t space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    Custom instructions for this company only.
                  </p>
                  <Textarea
                    value={companyPromptText}
                    onChange={e => setCompanyPromptText(e.target.value)}
                    placeholder="e.g., Emphasize product milestones and customer growth..."
                    rows={3}
                    className="text-sm"
                  />
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1">
                      <button
                        onClick={() => setCompanyPromptMode('add')}
                        className={`text-[11px] px-2 py-0.5 rounded ${companyPromptMode === 'add' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                      >
                        Add to global
                      </button>
                      <button
                        onClick={() => setCompanyPromptMode('replace')}
                        className={`text-[11px] px-2 py-0.5 rounded ${companyPromptMode === 'replace' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                      >
                        Replace global
                      </button>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => saveCompanyPrompt(n.company_id)}
                      disabled={savingCompanyPrompt}
                    >
                      {savingCompanyPrompt ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                      Save
                    </Button>
                  </div>
                </div>
              )}

              <p className="text-[10px] text-muted-foreground/50 mt-2">
                Last updated: {new Date(n.updated_at).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Full draft view */}
      {viewMode === 'full' && hasContent && !regeneratingAll && (
        <div className="space-y-4">
          <Textarea
            value={fullDraft}
            onChange={e => setFullDraft(e.target.value)}
            rows={40}
            className="font-mono text-sm leading-relaxed"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={saveFullDraft}
              disabled={saving || fullDraft === letter.full_draft}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Save draft
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFullDraft(letter.full_draft ?? '')}
              disabled={fullDraft === letter.full_draft}
            >
              Revert
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
