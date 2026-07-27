'use client'

import { useState } from 'react'
import { Loader2, Globe, ExternalLink, AlertTriangle, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * External research on an inbound deal — the founder's track record, whether the
 * traction claims show up anywhere outside the deck, the competitive picture,
 * and any contradictions.
 *
 * Runs only for deals that clear the fund's thesis-fit bar (web search costs
 * money per call, and a VC inbox is mostly noise). A partner can force it on a
 * deal that was skipped.
 *
 * Sources are shown prominently: research the partner can't check is research
 * they shouldn't trust.
 */

export interface ResearchFindings {
  founder_background?: string
  prior_companies?: string[]
  traction_corroboration?: string
  market_context?: string
  red_flags?: string[]
  open_questions?: string[]
}

export function DealResearchCard({
  dealId,
  status,
  summary,
  findings,
  sources,
  error,
  researchedAt,
  onQueued,
}: {
  dealId: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped' | null
  summary: string | null
  findings: ResearchFindings | null
  sources: Array<{ url: string; title: string }> | null
  error: string | null
  researchedAt: string | null
  onQueued: () => void
}) {
  const [queueing, setQueueing] = useState(false)
  const [queueError, setQueueError] = useState<string | null>(null)

  async function requestResearch() {
    setQueueing(true)
    setQueueError(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/research`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        setQueueError(body.error ?? 'Could not queue research.')
        return
      }
      onQueued()
    } catch {
      setQueueError('Could not queue research.')
    } finally {
      setQueueing(false)
    }
  }

  const inFlight = status === 'pending' || status === 'running'

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4" />
          External research
        </CardTitle>
        {!inFlight && (
          <Button variant="outline" size="sm" onClick={requestResearch} disabled={queueing}>
            {queueing
              ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
            {status === 'done' ? 'Re-run' : 'Research this deal'}
          </Button>
        )}
      </CardHeader>

      <CardContent className="text-sm space-y-3">
        {inFlight && (
          <p className="text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Researching the founder and company on the web — this runs in the background and
            usually lands within ten minutes.
          </p>
        )}

        {status === 'skipped' && !inFlight && (
          <p className="text-muted-foreground">
            {error
              ? error
              : 'Not researched — this deal did not clear the fund\'s thesis-fit bar for automatic research. Run it manually if you think it deserves a look.'}
          </p>
        )}

        {status === 'failed' && !inFlight && (
          <p className="text-destructive flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Research failed: {error ?? 'unknown error'}</span>
          </p>
        )}

        {!status && !inFlight && (
          <p className="text-muted-foreground">
            No external research has been run on this deal.
          </p>
        )}

        {status === 'done' && (
          <>
            {error && (
              <p className="text-warning flex items-start gap-2 text-sm">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}

            {summary && <p className="whitespace-pre-wrap">{summary}</p>}

            {findings?.red_flags && findings.red_flags.length > 0 && (
              <Section title="Red flags" tone="danger">
                <ul className="list-disc pl-5 space-y-0.5">
                  {findings.red_flags.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </Section>
            )}

            {findings?.founder_background && (
              <Section title="Founder background">
                <p className="whitespace-pre-wrap">{findings.founder_background}</p>
                {findings.prior_companies && findings.prior_companies.length > 0 && (
                  <p className="mt-1 text-muted-foreground">
                    Previously: {findings.prior_companies.join(', ')}
                  </p>
                )}
              </Section>
            )}

            {findings?.traction_corroboration && (
              <Section title="Traction — corroborated?">
                <p className="whitespace-pre-wrap">{findings.traction_corroboration}</p>
              </Section>
            )}

            {findings?.market_context && (
              <Section title="Market context">
                <p className="whitespace-pre-wrap">{findings.market_context}</p>
              </Section>
            )}

            {findings?.open_questions && findings.open_questions.length > 0 && (
              <Section title="Questions for a first call">
                <ul className="list-disc pl-5 space-y-0.5">
                  {findings.open_questions.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
              </Section>
            )}

            {sources && sources.length > 0 && (
              <Section title="Sources">
                <ul className="space-y-0.5">
                  {sources.map((s, i) => (
                    <li key={i}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        {s.title || s.url}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {researchedAt && (
              <p className="text-xs text-muted-foreground pt-1">
                Researched {new Date(researchedAt).toLocaleString()}
              </p>
            )}
          </>
        )}

        {queueError && <p className="text-sm text-destructive">{queueError}</p>}
      </CardContent>
    </Card>
  )
}

function Section({
  title,
  tone,
  children,
}: {
  title: string
  tone?: 'danger'
  children: React.ReactNode
}) {
  return (
    <div>
      <h4 className={`text-sm font-semibold uppercase tracking-wide mb-1 ${ tone === 'danger' ? 'text-destructive' : 'text-muted-foreground' }`}>
        {title}
      </h4>
      <div className="text-sm">{children}</div>
    </div>
  )
}
