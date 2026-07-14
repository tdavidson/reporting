// Pure metadata for the DILIGENCE agent tools — the deal room: data room, checklist,
// extracted evidence, attention queue, memo. NO server imports, so this is safe in client
// components (the Settings key UI lists it). Handlers live in diligence-tools.ts.
//
// Fund-scoped, never vehicle-scoped: a diligence deal is a company the fund is
// evaluating, and it belongs to no vehicle at all — it has not been invested in yet.
//
// NAMING, DELIBERATELY: every tool here says `diligence_`. The fund has TWO things that
// a person would call a "deal" — an `inbound_deals` row (top-of-funnel email intake, see
// deals-tools-manifest.ts) and a `diligence_deals` row (the deal room). They are separate
// tables and separate stages of one funnel. A tool named `get_deal` would answer about
// the wrong one roughly half the time, so no tool is named that.

import type { AgentToolMeta } from '@/lib/accounting/agent-tools-manifest'

const DEAL = { type: 'string', description: 'Diligence deal id, or the deal name (matched case-insensitively, aliases included).' }

export const DILIGENCE_TOOL_MANIFEST: AgentToolMeta[] = [
  {
    name: 'diligence_list_deals',
    description: 'List deals in diligence with their status and how far through the memo pipeline they are.',
    scope: 'read',
    domain: 'diligence',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional: active | passed | won | lost | on_hold' },
        q: { type: 'string', description: 'Optional: match on deal name or sector.' },
      },
    },
  },
  {
    name: 'diligence_deal_detail',
    description:
      'One diligence deal in full: status, sector, stage, lead partner, plus a progress report across the five pipeline stages ' +
      '(data room, checklist, research, scoring, memo) with what is blocking each.',
    scope: 'read',
    domain: 'diligence',
    inputSchema: { type: 'object', properties: { deal: DEAL }, required: ['deal'] },
  },
  {
    name: 'diligence_ask',
    description:
      'Ask a question about a deal and get an answer grounded in its data room, with citations to the documents it came from. ' +
      'This is the tool to reach for on any "what does the data room say about X" question — it answers from the evidence the ' +
      'ingest stage extracted from every document, and says so plainly when the evidence does not cover it rather than guessing. ' +
      'Requires the data room to have been analyzed first (see diligence_deal_detail).',
    scope: 'read',
    domain: 'diligence',
    inputSchema: {
      type: 'object',
      properties: {
        deal: DEAL,
        question: { type: 'string', description: 'The question, in plain English.' },
      },
      required: ['deal', 'question'],
    },
  },
  {
    name: 'diligence_checklist',
    description:
      'The diligence checklist for a deal: every item by section, with its status (found | partial | missing | not_applicable | unknown), ' +
      'the evidence behind it, and a coverage summary. Use this to answer "what are we still missing on this deal".',
    scope: 'read',
    domain: 'diligence',
    inputSchema: {
      type: 'object',
      properties: {
        deal: DEAL,
        status: { type: 'string', description: 'Optional: only items with this status. "missing" gives you the gap list.' },
      },
      required: ['deal'],
    },
  },
  {
    name: 'diligence_list_documents',
    description: "The deal's data room: every document, its detected type, and whether it has been parsed into evidence yet.",
    scope: 'read',
    domain: 'diligence',
    inputSchema: { type: 'object', properties: { deal: DEAL }, required: ['deal'] },
  },
  {
    name: 'diligence_evidence',
    description:
      'The raw evidence base extracted from the deal: per-document claims (with criticality), research findings, contradictions, ' +
      'competitive map, and the gap analysis. This is what the memo and the Q&A are built from — reach for it when you want the ' +
      'underlying facts rather than a written answer.',
    scope: 'read',
    domain: 'diligence',
    inputSchema: {
      type: 'object',
      properties: {
        deal: DEAL,
        include: {
          type: 'string',
          description: "Optional: 'claims' | 'research' | 'gaps' | 'all' (default 'all'). Narrow it — the full evidence base is large.",
        },
      },
      required: ['deal'],
    },
  },
  {
    name: 'diligence_memo',
    description:
      "The investment memo draft: its prose by section, the rubric scores, and the partner-attention queue (what must still be " +
      'addressed before it can be finalized).',
    scope: 'read',
    domain: 'diligence',
    inputSchema: { type: 'object', properties: { deal: DEAL }, required: ['deal'] },
  },
]
