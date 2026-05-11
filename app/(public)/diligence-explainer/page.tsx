import { ogMetadata } from '@/lib/og-metadata'
import { Microscope } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export const metadata = ogMetadata({
  title: 'Diligence',
  description: 'Pre-investment workflow with a schema-driven Memo Agent that ingests the data room, runs research, asks partner Q&A, drafts a structured memo with paragraph-level provenance, and renders to Word or Google Docs.',
})

export default function DiligenceExplainerPage() {
  return (
    <ExplainerContent
      title="Diligence"
      icon={Microscope}
      screenshotSrc="/screenshots/diligence.png"
      screenshotLabel="Diligence"
    >
      <p className="text-muted-foreground">
        Diligence is the pre-investment workflow: when a deal is worth real time, you create a
        diligence record, upload the data room, and run a schema-driven Memo Agent that ingests
        the documents, conducts external research, asks partner Q&amp;A, drafts a structured memo,
        scores it per your rubric, and renders to Word or Google Docs. Each diligence record has
        tabs for Overview, Deal Room (uploaded files), Drafts (memo versions), Q&amp;A, Research,
        and Notes.
      </p>
      <p className="text-muted-foreground">
        The agent is operated by seven YAML/MD configuration files (&ldquo;schemas&rdquo;) that admins
        edit per-fund through an in-app editor: instructions (operating manual), rubric (scoring
        dimensions), qa_library (partner Q&amp;A pool), data_room_ingestion (per-document extraction
        rules), research_dossier (external research scope), memo_output (memo structure), and
        style_anchors (metadata for uploaded reference memos). The schema editor uses Monaco with
        inline YAML validation and version history. Defaults are seeded automatically the first
        time you open the editor.
      </p>
      <p className="text-muted-foreground">
        Style Anchors are uploaded reference memos that teach the agent your firm&apos;s voice.
        Drop in 3&ndash;8 prior memos, tag each with vintage, sector, voice representativeness, and
        partner notes, and the agent uses them to match structure and tone during drafting. A
        confidence indicator (unavailable, preliminary, reliable, robust) reflects how many memos
        you&apos;ve uploaded. Reference memos teach voice - they never supply facts to a new
        memo.
      </p>
      <p className="text-muted-foreground">
        The agent runs in six stages: Ingest (classify each doc, extract claims with provenance,
        run gap analysis), Research (verify or contradict claims, build a competitive map, compile
        founder dossiers), Q&amp;A (next-best partner questions per the qa_library with skip logic
        against ingestion + research), Draft (assemble paragraphs with paragraph-level citations),
        Score (rate each rubric dimension; partner-only dimensions like team get null score with
        supporting material), Render (markdown, .docx, or native Google Doc). Long stages run as
        background jobs picked up by a worker every minute.
      </p>
      <p className="text-muted-foreground">
        The memo editor is a two-pane view: rendered memo on the left with inline citation markers
        and visual treatment for projections, unverified claims, and contradictions; paragraph
        inspector and partner-attention sidebar on the right. Partners edit any paragraph, update
        rubric scores by hand, work through the attention queue, and finalize when ready -
        finalizing locks the draft. Recommendation and team scoring are partner-only and can never
        be set by the agent.
      </p>
      <p className="text-muted-foreground">
        Across all your active deals, the Memo Inbox aggregates open partner-attention items so
        you can triage them in one pass. The Analytics view shows the agent funnel with drop-off
        percentages, time-in-stage medians, win/loss by sector, and throughput per lead partner.
        Defaults under Settings sets per-deal and monthly token caps and per-stage AI provider
        overrides - for example, a cheaper provider for ingest, a stronger one for draft.
      </p>
    </ExplainerContent>
  )
}
