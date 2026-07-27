'use client'

import { useEffect, useState } from 'react'
import type { IngestionOutput } from '@/lib/memo-agent/stages/ingest'
import { Metric as Stat } from '@/components/ui/metric'

const CRIT_BADGE: Record<string, string> = {
  blocker: 'bg-destructive-subtle text-destructive dark:bg-destructive-subtle/40',
  important: 'bg-warning-subtle text-warning dark:bg-warning-subtle/40',
  nice_to_have: 'bg-muted text-muted-foreground',
  high: 'bg-destructive-subtle text-destructive dark:bg-destructive-subtle/40',
  material: 'bg-destructive-subtle text-destructive dark:bg-destructive-subtle/40',
  medium: 'bg-warning-subtle text-warning dark:bg-warning-subtle/40',
  minor: 'bg-warning-subtle text-warning dark:bg-warning-subtle/40',
  low: 'bg-muted text-muted-foreground',
}

// Rank for sorting the merged inconsistencies list so the most severe float up.
// Maps both the cross-doc scale (high/medium/low) and the contradiction scale
// (material/minor) onto a single ordering.
const SEV_RANK: Record<string, number> = { high: 0, material: 0, medium: 1, minor: 1, low: 2 }

function Crit({ level, children }: { level: string; children: React.ReactNode }) {
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${CRIT_BADGE[level] ?? CRIT_BADGE.medium}`}>{children}</span>
}

export function IngestionSummary({ output, fileNamesById, dealId, draftId, editable }: {
  output: IngestionOutput
  fileNamesById: Record<string, string>
  /** When dealId + draftId are set and editable is true, gap findings can be dismissed. */
  dealId?: string
  draftId?: string
  editable?: boolean
}) {
  const totalClaims = output.documents.reduce((acc, d) => acc + d.claims.length, 0)
  const canEdit = !!(editable && dealId && draftId)

  // Local copies so dismiss toggles are instant. Cross-document inconsistencies
  // moved to the Diligence tab's Internal diligence section (InconsistenciesList).
  const [gap, setGap] = useState(output.gap_analysis)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function setDismissed(kind: 'missing' | 'inadequate', index: number, dismissed: boolean) {
    const next = {
      ...gap,
      [kind]: gap[kind].map((g, i) => (i === index ? { ...g, dismissed } : g)),
    }
    setGap(next)
    setSaveError(null)
    try {
      const res = await fetch(`/api/diligence/${dealId}/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingestion_gap_analysis: next }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error ?? 'Save failed')
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
      setGap(gap)  // revert
    }
  }

  const activeMissing = gap.missing.filter(g => !g.dismissed).length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3 text-sm">
        <Stat label="Documents" value={output.documents.length} />
        <Stat label="Findings extracted" value={totalClaims} />
        <Stat label="Missing docs" value={activeMissing} />
      </div>

      {saveError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">{saveError}</div>
      )}

      {gap.missing.length > 0 && (
        <section>
          <h3 className="text-sm font-medium mb-2">
            Missing documents
            {canEdit && <span className="ml-2 text-xs font-normal text-muted-foreground">— dismiss anything the agent flagged wrongly</span>}
          </h3>
          <div className="rounded-md border bg-card divide-y">
            {gap.missing.map((g, i) => (
              <div key={i} className={`p-3 text-sm flex items-start gap-2 ${g.dismissed ? 'opacity-50' : ''}`}>
                <Crit level={g.criticality}>{g.criticality.replace(/_/g, ' ')}</Crit>
                <div className="flex-1 min-w-0">
                  <div className={`font-medium ${g.dismissed ? 'line-through' : ''}`}>{g.expected_type ?? 'Unknown'}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{g.rationale}</div>
                </div>
                {canEdit && (
                  <button
                    onClick={() => setDismissed('missing', i, !g.dismissed)}
                    className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {g.dismissed ? 'Restore' : 'Dismiss'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {gap.inadequate.length > 0 && (
        <section>
          <h3 className="text-sm font-medium mb-2">
            Inadequate documents
            {canEdit && <span className="ml-2 text-xs font-normal text-muted-foreground">— dismiss anything the agent flagged wrongly</span>}
          </h3>
          <div className="rounded-md border bg-card divide-y">
            {gap.inadequate.map((g, i) => (
              <div key={i} className={`p-3 text-sm flex items-start gap-2 ${g.dismissed ? 'opacity-50' : ''}`}>
                <Crit level={g.criticality}>{g.criticality.replace(/_/g, ' ')}</Crit>
                <div className="flex-1 min-w-0">
                  <div className={`font-medium ${g.dismissed ? 'line-through' : ''}`}>{g.document_id ? (fileNamesById[g.document_id] ?? g.document_id) : 'Unknown'}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{g.rationale}</div>
                </div>
                {canEdit && (
                  <button
                    onClick={() => setDismissed('inadequate', i, !g.dismissed)}
                    className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {g.dismissed ? 'Restore' : 'Dismiss'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-sm font-medium mb-2">Per-document extraction</h3>
        <div className="space-y-3">
          {output.documents.map(doc => (
            <div key={doc.document_id} className="rounded-md border bg-card">
              <div className="p-3 border-b">
                <div className="font-medium text-sm">{fileNamesById[doc.document_id] ?? doc.document_id}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {doc.detected_type} <span className="text-muted-foreground">· {doc.type_confidence} confidence · {doc.claims.length} finding{doc.claims.length === 1 ? '' : 's'}</span>
                </div>
                {doc.summary && <p className="text-sm mt-2">{doc.summary}</p>}
                {doc.issues && doc.issues.length > 0 && (
                  <ul className="text-xs text-warning mt-2 list-disc list-inside">
                    {doc.issues.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                )}
              </div>
              {doc.claims.length > 0 && (
                <details className="text-sm">
                  <summary className="px-3 py-2 cursor-pointer text-xs text-muted-foreground hover:bg-muted/30">
                    Show findings
                  </summary>
                  <div className="px-3 pb-3 space-y-1">
                    {doc.claims.map(c => (
                      <div key={c.id} className="flex items-start gap-2 text-xs">
                        <Crit level={c.criticality}>{c.criticality}</Crit>
                        <div className="min-w-0 flex-1">
                          <span className="font-medium">{c.field}</span>
                          <span className="ml-2">{c.value}</span>
                          {c.context && <div className="text-muted-foreground">{c.context}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

/**
 * Merged "Inconsistencies & contradictions" list for the Diligence tab's
 * Internal diligence section. Combines research-stage contradictions (read-only)
 * with ingestion-stage cross-document inconsistencies (re-rate / dismiss, persisted
 * to the draft's ingestion_output). Sorted by severity so the most material float up.
 */
export function InconsistenciesList({ contradictions, crossDocFlags, fileNamesById, dealId, draftId, editable }: {
  contradictions: Array<{ topic: string; description: string; severity: 'material' | 'minor' }>
  crossDocFlags: IngestionOutput['cross_doc_flags']
  fileNamesById: Record<string, string>
  /** When dealId + draftId are set and editable is true, cross-doc flags can be re-rated / dismissed. */
  dealId?: string
  draftId?: string
  editable?: boolean
}) {
  const canEdit = !!(editable && dealId && draftId)
  // Local copy so re-rate / dismiss toggles are instant; resync when new
  // ingestion output arrives (e.g. after a re-analyze).
  const [flags, setFlags] = useState(crossDocFlags)
  useEffect(() => { setFlags(crossDocFlags) }, [crossDocFlags])
  const [saveError, setSaveError] = useState<string | null>(null)

  async function setCrossFlag(index: number, patch: Partial<{ severity: 'high' | 'medium' | 'low'; dismissed: boolean }>) {
    const next = flags.map((f, i) => (i === index ? { ...f, ...patch } : f))
    setFlags(next)
    setSaveError(null)
    try {
      const res = await fetch(`/api/diligence/${dealId}/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingestion_cross_doc_flags: next }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error ?? 'Save failed')
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
      setFlags(flags) // revert
    }
  }

  // Unified rows: contradictions are read-only; flags carry their index back
  // into `flags` so the edit handlers target the right entry.
  type Row =
    | { kind: 'contradiction'; sev: string; topic: string; description: string }
    | { kind: 'flag'; idx: number; sev: 'high' | 'medium' | 'low'; description: string; doc_ids: string[]; dismissed: boolean }
  const rows: Row[] = [
    ...contradictions.map(c => ({ kind: 'contradiction' as const, sev: c.severity, topic: c.topic, description: c.description })),
    ...flags.map((f, idx) => ({ kind: 'flag' as const, idx, sev: f.severity ?? 'medium', description: f.description, doc_ids: f.doc_ids, dismissed: !!f.dismissed })),
  ].sort((a, b) => (SEV_RANK[a.sev] ?? 1) - (SEV_RANK[b.sev] ?? 1))

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No contradictions or cross-document inconsistencies found.</p>
  }

  return (
    <div>
      {saveError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 mb-2 text-xs text-destructive">{saveError}</div>
      )}
      <div className="rounded-md border bg-card divide-y">
        {rows.map((r, i) => (
          r.kind === 'contradiction' ? (
            <div key={`c-${i}`} className="p-3 text-sm flex items-start gap-2">
              <Crit level={r.sev}>{r.sev}</Crit>
              <div className="flex-1 min-w-0">
                <div className="font-medium">{r.topic}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{r.description}</div>
              </div>
            </div>
          ) : (
            <div key={`f-${i}`} className={`p-3 text-sm flex items-start gap-2 ${r.dismissed ? 'opacity-50' : ''}`}>
              {canEdit ? (
                <select
                  value={r.sev}
                  onChange={e => setCrossFlag(r.idx, { severity: e.target.value as 'high' | 'medium' | 'low' })}
                  className={`shrink-0 cursor-pointer rounded px-1 py-0.5 text-[10px] font-medium border-0 outline-none ${CRIT_BADGE[r.sev] ?? CRIT_BADGE.medium}`}
                  title="Severity"
                >
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                </select>
              ) : (
                <Crit level={r.sev}>{r.sev}</Crit>
              )}
              <div className="flex-1 min-w-0">
                <div className={r.dismissed ? 'line-through' : ''}>{r.description}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Across: {r.doc_ids.map(id => fileNamesById[id] ?? id).join(', ')}
                </div>
              </div>
              {canEdit && (
                <button
                  onClick={() => setCrossFlag(r.idx, { dismissed: !r.dismissed })}
                  className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {r.dismissed ? 'Restore' : 'Dismiss'}
                </button>
              )}
            </div>
          )
        ))}
      </div>
    </div>
  )
}
