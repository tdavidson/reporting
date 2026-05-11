'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Trash2, Upload, FolderInput, Check, Play, RefreshCw, AlertCircle, Lock, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DiligenceNotesProvider, DiligenceNotesButton, DiligenceNotesPanel } from '@/components/diligence/diligence-notes'
import { useConfirm } from '@/components/confirm-dialog'
import { IngestionSummary } from '@/components/diligence/ingestion-summary'
import { ResearchSummary } from '@/components/diligence/research-summary'
import type { IngestionOutput } from '@/lib/memo-agent/stages/ingest'
import type { ResearchOutput } from '@/lib/memo-agent/stages/research'

interface Deal {
  id: string
  fund_id: string
  name: string
  sector: string | null
  stage_at_consideration: string | null
  deal_status: 'active' | 'passed' | 'won' | 'lost' | 'on_hold'
  current_memo_stage: string
  lead_partner_id: string | null
  promoted_company_id: string | null
  created_at: string
  updated_at: string
}

interface DiligenceDocument {
  id: string
  file_name: string
  file_format: string
  file_size_bytes: number | null
  detected_type: string | null
  type_confidence: string | null
  parse_status: string
  drive_source_url: string | null
  uploaded_at: string
}

type LatestDraft = {
  id: string
  draft_version: string
  agent_version: string
  is_draft: boolean
  created_at: string
  finalized_at: string | null
} | null

// Tabs follow the actual workflow: Decision is the partner-facing landing
// (recommendation, score, attention items, finalize/promote), then the pipeline
// goes Data Room → Diligence (external research) → Partner Q&A → Memo. Notes
// live in a right-side slide-in panel, mirroring the Companies notes UX.
const TABS = ['Decision', 'Data Room', 'Diligence', 'Partner Q&A', 'Memo'] as const
type Tab = typeof TABS[number]

