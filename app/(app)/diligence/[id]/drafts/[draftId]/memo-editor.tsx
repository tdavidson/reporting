'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, FileDown, FileText, ExternalLink, Lock, AlertTriangle, AlertCircle, ChevronRight, Save, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/confirm-dialog'

interface Paragraph {
  id: string
  section_id: string
  order: number
  prose: string
  sources: Array<{ source_type: string; source_id: string; span?: string | null }>
  origin: 'agent_drafted' | 'partner_drafted' | 'partner_only_placeholder' | 'partner_edited'
  confidence: 'low' | 'medium' | 'high' | 'n/a'
  contains_projection: boolean
  contains_unverified_claim: boolean
  contains_contradiction: boolean
  hidden?: boolean
}

interface DimensionScore {
  dimension_id: string
  mode: 'machine' | 'hybrid' | 'partner_only'
  score: number | null
  confidence: 'low' | 'medium' | 'high' | null
  rationale: string
}

interface MemoOutput {
  header?: Record<string, any>
  paragraphs: Paragraph[]
  partner_attention?: any[]
  scores?: DimensionScore[]
}

interface Draft {
  id: string
  draft_version: string
  agent_version: string
  is_draft: boolean
  finalized_at: string | null
  finalized_by: string | null
  created_at: string
  memo_draft_output: MemoOutput | null
}

interface AttentionItem {
  id: string
  draft_id: string | null
  kind: string
  urgency: 'must_address' | 'should_address' | 'fyi'
  body: string
  links: Array<{ source_type: string; source_id: string }> | null
  status: 'open' | 'ignore' | 'done'
  created_at: string
}

const SECTION_ORDER: Array<{ id: string; title: string }> = [
  { id: 'executive_summary', title: 'Executive Summary' },
  { id: 'recommendation', title: 'Recommendation' },
  { id: 'company_overview', title: 'Company Overview' },
  { id: 'market', title: 'Market' },
  { id: 'team', title: 'Team' },
  { id: 'product_technology', title: 'Product & Technology' },
  { id: 'traction', title: 'Traction & Evidence' },
  { id: 'business_model', title: 'Business Model & Financials' },
  { id: 'competition_moat', title: 'Competition & Moat' },
  { id: 'deal_terms', title: 'Deal & Terms' },
  { id: 'risks_and_open_questions', title: 'Risks & Open Questions' },
]

const URGENCY_BADGE: Record<string, string> = {
  must_address: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  should_address: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  fyi: 'bg-muted text-muted-foreground',
}

