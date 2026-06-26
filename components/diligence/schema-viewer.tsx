'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'

// ---------------------------------------------------------------------------
// Read-only viewer for the active memo-agent schemas/prompts (rubric, memo
// output, ingestion, research, etc.). Lets any member see what's configured in
// Settings without being able to change it — editing stays admin-only. Source
// is the member-open GET /api/firm/schemas (resolved fund override or default).
// ---------------------------------------------------------------------------
export function SchemaViewer({ schemaName, title, description }: { schemaName: string; title: string; description?: string }) {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || content !== null || loading) return
    setLoading(true)
    fetch('/api/firm/schemas')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then(b => {
        const s = b.schemas?.[schemaName]
        setContent(typeof s?.yaml_content === 'string' ? s.yaml_content : 'No content found for this schema.')
        setVersion(s?.schema_version ?? null)
      })
      .catch(() => setContent('Failed to load the schema.'))
      .finally(() => setLoading(false))
  }, [open, schemaName, content, loading])

  return (
    <div className="rounded-md border bg-card">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors">
        <span className="flex items-center gap-2 min-w-0">
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
          <span className="font-medium text-sm truncate">{title}</span>
          {version && <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">{version}</span>}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">Read-only</span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t">
          {description && <p className="text-xs text-muted-foreground mb-2">{description}</p>}
          {loading ? (
            <div className="text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 inline animate-spin mr-1" /> Loading…</div>
          ) : (
            <pre className="text-[11px] leading-relaxed bg-muted/40 rounded-md p-3 overflow-auto whitespace-pre-wrap max-h-[440px]">{content}</pre>
          )}
          <p className="text-[10px] text-muted-foreground mt-2">This is the active configuration from Settings → Memo agent. Changing it is admin-only.</p>
        </div>
      )}
    </div>
  )
}