const STATUS_LABEL: Record<Deal['deal_status'], { label: string; cls: string }> = {
  active:   { label: 'Active',   cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  passed:   { label: 'Passed',   cls: 'bg-muted text-muted-foreground' },
  won:      { label: 'Won',      cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  lost:     { label: 'Lost',     cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
  on_hold:  { label: 'On hold',  cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
}

const STATUS_OPTIONS = Object.keys(STATUS_LABEL) as Deal['deal_status'][]

export function DealDetail({ deal: initial, initialDocuments, latestDraft, isAdmin, currentUserId }: {
  deal: Deal
  initialDocuments: DiligenceDocument[]
  latestDraft: LatestDraft
  isAdmin: boolean
  currentUserId: string
}) {
  const router = useRouter()
  const [deal, setDeal] = useState(initial)
  const [activeTab, setActiveTab] = useState<Tab>('Decision')

  async function updateStatus(deal_status: Deal['deal_status']) {
    setDeal(d => ({ ...d, deal_status }))
    await fetch(`/api/diligence/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deal_status }),
    })
    router.refresh()
  }

  return (
    <DiligenceNotesProvider dealId={deal.id} userId={currentUserId} isAdmin={isAdmin}>
    <div className="p-4 md:py-8 md:pl-8 md:pr-4">
      <Link href="/diligence" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to diligence
      </Link>

      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight truncate">{deal.name}</h1>
          <div className="text-sm text-muted-foreground mt-1">
            {[
              deal.sector,
              deal.stage_at_consideration,
              `Created ${new Date(deal.created_at).toLocaleDateString()}`,
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <DiligenceNotesButton />
          <StatusDropdown value={deal.deal_status} onPick={updateStatus} />
        </div>
      </div>

      <div className="border-b mb-4">
        <nav className="flex gap-4 -mb-px">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`pb-2 px-1 text-sm border-b-2 ${activeTab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 max-w-5xl w-full">
          {activeTab === 'Decision' && (
            <DecisionTab deal={deal} documentCount={initialDocuments.length} latestDraft={latestDraft} isAdmin={isAdmin} onJumpToTab={setActiveTab} />
          )}
          {activeTab === 'Data Room' && (
            <DealRoomTab dealId={deal.id} initialDocuments={initialDocuments} />
          )}
          {activeTab === 'Diligence' && <AgentStageTab dealId={deal.id} stage="research" />}
          {activeTab === 'Partner Q&A' && <QATabLauncher dealId={deal.id} />}
          {activeTab === 'Memo' && <DraftsTab dealId={deal.id} />}
        </div>
        <DiligenceNotesPanel />
      </div>
    </div>
    </DiligenceNotesProvider>
  )
}

// ---------------------------------------------------------------------------
// Decision — partner landing. Surfaces "what's the recommendation?" first:
// memo agent progress, draft/score links, attention items, promote action.
// ---------------------------------------------------------------------------

function DecisionTab({ deal, documentCount, latestDraft, isAdmin, onJumpToTab }: {
  deal: Deal
  documentCount: number
  latestDraft: LatestDraft
  isAdmin: boolean
  onJumpToTab: (tab: Tab) => void
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [promoting, setPromoting] = useState(false)

  async function promote() {
    const ok = await confirm({
      title: 'Promote to portfolio',
      description: `Create a portfolio company from "${deal.name}" and link them. Status flips to "Won".`,
      confirmLabel: 'Promote',
    })
    if (!ok) return
    setPromoting(true)
    const res = await fetch(`/api/diligence/${deal.id}/promote`, { method: 'POST' })
    setPromoting(false)
    if (res.ok) router.refresh()
    else alert('Promote failed')
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <MemoAgentCard dealId={deal.id} latestDraft={latestDraft} onJumpToTab={onJumpToTab} />

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Details</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <Row k="Sector" v={deal.sector} />
          <Row k="Stage" v={deal.stage_at_consideration} />
          <Row k="Memo stage" v={deal.current_memo_stage.replace(/_/g, ' ')} />
          <Row k="Documents" v={String(documentCount)} />
        </CardContent>
      </Card>

      {isAdmin && deal.deal_status !== 'won' && !deal.promoted_company_id && (
        <Card className="md:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-base">Promote to portfolio</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <p className="text-muted-foreground mb-3">When you decide to invest, promote the deal — this creates a portfolio company linked to this record.</p>
            <Button onClick={promote} disabled={promoting} variant="outline" size="sm">
              {promoting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Promote to portfolio company
            </Button>
          </CardContent>
        </Card>
      )}

      {deal.promoted_company_id && (
        <Card className="md:col-span-2 border-green-500/30 bg-green-50/50 dark:bg-green-900/10">
          <CardContent className="py-3 text-sm">
            <Check className="h-4 w-4 text-green-600 inline mr-1" /> Promoted to portfolio.{' '}
            <Link href={`/companies/${deal.promoted_company_id}`} className="underline">View company →</Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v ?? '—'}</span>
    </div>
  )
}

function StatusDropdown({ value, onPick }: { value: Deal['deal_status']; onPick: (s: Deal['deal_status']) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center h-8 px-3 rounded-md text-xs font-medium hover:opacity-90 ${STATUS_LABEL[value].cls}`}
        >
          {STATUS_LABEL[value].label}
          <ChevronDown className="h-3.5 w-3.5 ml-1 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        {STATUS_OPTIONS.map(s => (
          <button
            key={s}
            onClick={() => { setOpen(false); onPick(s) }}
            className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${s === value ? 'bg-muted font-medium' : ''}`}
          >
            {STATUS_LABEL[s].label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Deal Room
// ---------------------------------------------------------------------------

const DOC_TYPE_OPTIONS = [
  { value: '', label: '— uncategorized —' },
  { value: 'pitch_deck', label: 'Pitch deck' },
  { value: 'financial_model', label: 'Financial model' },
  { value: 'cap_table', label: 'Cap table' },
  { value: 'data_room_summary', label: 'Data room summary' },
  { value: 'memo', label: 'Memo' },
  { value: 'product_overview', label: 'Product overview' },
  { value: 'customer_references', label: 'Customer references' },
  { value: 'legal', label: 'Legal' },
  { value: 'market_research', label: 'Market research' },
  { value: 'team_bio', label: 'Team bio' },
  { value: 'press', label: 'Press' },
  { value: 'other', label: 'Other' },
]

function DealRoomTab({ dealId, initialDocuments }: { dealId: string; initialDocuments: DiligenceDocument[] }) {
  const confirm = useConfirm()
  const [documents, setDocuments] = useState(initialDocuments)
  const [uploading, setUploading] = useState(false)
  const [driveOpen, setDriveOpen] = useState(false)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('file', file)
      try {
        const res = await fetch(`/api/diligence/${dealId}/documents`, {
          method: 'POST',
          body: formData,
        })
        if (res.ok) {
          const row: DiligenceDocument = await res.json()
          setDocuments(prev => [row, ...prev])
        }
      } catch {
        // continue with other files
      }
    }
    setUploading(false)
  }

  async function reclassify(id: string, detected_type: string) {
    setDocuments(prev => prev.map(d => d.id === id ? { ...d, detected_type: detected_type || null, type_confidence: 'high' } : d))
    await fetch(`/api/diligence/${dealId}/documents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ detected_type: detected_type || null }),
    })
  }

  async function setSkipped(id: string) {
    setDocuments(prev => prev.map(d => d.id === id ? { ...d, parse_status: 'skipped' } : d))
    await fetch(`/api/diligence/${dealId}/documents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parse_status: 'skipped' }),
    })
  }

  async function remove(id: string) {
    const ok = await confirm({
      title: 'Delete document?',
      description: 'This removes the file from storage. Cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return
    setDocuments(prev => prev.filter(d => d.id !== id))
    await fetch(`/api/diligence/${dealId}/documents/${id}`, { method: 'DELETE' })
  }

  return (
    <div className="space-y-6">
      <IngestionPanel dealId={dealId} documentCount={documents.length} />

      <div>
      <div className="flex items-center gap-2 mb-3">
        <label className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border bg-card text-sm hover:bg-muted/50 cursor-pointer">
          <Upload className="h-3.5 w-3.5" />
          {uploading ? 'Uploading…' : 'Upload files'}
          <input
            type="file"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={e => handleFiles(e.target.files)}
          />
        </label>
        <Button variant="outline" size="sm" onClick={() => setDriveOpen(true)}>
          <FolderInput className="h-3.5 w-3.5 mr-1" /> Import from Drive
        </Button>
      </div>

      {documents.length === 0 ? (
        <div className="rounded-md border bg-card p-12 text-center text-sm text-muted-foreground">
          No documents yet. Upload files or import a Drive folder to populate the deal room.
        </div>
      ) : (
        <div className="rounded-md border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {documents.map(d => (
                <tr key={d.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium truncate max-w-[280px]">{d.file_name}</div>
                    {d.drive_source_url && (
                      <a href={d.drive_source_url} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:underline">Drive source ↗</a>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={d.detected_type ?? ''}
                      onChange={e => reclassify(d.id, e.target.value)}
                      className="h-7 px-1.5 rounded border border-input bg-background text-xs"
                    >
                      {DOC_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {d.type_confidence && (
                      <span className="ml-1 text-[10px] text-muted-foreground">({d.type_confidence})</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {d.file_size_bytes ? `${(d.file_size_bytes / 1024 / 1024).toFixed(1)}MB` : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className="capitalize">{d.parse_status}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {d.parse_status !== 'skipped' && (
                      <button onClick={() => setSkipped(d.id)} className="text-[10px] text-muted-foreground hover:text-foreground mr-2">
                        Skip
                      </button>
                    )}
                    <button onClick={() => remove(d.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DriveImportDialog
        open={driveOpen}
        onOpenChange={setDriveOpen}
        dealId={dealId}
        onImported={imported => {
          // Refresh documents list — easier than appending each.
          fetch(`/api/diligence/${dealId}/documents`).then(r => r.ok ? r.json() : []).then(setDocuments)
        }}
      />
      </div>
    </div>
  )
}

function DriveImportDialog({ open, onOpenChange, dealId, onImported }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  dealId: string
  onImported: (count: number) => void
}) {
  const [folderUrl, setFolderUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!folderUrl.trim()) return
    setImporting(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/diligence/${dealId}/documents/from-drive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_url: folderUrl }),
      })
      const body = await res.json()
      if (!res.ok) {
        throw new Error(body.error ?? 'Import failed')
      }
      setResult({ imported: body.imported ?? 0, skipped: body.skipped ?? 0, errors: body.errors ?? [] })
      onImported(body.imported ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
      <div className="rounded-md border bg-card p-5 w-full max-w-lg">
        <h3 className="text-base font-semibold mb-2">Import from Drive folder</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Paste a Google Drive folder URL. Every file in the folder will be imported. Files already imported (matched by Drive ID) are skipped.
        </p>
        <Input
          value={folderUrl}
          onChange={e => setFolderUrl(e.target.value)}
          placeholder="https://drive.google.com/drive/folders/..."
          disabled={importing}
        />
        {error && <p className="text-sm text-destructive mt-2">{error}</p>}
        {result && (
          <div className="mt-3 text-sm">
            <p>Imported: <span className="font-medium">{result.imported}</span> · Skipped: <span className="font-medium">{result.skipped}</span></p>
            {result.errors.length > 0 && (
              <details className="mt-1 text-xs text-muted-foreground">
                <summary>{result.errors.length} error{result.errors.length === 1 ? '' : 's'}</summary>
                <ul className="mt-1 space-y-0.5">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </details>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={() => { onOpenChange(false); setFolderUrl(''); setResult(null); setError(null) }} disabled={importing}>
            Close
          </Button>
          <Button variant="outline" size="sm" onClick={submit} disabled={importing || !folderUrl.trim()}>
            {importing && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Import
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Placeholder
// ---------------------------------------------------------------------------

function PlaceholderTab({ phase }: { phase: string }) {
  return (
    <div className="rounded-md border bg-card p-12 text-center">
      <p className="text-sm text-muted-foreground">Coming in {phase}.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Memo Agent — status polling + stage panels
// ---------------------------------------------------------------------------

interface AgentStatus {
  deal: { current_memo_stage: string }
  latest_job: {
    id: string
    kind: 'ingest' | 'research' | 'qa' | 'draft' | 'render'
    status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
    progress_message: string | null
    error: string | null
    enqueued_at: string
    started_at: string | null
    finished_at: string | null
    result: any
  } | null
  latest_draft: {
    id: string
    draft_version: string
    has_ingestion: boolean
    has_research: boolean
    has_qa: boolean
    has_memo_draft: boolean
  } | null
}

function useAgentStatus(dealId: string) {
  const [status, setStatus] = useState<AgentStatus | null>(null)

  async function refresh() {
    try {
      const res = await fetch(`/api/diligence/${dealId}/agent/status`)
      if (res.ok) setStatus(await res.json())
    } catch { /* ignore */ }
  }

  useEffect(() => {
    refresh()
    // Poll every 5 seconds while a job is in flight; back off otherwise.
    const id = setInterval(() => {
      const j = status?.latest_job
      const inFlight = j && (j.status === 'pending' || j.status === 'running')
      if (inFlight) refresh()
    }, 5_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, status?.latest_job?.id, status?.latest_job?.status])

  return { status, refresh }
}

function IngestionPanel({ dealId, documentCount }: { dealId: string; documentCount: number }) {
  const { status, refresh } = useAgentStatus(dealId)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<any>(null)
  const [fileNamesById, setFileNamesById] = useState<Record<string, string>>({})

  // Refresh draft + file-name map whenever ingestion lands or the panel mounts.
  useEffect(() => {
    if (!status?.latest_draft?.has_ingestion) { setDraft(null); return }
    fetch(`/api/diligence/${dealId}/drafts`).then(r => r.ok ? r.json() : []).then(rows => {
      const latest = (rows ?? [])[0]
      setDraft(latest)
    }).catch(() => {})
    fetch(`/api/diligence/${dealId}/documents`).then(r => r.ok ? r.json() : []).then(docs => {
      const map: Record<string, string> = {}
      for (const d of docs ?? []) map[d.id] = d.file_name
      setFileNamesById(map)
    }).catch(() => {})
  }, [dealId, status?.latest_draft?.id, status?.latest_draft?.has_ingestion])

  const job = status?.latest_job
  const isInFlight = job && (job.status === 'pending' || job.status === 'running') && job.kind === 'ingest'

  async function runIngest() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/diligence/${dealId}/agent/ingest`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to enqueue ingest')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enqueue ingest')
    } finally {
      setSubmitting(false)
      await refresh()
    }
  }

  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-medium">Stage 1 — data-room ingestion</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Run the agent across uploaded documents to extract claims, classify each file, and surface gaps.
            Re-run after adding more files.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={runIngest} disabled={submitting || !!isInFlight || documentCount === 0}>
          {isInFlight || submitting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : status?.latest_draft?.has_ingestion ? <RefreshCw className="h-3.5 w-3.5 mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
          {status?.latest_draft?.has_ingestion ? 'Re-run' : 'Run ingestion'}
        </Button>
      </div>

      {documentCount === 0 && (
        <p className="text-xs text-muted-foreground italic">Upload at least one document to enable ingestion.</p>
      )}

      <JobStatusLine job={job ?? null} kind="ingest" error={error} />

      {draft?.ingestion_output && !isInFlight && (
        <div className="mt-4">
          <IngestionSummary output={draft.ingestion_output as IngestionOutput} fileNamesById={fileNamesById} />
        </div>
      )}
    </div>
  )
}

function AgentStageTab({ dealId, stage }: { dealId: string; stage: 'research' }) {
  const { status, refresh } = useAgentStatus(dealId)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<any>(null)

  useEffect(() => {
    if (!status?.latest_draft) { setDraft(null); return }
    fetch(`/api/diligence/${dealId}/drafts`).then(r => r.ok ? r.json() : []).then(rows => {
      setDraft((rows ?? [])[0])
    }).catch(() => {})
  }, [dealId, status?.latest_draft?.id, status?.latest_draft?.has_research])

  const job = status?.latest_job
  const isInFlight = job && (job.status === 'pending' || job.status === 'running') && job.kind === stage
  const ingestReady = !!status?.latest_draft?.has_ingestion

  async function run() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/diligence/${dealId}/agent/${stage}`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `Failed to enqueue ${stage}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to enqueue ${stage}`)
    } finally {
      setSubmitting(false)
      await refresh()
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Stage 2 — external research</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Verify or contradict company claims, surface unnamed competitors, build founder dossiers, list research gaps.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={run} disabled={submitting || !!isInFlight || !ingestReady}>
          {isInFlight || submitting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : status?.latest_draft?.has_research ? <RefreshCw className="h-3.5 w-3.5 mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
          {status?.latest_draft?.has_research ? 'Re-run' : 'Run research'}
        </Button>
      </div>

      {!ingestReady && (
        <div className="rounded-md border border-amber-500/40 bg-amber-50/50 dark:bg-amber-900/10 p-3 text-sm">
          <AlertCircle className="h-4 w-4 inline mr-1" />
          Run Stage 1 ingest first — research depends on the ingestion output.
        </div>
      )}

      <JobStatusLine job={job ?? null} kind={stage} error={error} />

      {draft?.research_output && !isInFlight && (
        <ResearchSummary output={draft.research_output as ResearchOutput} />
      )}
    </div>
  )
}

function JobStatusLine({ job, kind, error }: { job: AgentStatus['latest_job']; kind: string; error: string | null }) {
  if (error) {
    return (
      <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
        {error}
      </div>
    )
  }
  if (!job || job.kind !== kind) return null

  const pretty = (s: string | null) => s?.replace(/^[a-z]/, c => c.toUpperCase()) ?? ''

  if (job.status === 'pending' || job.status === 'running') {
    return (
      <div className="mt-3 rounded-md border bg-muted/30 p-2 text-xs flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>{job.status === 'pending' ? 'Queued — worker picks up within ~1 minute.' : (pretty(job.progress_message) || 'Running…')}</span>
      </div>
    )
  }
  if (job.status === 'failed') {
    return (
      <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
        <div className="font-medium text-destructive">Job failed.</div>
        {job.error && <div className="text-destructive opacity-80 mt-0.5">{job.error}</div>}
      </div>
    )
  }
  if (job.status === 'success') {
    return (
      <div className="mt-3 text-xs text-muted-foreground">
        <Check className="h-3 w-3 inline mr-1" /> Last {kind} run finished {job.finished_at ? new Date(job.finished_at).toLocaleString() : 'just now'}.
      </div>
    )
  }
  return null
}

// ---------------------------------------------------------------------------
// Memo Agent overview card — mirrors the Analyst card on Company detail
// ---------------------------------------------------------------------------

function MemoAgentCard({ dealId, latestDraft, onJumpToTab }: { dealId: string; latestDraft: LatestDraft; onJumpToTab?: (tab: Tab) => void }) {
  const { status } = useAgentStatus(dealId)
  const job = status?.latest_job
  const inFlight = job && (job.status === 'pending' || job.status === 'running')
  const ld: (NonNullable<AgentStatus['latest_draft']> & { finalized_at?: string | null }) | null =
    (status?.latest_draft ?? (latestDraft ? {
      id: latestDraft.id,
      draft_version: latestDraft.draft_version,
      has_ingestion: false,
      has_research: false,
      has_qa: false,
      has_memo_draft: false,
      finalized_at: latestDraft.finalized_at,
    } : null)) as any

  function chip(label: string, on: boolean) {
    return (
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${on ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
        {on ? <Check className="h-2.5 w-2.5" /> : null}
        {label}
      </span>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Memo Agent</CardTitle>
        {ld?.draft_version && <span className="text-[10px] font-mono text-muted-foreground">{ld.draft_version}</span>}
      </CardHeader>
      <CardContent className="text-sm space-y-3">
        {!ld ? (
          <p className="text-muted-foreground italic">No drafts yet. Run ingestion to start.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1">
              {chip('Ingest', ld.has_ingestion)}
              {chip('Research', ld.has_research)}
              {chip('Q&A', ld.has_qa)}
              {chip('Draft', ld.has_memo_draft)}
              {ld.finalized_at && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"><Lock className="h-2.5 w-2.5 inline mr-0.5" />Final</span>}
            </div>
            {inFlight && (
              <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {job!.kind} {job!.status}: {job!.progress_message ?? '…'}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {!ld.has_ingestion && onJumpToTab && (
                <button
                  type="button"
                  onClick={() => onJumpToTab('Data Room')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border bg-background text-xs hover:bg-muted/30"
                >
                  Run ingestion →
                </button>
              )}
              {ld.has_ingestion && !ld.has_research && onJumpToTab && (
                <button
                  type="button"
                  onClick={() => onJumpToTab('Diligence')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border bg-background text-xs hover:bg-muted/30"
                >
                  Run research →
                </button>
              )}
              {ld.has_ingestion && !ld.has_qa && onJumpToTab && (
                <button
                  type="button"
                  onClick={() => onJumpToTab('Partner Q&A')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border bg-background text-xs hover:bg-muted/30"
                >
                  Run Q&amp;A →
                </button>
              )}
              {ld.has_memo_draft ? (
                <Link
                  href={`/diligence/${dealId}/drafts/${ld.id}`}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border bg-background text-xs hover:bg-muted/30"
                >
                  Open memo editor
                </Link>
              ) : ld.has_ingestion && onJumpToTab ? (
                <button
                  type="button"
                  onClick={() => onJumpToTab('Memo')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border bg-background text-xs hover:bg-muted/30"
                >
                  Draft memo →
                </button>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Q&A tab launcher — points at /diligence/[id]/qa
// ---------------------------------------------------------------------------

function QATabLauncher({ dealId }: { dealId: string }) {
  const { status } = useAgentStatus(dealId)
  const ingestReady = !!status?.latest_draft?.has_ingestion
  const qaDone = !!status?.latest_draft?.has_qa

  return (
    <div className="rounded-md border bg-card p-6">
      <h3 className="text-sm font-medium mb-1">Stage 3 — Partner Q&amp;A</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-xl">
        The agent walks you through 4–6 questions per batch from your Q&amp;A library, applies skip logic against the data room and research, and records your answers.
      </p>
      {!ingestReady && (
        <div className="rounded-md border border-amber-500/40 bg-amber-50/50 dark:bg-amber-900/10 p-3 text-sm mb-4">
          <AlertCircle className="h-4 w-4 inline mr-1" />
          Run Stage 1 ingest before starting Q&amp;A.
        </div>
      )}
      <div className="flex items-center gap-2">
        <Link
          href={`/diligence/${dealId}/qa`}
          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm ${ingestReady ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-muted-foreground pointer-events-none'}`}
        >
          {qaDone ? 'Continue Q&A' : 'Start Q&A session'}
        </Link>
        {qaDone && (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Check className="h-3 w-3" /> Q&amp;A completed for the latest draft
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drafts tab — list + Run Draft button
// ---------------------------------------------------------------------------

interface DraftRow {
  id: string
  draft_version: string
  agent_version: string
  is_draft: boolean
  finalized_at: string | null
  created_at: string
  has_memo_draft?: boolean
  has_research?: boolean
  has_qa?: boolean
}

function DraftsTab({ dealId }: { dealId: string }) {
  const { status, refresh } = useAgentStatus(dealId)
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/diligence/${dealId}/drafts`).then(r => r.ok ? r.json() : []).then((rows: any[]) => {
      setDrafts(rows.map(r => ({
        id: r.id,
        draft_version: r.draft_version,
        agent_version: r.agent_version,
        is_draft: r.is_draft,
        finalized_at: r.finalized_at,
        created_at: r.created_at,
        has_memo_draft: !!r.memo_draft_output,
        has_research: !!r.research_output,
        has_qa: !!r.qa_answers,
      })))
    }).catch(() => {})
  }, [dealId, status?.latest_draft?.id])

  const job = status?.latest_job
  const isInFlight = job && (job.status === 'pending' || job.status === 'running') && job.kind === 'draft'

  async function runDraft() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/diligence/${dealId}/agent/draft`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to enqueue draft')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSubmitting(false)
      await refresh()
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Stage 4 + 5 — draft + score</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Assemble a structured memo from ingestion, research, and Q&amp;A; score every machine and hybrid rubric dimension; surface partner-attention items.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={runDraft} disabled={submitting || !!isInFlight}>
          {isInFlight || submitting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : drafts.some(d => d.has_memo_draft) ? <RefreshCw className="h-3.5 w-3.5 mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
          {drafts.some(d => d.has_memo_draft) ? 'Re-draft' : 'Run draft'}
        </Button>
      </div>

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

      <JobStatusLine job={job ?? null} kind="draft" error={null} />

      {drafts.length === 0 ? (
        <div className="rounded-md border bg-card p-12 text-center text-sm text-muted-foreground">
          No drafts yet. Run draft after Q&A.
        </div>
      ) : (
        <div className="rounded-md border bg-card divide-y">
          {drafts.map(d => (
            <div key={d.id} className="p-3 flex items-center justify-between gap-3 text-sm">
              <div>
                <div className="font-medium">
                  <span className="font-mono text-xs">{d.draft_version}</span>
                  {!d.is_draft && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">Final</span>}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {new Date(d.created_at).toLocaleString()}
                  {' · '}
                  {[
                    d.has_memo_draft && 'memo',
                    d.has_research && 'research',
                    d.has_qa && 'Q&A',
                  ].filter(Boolean).join(' · ') || 'no stages yet'}
                </div>
              </div>
              {d.has_memo_draft ? (
                <Link href={`/diligence/${dealId}/drafts/${d.id}`} className="text-xs underline text-muted-foreground hover:text-foreground">
                  Open
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
