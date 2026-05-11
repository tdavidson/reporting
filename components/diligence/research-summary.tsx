'use client'

import type { ResearchOutput } from '@/lib/memo-agent/stages/research'

const VERIFY_BADGE: Record<string, { label: string; cls: string }> = {
  verified: { label: 'Verified', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' },
  contradicted: { label: 'Contradicted', cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' },
  company_stated: { label: 'Company-stated', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200' },
  inconclusive: { label: 'Inconclusive', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
}

const CRIT_BADGE: Record<string, string> = {
  blocker: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  important: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  nice_to_have: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
}

const SEVERITY_BADGE: Record<string, string> = {
  material: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  minor: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
}

const TIER_LABEL: Record<string, string> = {
  tier_1: 'Tier 1',
  tier_2: 'Tier 2',
  tier_3: 'Tier 3',
}

export function ResearchSummary({ output }: { output: ResearchOutput }) {
  const verifiedCount = output.findings.filter(f => f.verification_status === 'verified').length
  const contradictedCount = output.findings.filter(f => f.verification_status === 'contradicted').length

  return (
    <div className="space-y-6">
      {output.research_mode === 'no_web_search' && (
        <div className="rounded-md border border-amber-500/40 bg-amber-50/50 dark:bg-amber-900/10 p-3 text-sm">
          <div className="font-medium">External web search disabled</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            The agent verified what it could from its training data and the deal materials, and surfaced the rest as research gaps.
            Web-search-enabled providers ship in a follow-up release.
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Stat label="Findings" value={output.findings.length} />
        <Stat label="Verified" value={verifiedCount} />
        <Stat label="Contradicted" value={contradictedCount} />
        <Stat label="Research gaps" value={output.research_gaps.length} />
      </div>

      {output.contradictions.length > 0 && (
        <section>
          <h3 className="text-sm font-medium mb-2">Contradictions</h3>
          <div className="rounded-md border bg-card divide-y">
            {output.contradictions.map((c, i) => (
              <div key={i} className="p-3 text-sm">
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${SEVERITY_BADGE[c.severity] ?? ''}`}>
                    {c.severity}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{c.topic}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{c.description}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-sm font-medium mb-2">Findings</h3>
        {output.findings.length === 0 ? (
          <p className="text-xs text-muted-foreground">No findings recorded.</p>
        ) : (
          <div className="rounded-md border bg-card divide-y">
            {output.findings.map(f => (
              <div key={f.id} className="p-3 text-sm">
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${VERIFY_BADGE[f.verification_status]?.cls ?? ''}`}>
                    {VERIFY_BADGE[f.verification_status]?.label ?? f.verification_status}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{f.topic}</div>
                    <div className="text-xs mt-0.5">{f.evidence}</div>
                    {f.sources.length > 0 && (
                      <div className="text-[11px] text-muted-foreground mt-1 space-y-0.5">
                        {f.sources.map((s, i) => (
                          <div key={i}>
                            <span className="mr-1">[{TIER_LABEL[s.tier] ?? s.tier}]</span>
                            {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">{s.title}</a> : <span>{s.title}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {(output.competitive_map.named_by_company.length > 0 || output.competitive_map.named_by_research.length > 0) && (
        <section>
          <h3 className="text-sm font-medium mb-2">Competitive map</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border bg-card p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">Named by company</div>
              {output.competitive_map.named_by_company.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">None.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {output.competitive_map.named_by_company.map((c, i) => (
                    <li key={i}>
                      <span className="font-medium">{c.name}</span>
                      {c.note && <span className="text-xs text-muted-foreground ml-2">{c.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-md border bg-card p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">Identified by research</div>
              {output.competitive_map.named_by_research.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">None.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {output.competitive_map.named_by_research.map((c, i) => (
                    <li key={i}>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.rationale}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {output.founder_dossiers.length > 0 && (
        <section>
          <h3 className="text-sm font-medium mb-2">Founder dossiers</h3>
          <div className="space-y-3">
            {output.founder_dossiers.map((f, i) => (
              <div key={i} className="rounded-md border bg-card p-3">
                <div className="font-medium">{f.founder_name}</div>
                <div className="text-xs text-muted-foreground mb-2">{f.role}</div>
                <p className="text-sm">{f.background_summary}</p>
                {f.open_questions.length > 0 && (
                  <div className="mt-2">
                    <div className="text-xs font-medium text-muted-foreground">Open questions</div>
                    <ul className="text-xs list-disc list-inside mt-0.5 space-y-0.5">
                      {f.open_questions.map((q, j) => <li key={j}>{q}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {output.research_gaps.length > 0 && (
        <section>
          <h3 className="text-sm font-medium mb-2">Research gaps</h3>
          <div className="rounded-md border bg-card divide-y">
            {output.research_gaps.map((g, i) => (
              <div key={i} className="p-3 text-sm flex items-start gap-2">
                <span className={`shrink-0 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${CRIT_BADGE[g.criticality] ?? ''}`}>
                  {g.criticality.replace(/_/g, ' ')}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{g.topic}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{g.rationale}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
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
