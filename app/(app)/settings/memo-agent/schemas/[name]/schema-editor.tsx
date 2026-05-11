'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Loader2, AlertCircle, Clock, RotateCcw, Check, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/confirm-dialog'

const MonacoEditor = dynamic(() => import('@monaco-editor/react').then(m => m.default), { ssr: false })
const MonacoDiffEditor = dynamic(() => import('@monaco-editor/react').then(m => m.DiffEditor), { ssr: false })

interface ValidationError {
  message: string
  line?: number
  path?: string
  kind: 'syntax' | 'schema'
}

interface CrossReferenceWarning {
  source_schema: string
  field: string
  missing_id: string
  message: string
}

interface HistoryEntry {
  id: string
  schema_version: string
  yaml_content: string
  edit_note: string | null
  edited_by: string | null
  edited_at: string
  is_active: boolean
}

const SCHEMA_LABELS: Record<string, string> = {
  rubric: 'Rubric',
  qa_library: 'Q&A Library',
  data_room_ingestion: 'Data Room Ingestion',
  research_dossier: 'Research Dossier',
  memo_output: 'Memo Output',
  style_anchors: 'Style Anchors',
  instructions: 'Instructions',
}

export function SchemaEditor({ schemaName, initialContent, initialVersion }: {
  schemaName: string
  initialContent: string
  initialVersion: string
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [content, setContent] = useState(initialContent)
  const [version, setVersion] = useState(initialVersion)
  const [editNote, setEditNote] = useState('')
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [warnings, setWarnings] = useState<CrossReferenceWarning[]>([])
  const [validating, setValidating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [diffAgainst, setDiffAgainst] = useState<HistoryEntry | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const language = schemaName === 'instructions' ? 'markdown' : 'yaml'
  const dirty = content !== initialContent

  const validate = useCallback(async (yaml: string) => {
    setValidating(true)
    try {
      // Validate locally by hitting a side-effect-free endpoint? We don't have one,
      // so do a lightweight client-side YAML parse for syntax + rely on server PUT
      // for schema validation. The Save flow returns errors; for live feedback we
      // just do syntax-level checks here.
      const { default: yamlLib } = await import('js-yaml')
      try {
        yamlLib.load(yaml)
        setErrors([])
      } catch (err: any) {
        const line = err?.mark?.line !== undefined ? err.mark.line + 1 : undefined
        setErrors([{ message: err?.reason ?? err?.message ?? 'YAML syntax error', line, kind: 'syntax' }])
      }
    } finally {
      setValidating(false)
    }
  }, [])

  // Debounced syntax validation on every change.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => validate(content), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [content, validate])

  async function handleSave(acceptWarnings = false) {
    setSaving(true)
    setErrors([])
    setWarnings([])
    try {
      const url = `/api/firm/schemas/${schemaName}${acceptWarnings ? '?confirm_breaks=true' : ''}`
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml: content, editNote: editNote.trim() || null }),
      })
      const body = await res.json()
      if (res.status === 409 && body.warnings?.length > 0) {
        setWarnings(body.warnings)
        return
      }
      if (!res.ok || !body.ok) {
        setErrors(body.errors ?? [{ message: 'Save failed.', kind: 'schema' }])
        return
      }
      setSaved(true)
      setVersion(body.schema?.schema_version ?? version)
      setEditNote('')
      setTimeout(() => setSaved(false), 2000)
      router.refresh()
    } catch (err) {
      setErrors([{ message: err instanceof Error ? err.message : 'Network error', kind: 'schema' }])
    } finally {
      setSaving(false)
    }
  }

  async function loadHistory() {
    const res = await fetch(`/api/firm/schemas/${schemaName}/history`)
    if (res.ok) {
      const body = await res.json()
      setHistory(body.history ?? [])
    }
  }

  async function rollback(entry: HistoryEntry) {
    const ok = await confirm({
      title: `Rollback to ${entry.schema_version}?`,
      description: `This restores the YAML from ${new Date(entry.edited_at).toLocaleString()}. The current version stays in history.`,
      confirmLabel: 'Rollback',
      variant: 'destructive',
    })
    if (!ok) return
    const res = await fetch(`/api/firm/schemas/${schemaName}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId: entry.id }),
    })
    if (res.ok) {
      const body = await res.json()
      setContent(body.schema?.yaml_content ?? content)
      setVersion(body.schema?.schema_version ?? version)
      setShowHistory(false)
      setDiffAgainst(null)
      router.refresh()
    }
  }

  const monacoOptions = useMemo(() => ({
    minimap: { enabled: false },
    fontSize: 13,
    wordWrap: 'on' as const,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
  }), [])

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 max-w-6xl">
      <Link href="/settings/memo-agent/schemas" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> All schemas
      </Link>

      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{SCHEMA_LABELS[schemaName] ?? schemaName}</h1>
          <div className="text-xs text-muted-foreground mt-1 font-mono">{schemaName} · {version}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { if (!showHistory) loadHistory(); setShowHistory(s => !s); setDiffAgainst(null) }}
          >
            <Clock className="h-3.5 w-3.5 mr-1" /> History
          </Button>
        </div>
      </div>

      <div className={`grid gap-4 ${showHistory ? 'lg:grid-cols-[1fr_280px]' : ''}`}>
        <div>
          <div className="rounded-md border overflow-hidden bg-card">
            {diffAgainst ? (
              <MonacoDiffEditor
                height="60vh"
                language={language}
                original={diffAgainst.yaml_content}
                modified={content}
                options={{ ...monacoOptions, readOnly: true }}
              />
            ) : (
              <MonacoEditor
                height="60vh"
                language={language}
                value={content}
                onChange={v => setContent(v ?? '')}
                options={monacoOptions}
              />
            )}
          </div>

          {errors.length > 0 && (
            <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/5 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertCircle className="h-4 w-4" /> {errors.length} error{errors.length === 1 ? '' : 's'}
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {errors.map((e, i) => (
                  <li key={i} className="font-mono text-xs">
                    {e.line ? <span className="text-muted-foreground">L{e.line}: </span> : null}
                    {e.path ? <span className="text-muted-foreground">{e.path}: </span> : null}
                    {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-500/50 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" /> {warnings.length} cross-reference warning{warnings.length === 1 ? '' : 's'}
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {warnings.map((w, i) => <li key={i} className="text-xs">{w.message}</li>)}
              </ul>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setWarnings([])}>Cancel</Button>
                <Button size="sm" onClick={() => handleSave(true)}>Save anyway</Button>
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            <input
              value={editNote}
              onChange={e => setEditNote(e.target.value)}
              placeholder="Edit note (optional)"
              className="flex-1 h-9 px-3 rounded-md border border-input bg-transparent text-sm"
            />
            <Button onClick={() => handleSave(false)} disabled={saving || !dirty || errors.length > 0}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5 mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              {saved ? 'Saved' : 'Save'}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            {validating ? 'Checking syntax…' : errors.length === 0 ? (dirty ? 'Ready to save' : 'No changes') : ''}
          </p>
        </div>

        {showHistory && (
          <aside className="rounded-md border bg-card p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Versions</div>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : (
              <ul className="space-y-1">
                {history.map(h => (
                  <li key={h.id} className={`group rounded p-2 text-xs ${h.is_active ? 'bg-muted/50' : 'hover:bg-muted/30'}`}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono">{h.schema_version}</span>
                      {h.is_active && <span className="text-[9px] uppercase text-muted-foreground">active</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(h.edited_at).toLocaleString()}
                    </div>
                    {h.edit_note && <div className="text-[11px] text-muted-foreground italic mt-0.5">"{h.edit_note}"</div>}
                    <div className="flex gap-1 mt-1.5">
                      <button
                        onClick={() => setDiffAgainst(diffAgainst?.id === h.id ? null : h)}
                        className="text-[10px] underline text-muted-foreground hover:text-foreground"
                      >
                        {diffAgainst?.id === h.id ? 'Hide diff' : 'Diff'}
                      </button>
                      {!h.is_active && (
                        <button
                          onClick={() => rollback(h)}
                          className="text-[10px] underline text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                        >
                          <RotateCcw className="h-2.5 w-2.5" /> Rollback
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
