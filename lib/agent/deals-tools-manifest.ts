// Pure metadata for the INBOUND DEALS agent tools — top-of-funnel deal flow. NO server
// imports (the Settings key UI lists these). Handlers live in deals-tools.ts.
//
// THE DISTINCTION THAT MATTERS, and the reason every description below spells it out:
// the fund has two things a person calls a "deal", and they are different tables at
// different stages of one funnel.
//
//   inbound_emails → inbound_deals → (promoted) → diligence_deals → (invested) → companies
//                    ^^^^^^^^^^^^^                 ^^^^^^^^^^^^^^^
//                    THIS FILE                     diligence-tools-manifest.ts
//
// `inbound_deals` is screening: a pitch arrived by email, got scored against the thesis,
// and is waiting on a pass/advance call. `diligence_deals` is the deal room: documents,
// checklist, memo. A tool that blurred them would answer the wrong question silently, so
// the tool names carry the stage and the descriptions say which is which.

import type { AgentToolMeta } from '@/lib/accounting/agent-tools-manifest'

export const DEALS_TOOL_MANIFEST: AgentToolMeta[] = [
  {
    name: 'deals_list_inbound',
    description:
      'List INBOUND deal flow — pitches that arrived by email and were screened against the fund thesis, with their fit score ' +
      'and status. This is top-of-funnel screening, BEFORE diligence: for deals in the deal room (documents, checklist, memo) ' +
      'use diligence_list_deals instead.',
    scope: 'read',
    domain: 'deals',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional: new | reviewing | passed | advancing | met | spam' },
        fit_score: { type: 'string', description: 'Optional: strong | moderate | weak | out_of_thesis' },
        intro_source: { type: 'string', description: 'Optional: referral | cold | warm_intro | accelerator | demo_day | event | other' },
        q: { type: 'string', description: 'Optional: match on company or founder name.' },
        limit: { type: 'number', description: 'Max rows (default 100, max 500).' },
      },
    },
  },
  {
    name: 'deals_inbound_detail',
    description:
      'One inbound deal in full: the company, the founders, how it reached us, the thesis-fit analysis, any automated research ' +
      'that has run on it, and whether it was promoted into diligence.',
    scope: 'read',
    domain: 'deals',
    inputSchema: {
      type: 'object',
      properties: { deal: { type: 'string', description: 'Inbound deal id, or the company name (matched case-insensitively).' } },
      required: ['deal'],
    },
  },
]
