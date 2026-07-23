import { ogMetadata } from '@/lib/og-metadata'
import { Lightbulb } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export const metadata = ogMetadata({
  title: 'Deals',
  description: 'AI-screened inbound deal flow - cold pitches, partner forwards, and scout intros classified against your fund thesis before they reach a partner inbox.',
})

export default function DealsExplainerPage() {
  return (
    <ExplainerContent
      title="Deals"
      icon={Lightbulb}
      screenshotSrc="/screenshots/deals.png"
      screenshotLabel="Deals"
    >
      <p className="text-muted-foreground">
        Deals is the inbound side of deal flow - cold pitches, partner-forwarded intros, and
        scout submissions arrive at your existing inbound email address and are screened against
        your fund&apos;s thesis before they reach a partner&apos;s inbox. Every inbound email runs
        through a content-aware classifier that decides between four destinations: reporting
        (portfolio metrics, the existing pipeline), interactions (CRM-style emails from fund
        members), deals (a company pitching the fund), or other (newsletters, recruiter spam,
        vendor pitches).
      </p>
      <p className="text-muted-foreground">
        Sender identity is a strong signal but not a hard rule, so a partner forwarding a cold
        pitch lands in Deals where it belongs, and a portfolio founder pitching a side project gets
        routed correctly. Uncertain items go to a Review queue, tagged with the top two predicted
        destinations, for quick manual resolution &mdash; nothing is silently dropped.
      </p>
      <p className="text-muted-foreground">
        For each pitch routed to Deals, a single AI call extracts company name, founder, intro
        source (referral, cold, warm intro, accelerator, demo day, event, or other), referrer when
        applicable, stage, industry, raise size, a 100&ndash;150 word company summary, and a
        thesis-fit analysis with a fit score (strong, moderate, weak, out of thesis, or spam).
        Out-of-thesis and spam pitches stay in the pipeline tagged by fit and surface in a weekly
        digest email so partners can sanity-check without eyeballing every cold pitch. Founders can
        also submit pitches directly via a public form at a per-fund URL - admins generate or rotate
        the URL in Settings.
      </p>
      <p className="text-muted-foreground">
        The Deals page lists active pitches as a sortable table or a kanban board, with drag-and-drop
        across status columns: new, reviewing, advancing, met, diligence, invested, passed. Click a pitch to see the
        summary, thesis-fit analysis, source email, attachments, founders, intro source, and a
        deal-scoped Analyst chat that knows the pitch and your thesis. Settings includes a Known
        Referrers list (scouts and friends-of-fund whose intros bias toward Deals).
      </p>
    </ExplainerContent>
  )
}