export function MemoEditor({ dealId, dealName, draft: initial, initialAttention, isAdmin, embedded }: {
  dealId: string
  dealName: string
  draft: Draft
  initialAttention: AttentionItem[]
  isAdmin: boolean
  /** When true, drop the page wrapper + back link so this can render inside the
   *  deal-detail Memo tab without extra chrome. */
  embedded?: boolean
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [draft, setDraft] = useState(initial)
  const [attention, setAttention] = useState(initialAttention)
  const [selected, setSelected] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [proseDraft, setProseDraft] = useState<string>('')
  const [showAttention, setShowAttention] = useState(true)
  const [savingPara, setSavingPara] = useState(false)
  const [exporting, setExporting] = useState<null | 'docx' | 'gdoc'>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportResult, setExportResult] = useState<null | { url: string | null; format: string }>(null)

  const memo = draft.memo_draft_output ?? { paragraphs: [], scores: [] }
  const isReadOnly = !draft.is_draft

  const paragraphsBySection = useMemo(() => {
    const map = new Map<string, Paragraph[]>()
    for (const p of memo.paragraphs ?? []) {
      if (!map.has(p.section_id)) map.set(p.section_id, [])
      map.get(p.section_id)!.push(p)
    }
    return map
  }, [memo.paragraphs])

  const selectedPara = useMemo(() => (memo.paragraphs ?? []).find(p => p.id === selected) ?? null, [memo.paragraphs, selected])

  // Initialize editing draft when selecting a paragraph.
  useEffect(() => {
    if (selectedPara) setProseDraft(selectedPara.prose)
  }, [selectedPara?.id])

  async function saveParagraph() {
    if (!selectedPara) return
    setSavingPara(true)
    setError(null)
    try {
      const res = await fetch(`/api/diligence/${dealId}/drafts/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paragraph_edits: [{ id: selectedPara.id, prose: proseDraft }] }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Save failed')
      }
      setDraft(prev => ({
        ...prev,
        memo_draft_output: prev.memo_draft_output ? {
          ...prev.memo_draft_output,
          paragraphs: prev.memo_draft_output.paragraphs.map(p =>
            p.id === selectedPara.id ? { ...p, prose: proseDraft, origin: 'partner_edited' as const } : p),
        } : prev.memo_draft_output,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingPara(false)
    }
  }

  // Apply a draft mutation via PATCH and re-sync local state from the
  // returned memo_draft_output (the server is authoritative — needed for
  // inserts, whose ids are server-generated).
  async function patchDraft(body: Record<string, unknown>): Promise<MemoOutput | null> {
    setError(null)
    try {
      const res = await fetch(`/api/diligence/${dealId}/drafts/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Update failed')
      if (data.memo_draft_output) {
        setDraft(prev => ({ ...prev, memo_draft_output: data.memo_draft_output }))
        return data.memo_draft_output as MemoOutput
      }
      return null
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
      return null
    }
  }

  // Move a paragraph up/down within its section. Orders are renormalized to
  // 0,1,2,… for the whole section so they stay clean.
  async function moveParagraph(id: string, dir: 'up' | 'down') {
    const para = (memo.paragraphs ?? []).find(p => p.id === id)
    if (!para) return
    const inSection = (memo.paragraphs ?? [])
      .filter(p => p.section_id === para.section_id)
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const idx = inSection.findIndex(p => p.id === id)
    const swapWith = dir === 'up' ? idx - 1 : idx + 1
    if (swapWith < 0 || swapWith >= inSection.length) return
    const reordered = inSection.slice()
    ;[reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]]
    await patchDraft({
      paragraph_order: reordered.map((p, i) => ({ id: p.id, section_id: p.section_id, order: i })),
    })
  }

  // Drag-and-drop reorder within a section. Paragraphs cannot cross sections,
  // mirroring moveParagraph — drops onto a different section are ignored.
  async function dropParagraphOnto(dragId: string, targetId: string) {
    if (dragId === targetId) return
    const all = memo.paragraphs ?? []
    const dragPara = all.find(p => p.id === dragId)
    const targetPara = all.find(p => p.id === targetId)
    if (!dragPara || !targetPara || dragPara.section_id !== targetPara.section_id) return
    const inSection = all
      .filter(p => p.section_id === dragPara.section_id)
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const from = inSection.findIndex(p => p.id === dragId)
    const to = inSection.findIndex(p => p.id === targetId)
    if (from === -1 || to === -1) return
    const [moved] = inSection.splice(from, 1)
    inSection.splice(to, 0, moved)
    await patchDraft({
      paragraph_order: inSection.map((p, i) => ({ id: p.id, section_id: p.section_id, order: i })),
    })
  }

  async function toggleHidden(id: string) {
    const para = (memo.paragraphs ?? []).find(p => p.id === id)
    if (!para) return
    await patchDraft({ paragraph_visibility: [{ id, hidden: !para.hidden }] })
  }

  async function insertParagraph(sectionId: string) {
    const inSection = (memo.paragraphs ?? []).filter(p => p.section_id === sectionId)
    const nextOrder = inSection.reduce((max, p) => Math.max(max, p.order ?? 0), -1) + 1
    const updated = await patchDraft({
      paragraph_inserts: [{ section_id: sectionId, order: nextOrder, prose: 'New paragraph — write your content here.' }],
    })
    if (updated) {
      // Select the newest partner-drafted paragraph in this section for editing.
      const fresh = updated.paragraphs
        .filter(p => p.section_id === sectionId && p.origin === 'partner_drafted')
        .sort((a, b) => (b.order ?? 0) - (a.order ?? 0))[0]
      if (fresh) setSelected(fresh.id)
    }
  }

  async function exportTo(format: 'docx' | 'gdoc') {
    setExporting(format)
    setError(null)
    setExportResult(null)
    try {
      const res = await fetch(`/api/diligence/${dealId}/agent/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, draft_id: draft.id }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Render failed')
      setExportResult({
        format,
        url: body.download_url ?? body.web_view_link ?? null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Render failed')
    } finally {
      setExporting(null)
    }
  }

  async function finalize() {
    const ok = await confirm({
      title: 'Mark as final?',
      description: 'Finalizing locks the draft. Edits after this require running a new draft. The recommendation section must be filled in.',
      confirmLabel: 'Finalize',
    })
    if (!ok) return
    setFinalizing(true)
    setError(null)
    try {
      const res = await fetch(`/api/diligence/${dealId}/drafts/${draft.id}/finalize`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Finalize failed')
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Finalize failed')
    } finally {
      setFinalizing(false)
    }
  }

  async function updateAttentionStatus(itemId: string, status: 'open' | 'ignore' | 'done') {
    setAttention(prev => prev.map(a => a.id === itemId ? { ...a, status } : a))
    await fetch(`/api/diligence/${dealId}/attention/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
  }

  const openAttention = attention.filter(a => a.status === 'open')

  return (
    <div className={embedded ? '' : 'p-4 md:py-8 md:pl-8 md:pr-4 max-w-[1400px]'}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          {!embedded && (
            <Link href={`/diligence/${dealId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to deal
            </Link>
          )}
          <h1 className={`${embedded ? 'text-base' : 'text-xl'} font-semibold tracking-tight truncate flex items-center gap-2`}>
            {embedded ? 'Memo draft' : `${dealName} memo`}
            {!draft.is_draft && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                <Lock className="h-3 w-3 inline mr-0.5" /> Final
              </span>
            )}
          </h1>
          <div className="text-xs text-muted-foreground mt-0.5 font-mono">{draft.draft_version} · {draft.agent_version}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setShowAttention(s => !s)}>
            <AlertTriangle className="h-3.5 w-3.5 mr-1" />
            Attention {openAttention.length > 0 && <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">{openAttention.length}</span>}
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportTo('docx')} disabled={exporting !== null}>
            {exporting === 'docx' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <FileDown className="h-3.5 w-3.5 mr-1" />}
            Word Doc
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportTo('gdoc')} disabled={exporting !== null}>
            {exporting === 'gdoc' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <FileText className="h-3.5 w-3.5 mr-1" />}
            Google Doc
          </Button>
          {isAdmin && draft.is_draft && (
            <Button variant="outline" size="sm" onClick={finalize} disabled={finalizing}>
              {finalizing && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Mark as final
            </Button>
          )}
        </div>
      </div>

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive mb-4">{error}</div>}
      {exportResult?.url && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-900/10 p-3 text-sm mb-4 flex items-center justify-between gap-2">
          <span>Export ready ({exportResult.format})</span>
          <a href={exportResult.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
            Open <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div>
          {SECTION_ORDER.map(section => {
            const paragraphs = (paragraphsBySection.get(section.id) ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            if (paragraphs.length === 0 && section.id !== 'recommendation') return null
            return (
              <section key={section.id} className="mb-6" id={`sec-${section.id}`}>
                <h2 className="text-base font-semibold tracking-tight mb-2">{section.title}</h2>
                {paragraphs.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">[No content yet for this section.]</p>
                ) : (
                  paragraphs.map((p, i) => (
                    <div
                      key={p.id}
                      onDragOver={dragId && dragId !== p.id ? (e) => { e.preventDefault(); if (overId !== p.id) setOverId(p.id) } : undefined}
                      onDrop={dragId ? (e) => { e.preventDefault(); const d = dragId; setDragId(null); setOverId(null); if (d) dropParagraphOnto(d, p.id) } : undefined}
                      className={dragId && dragId !== p.id && overId === p.id ? 'border-t-2 border-primary' : ''}
                    >
                      <ParagraphView
                        paragraph={p}
                        isSelected={selected === p.id}
                        onSelect={() => setSelected(p.id)}
                        readOnly={isReadOnly}
                        canMoveUp={i > 0}
                        canMoveDown={i < paragraphs.length - 1}
                        onMoveUp={() => moveParagraph(p.id, 'up')}
                        onMoveDown={() => moveParagraph(p.id, 'down')}
                        onToggleHidden={() => toggleHidden(p.id)}
                        dragHandle={!isReadOnly ? (
                          <span
                            draggable
                            onClick={e => e.stopPropagation()}
                            onDragStart={(e) => { e.stopPropagation(); setDragId(p.id); e.dataTransfer.effectAllowed = 'move' }}
                            onDragEnd={() => { setDragId(null); setOverId(null) }}
                            className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-foreground"
                            title="Drag to reorder"
                            aria-label="Drag to reorder"
                          >
                            <GripVertical className="h-3.5 w-3.5" />
                          </span>
                        ) : null}
                      />
                    </div>
                  ))
                )}
                {!isReadOnly && (
                  <button
                    onClick={() => insertParagraph(section.id)}
                    className="text-xs text-muted-foreground hover:text-foreground mt-1"
                  >
                    + Add paragraph
                  </button>
                )}
              </section>
            )
          })}

          {/* Scoring summary inline */}
          {memo.scores && memo.scores.length > 0 && (
            <section className="mb-6">
              <h2 className="text-base font-semibold tracking-tight mb-2">Scoring Summary</h2>
              <div className="rounded-md border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Dimension</th>
                      <th className="px-3 py-2 text-left font-medium">Mode</th>
                      <th className="px-3 py-2 text-left font-medium">Score</th>
                      <th className="px-3 py-2 text-left font-medium">Confidence</th>
                      <th className="px-3 py-2 text-left font-medium">Rationale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memo.scores.map(s => (
                      <tr key={s.dimension_id} className="border-t align-top">
                        <td className="px-3 py-2 font-medium">{s.dimension_id}</td>
                        <td className="px-3 py-2 text-xs">{s.mode}</td>
                        <td className="px-3 py-2">
                          {s.score === null ? (s.mode === 'partner_only' ? <span className="italic text-muted-foreground">[partner]</span> : '—') : <span className="font-medium">{s.score}</span>}
                        </td>
                        <td className="px-3 py-2 text-xs">{s.confidence ?? '—'}</td>
                        <td className="px-3 py-2 text-xs">{s.rationale}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          {selectedPara ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Paragraph inspector</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-mono text-muted-foreground">{selectedPara.id}</span>
                  <Badge>{selectedPara.origin}</Badge>
                  <Badge>{selectedPara.confidence}</Badge>
                  {selectedPara.contains_projection && <Badge tone="amber">projection</Badge>}
                  {selectedPara.contains_unverified_claim && <Badge tone="amber">unverified</Badge>}
                  {selectedPara.contains_contradiction && <Badge tone="red">contradiction</Badge>}
                </div>
                {!isReadOnly && selectedPara.origin !== 'partner_only_placeholder' && (
                  <>
                    <textarea
                      value={proseDraft}
                      onChange={e => setProseDraft(e.target.value)}
                      rows={6}
                      className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <Button variant="outline" size="sm" onClick={saveParagraph} disabled={savingPara || proseDraft === selectedPara.prose}>
                      {savingPara ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                      Save edit
                    </Button>
                  </>
                )}
                {selectedPara.origin === 'partner_only_placeholder' && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-50/50 dark:bg-amber-900/10 p-2 text-xs">
                    Partner-only section. Edit the prose above (set to a partner-drafted state) before finalizing.
                  </div>
                )}
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Sources</div>
                  {selectedPara.sources.length === 0 ? (
                    <p className="text-xs italic text-muted-foreground">None.</p>
                  ) : (
                    <ul className="text-xs space-y-1">
                      {selectedPara.sources.map((s, i) => (
                        <li key={i}>
                          <span className="font-mono">{s.source_type}</span>: <span className="font-mono">{s.source_id}</span>
                          {s.span && <span className="text-muted-foreground"> · "{s.span}"</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground">
                Click a paragraph to inspect or edit it.
              </CardContent>
            </Card>
          )}

          {showAttention && (
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-base">Partner attention</CardTitle>
                <span className="text-xs text-muted-foreground">{openAttention.length} open</span>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {attention.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No items.</p>
                ) : attention.map(item => (
                  <div key={item.id} className="rounded-md border bg-background p-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <span className={`shrink-0 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${URGENCY_BADGE[item.urgency] ?? ''}`}>
                        {item.urgency.replace(/_/g, ' ')}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{item.kind.replace(/_/g, ' ')}</div>
                        <div className="text-[11px] mt-0.5">{item.body}</div>
                      </div>
                    </div>
                    {item.status === 'open' && (
                      <div className="flex gap-1 mt-2">
                        <button onClick={() => updateAttentionStatus(item.id, 'done')} className="text-[10px] underline text-muted-foreground hover:text-foreground">Done</button>
                        <button onClick={() => updateAttentionStatus(item.id, 'ignore')} className="text-[10px] underline text-muted-foreground hover:text-foreground">Ignore</button>
                      </div>
                    )}
                    {item.status !== 'open' && (
                      <button onClick={() => updateAttentionStatus(item.id, 'open')} className="text-[10px] underline text-muted-foreground hover:text-foreground mt-2">
                        Reopen ({item.status})
                      </button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  )
}

function ParagraphView({
  paragraph, isSelected, onSelect, readOnly, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onToggleHidden, dragHandle,
}: {
  paragraph: Paragraph
  isSelected: boolean
  onSelect: () => void
  readOnly: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onToggleHidden: () => void
  dragHandle?: React.ReactNode
}) {
  const isPlaceholder = paragraph.origin === 'partner_only_placeholder'
  const stop = (e: React.MouseEvent, fn: () => void) => { e.stopPropagation(); fn() }
  return (
    <div
      onClick={onSelect}
      className={`group rounded-md p-3 mb-2 cursor-pointer transition-colors text-sm ${isSelected ? 'bg-muted ring-1 ring-primary/30' : 'hover:bg-muted/30'} ${paragraph.hidden ? 'opacity-50' : ''}`}
    >
      <p className={isPlaceholder ? 'italic text-muted-foreground' : ''}>
        {paragraph.prose}
        {!paragraph.hidden && paragraph.sources.filter(s => s.source_type !== 'partner_only').length > 0 && (
          <sup className="ml-1 text-[10px] text-muted-foreground">
            {paragraph.sources.filter(s => s.source_type !== 'partner_only').slice(0, 5).map((_, i) => `[${i + 1}]`).join('')}
          </sup>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {dragHandle}
        <Badge tone="muted">{paragraph.origin.replace(/_/g, ' ')}</Badge>
        {paragraph.hidden && <Badge tone="amber">hidden — excluded from export</Badge>}
        {paragraph.contains_projection && <Badge tone="amber">projection</Badge>}
        {paragraph.contains_unverified_claim && <Badge tone="amber">⚠ unverified</Badge>}
        {paragraph.contains_contradiction && <Badge tone="red">contradiction</Badge>}
        {!readOnly && (
          <span className="ml-auto flex items-center gap-2">
            <button
              onClick={e => stop(e, onMoveUp)}
              disabled={!canMoveUp}
              className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30"
              title="Move up"
            >↑</button>
            <button
              onClick={e => stop(e, onMoveDown)}
              disabled={!canMoveDown}
              className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30"
              title="Move down"
            >↓</button>
            <button
              onClick={e => stop(e, onToggleHidden)}
              className="text-[11px] text-muted-foreground hover:text-foreground"
              title={paragraph.hidden ? 'Show in export' : 'Hide from export'}
            >{paragraph.hidden ? 'Show' : 'Hide'}</button>
          </span>
        )}
      </div>
    </div>
  )
}

function Badge({ tone = 'muted', children }: { tone?: 'muted' | 'amber' | 'red'; children: React.ReactNode }) {
  const cls = tone === 'red'
    ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
    : tone === 'amber'
      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
      : 'bg-muted text-muted-foreground'
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>{children}</span>
}
