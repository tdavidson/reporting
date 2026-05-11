'use client'

import type { IngestionOutput } from '@/lib/memo-agent/stages/ingest'

const CRIT_BADGE: Record<string, string> = {
  blocker: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  important: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  nice_to_have: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  high: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  low: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
}

function Crit({ level, children }: { level: string; children: React.ReactNode }) {
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${CRIT_BADGE[level] ?? CRIT_BADGE.medium}`}>{children}</span>
}

export function IngestionSummary({ output, fileNamesById }: {
  output: IngestionOutput
  fileNamesById: Record<string, string>
}) {
  const totalClaims = output.documents.reduce((acc, d) => acc + d.claims.length, 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Stat label="Documents" value={output.documents.length} />
        <Stat label="Claims extracted" value={totalClaims} />
        <Stat label="Missing docs" value={output.gap_analysis.missing.length} />
        <Stat label="Cross-doc flags" value={output.cross_doc_flags.length} />
      </div>

      {output.gap_analysis.missing.length > 0 && (
        <section>
          <h3 className="text-sm font-medium mb-2">Missing documents</h3>
          <div className="rounded-md border bg-card divide-y">
            {output.gap_analysis.missing.map((g, i) => (
              <div key={i} className="p-3 text-sm flex items-start gap-2">
                <Crit level={g.criticality}>{g.criticality.replace(/_/g, ' ')}</Crit>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{g.expected_type ?? 'Unknown'}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{g.rationale}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {output.gap_analysis.inadequate.length > 0 && (
        <section>
          <h3 className="text-sm font-medium mb-2">Inadequate documents</h3>
          <div className="rounded-md border bg-card divide-y">
            {output.gap_analysis.inadequate.map((g, i) => (
              <div key={i} className="p-3 text-sm flex items-start gap-2">
                <Crit level={g.criticality}>{g.criticality.replace(/_/g, ' ')}</Crit>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{g.document_id ? (fileNamesById[g.document_id] ?? g.document_id) : 'Unknown'}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{g.rationale}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {output.cross_doc_flags.length > 0 && (
        <section>
          <h3 className="text-sm font-medium mb-2">Cross-document inconsistencies</h3>
          <div className="rounded-md border bg-card divide-y">
            {output.cross_doc_flags.map((f, i) => (
              <div key={i} className="p-3 text-sm">
                <div>{f.description}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Across: {f.doc_ids.map(id => fileNamesById[id] ?? id).join(', ')}
                </div>
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
                  {doc.detected_type} <span className="text-muted-foreground">· {doc.type_confidence} confidence · {doc.claims.length} claim{doc.claims.length === 1 ? '' : 's'}</span>
                </div>
                {doc.summary && <p className="text-sm mt-2">{doc.summary}</p>}
                {doc.issues && doc.issues.length > 0 && (
                  <ul className="text-xs text-amber-600 mt-2 list-disc list-inside">
                    {doc.issues.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                )}
              </div>
              {doc.claims.length > 0 && (
                <details className="text-sm">
                  <summary className="px-3 py-2 cursor-pointer text-xs text-muted-foreground hover:bg-muted/30">
                    Show claims
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  )
}
