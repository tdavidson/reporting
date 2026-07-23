'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Section } from '@/components/settings/section'
import { DefaultsEditor } from '../../../memo-agent/defaults/editor'
import { StyleAnchorsInline } from '../../../memo-agent/style-anchors/style-anchors-inline'
import { SchemasInline } from '../../../memo-agent/schemas/schemas-inline'

// ──────────────────────────── Diligence ────────────────────────────

function MemoAgentSubsection({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="py-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start gap-2 text-left group"
      >
        {open ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0">
          <div className="text-sm font-medium group-hover:text-foreground">{title}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
        </div>
      </button>
      {open && <div className="mt-3 pl-6">{children}</div>}
    </div>
  )
}

export function MemoAgentSection() {
  return (
    <Section title="Diligence">
      <p className="text-xs text-muted-foreground mb-1">
        Configure how the diligence agent reads data rooms, sources external research, runs partner Q&amp;A, and drafts memos.
      </p>
      <div className="divide-y border-t">
        <MemoAgentSubsection
          title="Schemas"
          desc="The seven YAML/MD files that govern the agent: rubric, Q&A library, ingestion shape, research shape, memo output, style anchors, and instructions."
        >
          <SchemasInline />
        </MemoAgentSubsection>
        <MemoAgentSubsection
          title="Style anchors"
          desc="Upload past investment memos so the agent learns your firm's voice and structure. Reference only; never copied into new memos as facts."
        >
          <StyleAnchorsInline />
        </MemoAgentSubsection>
        <MemoAgentSubsection
          title="Defaults & caps"
          desc="Per-deal and monthly token caps, the research web-search toggle, and the Deepgram transcription check."
        >
          <DefaultsEditor embedded section="caps" />
        </MemoAgentSubsection>
        <MemoAgentSubsection
          title="Per-stage AI models"
          desc="The AI provider and model each memo-agent stage runs on (ingest, research, draft, score, …)."
        >
          <DefaultsEditor embedded section="stages" />
        </MemoAgentSubsection>
      </div>
    </Section>
  )
}
