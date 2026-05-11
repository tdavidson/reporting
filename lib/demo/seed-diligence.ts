import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// ---------------------------------------------------------------------------
// Diligence demo data — three deals at different points in the agent flow:
//
//   1. Stellate — full agent run completed (ingest + research + Q&A + draft +
//      score). Memo open in editor with several attention items.
//   2. Lattice — ingest + research only, mid-flow. Used to show the per-stage
//      progress UI.
//   3. Riverstone — early. Only documents uploaded; no agent run yet.
// ---------------------------------------------------------------------------

interface DiligenceDealDef {
  name: string
  sector: string
  stage_at_consideration: string
  deal_status: 'active' | 'passed' | 'won' | 'lost' | 'on_hold'
  current_memo_stage: 'not_started' | 'ingest' | 'research' | 'qa' | 'draft' | 'score' | 'render' | 'finalized'
  notes_summary: string | null
  documents: Array<{
    file_name: string
    file_format: string
    file_size_bytes: number
    detected_type: string
    type_confidence: 'low' | 'medium' | 'high'
    parse_status: 'pending' | 'parsed' | 'partial' | 'failed' | 'skipped'
  }>
  draft?: DraftDef
  attention?: AttentionDef[]
  notes?: string[]
}

interface DraftDef {
  draft_version: string
  agent_version: string
  is_draft: boolean
  ingestion_output: any
  research_output?: any
  qa_answers?: any
  memo_draft_output?: any
}

interface AttentionDef {
  kind: string
  urgency: 'must_address' | 'should_address' | 'fyi'
  body: string
  status: 'open' | 'addressed' | 'deferred'
}

const DEALS: DiligenceDealDef[] = [
  {
    name: 'Stellate',
    sector: 'Developer infrastructure',
    stage_at_consideration: 'Series A',
    deal_status: 'active',
    current_memo_stage: 'render',
    notes_summary: 'Strong fit. Sequoia leading. Filling out round at $5M Series A.',
    documents: [
      { file_name: 'Stellate Series A Deck.pdf',          file_format: 'pdf',  file_size_bytes: 4_500_000, detected_type: 'pitch_deck',       type_confidence: 'high',   parse_status: 'parsed' },
      { file_name: 'Stellate Financial Model.xlsx',       file_format: 'xlsx', file_size_bytes:   180_000, detected_type: 'financial_model',  type_confidence: 'high',   parse_status: 'parsed' },
      { file_name: 'Stellate Cap Table.xlsx',             file_format: 'xlsx', file_size_bytes:    45_000, detected_type: 'cap_table',        type_confidence: 'high',   parse_status: 'parsed' },
      { file_name: 'Stellate Customer References.pdf',    file_format: 'pdf',  file_size_bytes:   650_000, detected_type: 'customer_references', type_confidence: 'high', parse_status: 'parsed' },
      { file_name: 'Founder bios.pdf',                    file_format: 'pdf',  file_size_bytes:   320_000, detected_type: 'team_bio',         type_confidence: 'medium', parse_status: 'parsed' },
    ],
    notes: [
      'Reference call w/ Notion engineering — they use Stellate in production for their public docs cache. "It just works." Reduced their Postgres bill by 38%.',
      'Sequoia partner Drew Goodman confirmed they\'re leading at $45M post. Round is $5M, $3.5M from Sequoia, $1.5M open.',
    ],
    draft: {
      draft_version: 'v0.3-final',
      agent_version: 'memo-agent v0.1',
      is_draft: true,
      ingestion_output: {
        documents: [
          {
            document_id: 'stellate_deck',
            detected_type: 'pitch_deck',
            type_confidence: 'high',
            summary: 'Series A pitch deck for Stellate, a developer-infrastructure SaaS that caches database queries at the edge. Highlights $1.2M ARR, 25% MoM growth, 47 paying customers including Notion and Linear. Founders are ex-Vercel and ex-Cloudflare.',
            claims: [
              { id: 'claim_arr_q4', field: 'ARR_q4_2025', value: '$1.2M', context: 'slide 4, traction', verification_status: 'unverified', criticality: 'high' },
              { id: 'claim_growth', field: 'MoM_growth_q4', value: '25%', context: 'slide 4, traction', verification_status: 'unverified', criticality: 'high' },
              { id: 'claim_nrr', field: 'NRR_q4_2025', value: '138%', context: 'slide 5, retention', verification_status: 'unverified', criticality: 'high' },
              { id: 'claim_gm', field: 'gross_margin', value: '81%', context: 'slide 8, unit economics', verification_status: 'unverified', criticality: 'medium' },
              { id: 'claim_burn', field: 'burn_monthly', value: '$400K/mo', context: 'slide 9, capital', verification_status: 'unverified', criticality: 'medium' },
              { id: 'claim_customers', field: 'paying_customers', value: '47', context: 'slide 4, traction', verification_status: 'unverified', criticality: 'high' },
            ],
          },
          {
            document_id: 'stellate_model',
            detected_type: 'financial_model',
            type_confidence: 'high',
            summary: 'Three-year financial model showing path from $1.2M ARR to $18M ARR by end of 2027. Aggressive net expansion assumption (140% NRR sustained at $5M+ ARR scale).',
            claims: [
              { id: 'claim_y3_arr', field: 'ARR_2027_projected', value: '$18M', context: 'forecast tab, row 14', verification_status: 'unverified', criticality: 'high' },
              { id: 'claim_y3_burn', field: 'burn_2027_avg', value: '$650K/mo', context: 'P&L tab, monthly avg', verification_status: 'unverified', criticality: 'medium' },
            ],
          },
          {
            document_id: 'stellate_captable',
            detected_type: 'cap_table',
            type_confidence: 'high',
            summary: 'Pre-Series A cap table. Founders own 64% pre-money. Existing investors: Bain Capital Ventures (seed lead), Initialized Capital, and 3 angels. Option pool is 11% post-Series A.',
            claims: [
              { id: 'claim_founder_ownership', field: 'founder_ownership_pre_a', value: '64%', context: 'cap table summary', verification_status: 'unverified', criticality: 'medium' },
              { id: 'claim_option_pool', field: 'option_pool_post_a', value: '11%', context: 'cap table summary', verification_status: 'unverified', criticality: 'low' },
            ],
          },
          {
            document_id: 'stellate_refs',
            detected_type: 'customer_references',
            type_confidence: 'high',
            summary: 'Curated customer references list with three named contacts at Notion, Linear, and Ramp.',
            claims: [],
          },
          {
            document_id: 'stellate_team',
            detected_type: 'team_bio',
            type_confidence: 'medium',
            summary: 'Founder bios for Alex Chen (CEO, ex-Vercel), Priya Mehta (CTO, ex-Cloudflare), Devon Rhodes (VP Eng, ex-Vercel).',
            claims: [
              { id: 'claim_ceo_role', field: 'ceo_prior_company', value: 'Vercel', context: 'bio page 1', verification_status: 'unverified', criticality: 'medium' },
              { id: 'claim_cto_role', field: 'cto_prior_company', value: 'Cloudflare', context: 'bio page 2', verification_status: 'unverified', criticality: 'medium' },
            ],
          },
        ],
        gap_analysis: {
          missing: [
            { expected_type: 'security_review', criticality: 'important', rationale: 'Edge-caching tool sees customer database queries. SOC 2 / penetration test results not in data room.' },
            { expected_type: 'sales_pipeline', criticality: 'nice_to_have', rationale: 'No pipeline analysis to validate the $5M ARR target by end of next year.' },
          ],
          inadequate: [],
        },
        cross_doc_flags: [
          { description: 'Burn rate on deck ($400K/mo) is materially below Year 3 average ($650K/mo) in the model. Implied 60% burn growth — partner should ask about hiring plan.', doc_ids: ['stellate_deck', 'stellate_model'] },
        ],
      },
      research_output: {
        findings: [
          {
            id: 'finding_arr_logos',
            claim_ref: 'claim_customers',
            topic: 'Customer logos verification',
            verification_status: 'verified',
            evidence: 'Notion confirmed via reference call with their VP Engineering on Apr 30. Linear engineering blog post mentions Stellate by name (Aug 2025). Ramp listed as customer on Stellate marketing site.',
            sources: [
              { title: 'Reference call notes — Notion VP Eng', url: null, tier: 'tier_1' },
              { title: 'Linear engineering blog: caching at scale', url: 'https://linear.app/blog/caching-at-scale', tier: 'tier_2' },
              { title: 'Stellate customer page', url: 'https://stellate.dev/customers', tier: 'tier_3' },
            ],
          },
          {
            id: 'finding_nrr',
            claim_ref: 'claim_nrr',
            topic: 'NRR sustainability at scale',
            verification_status: 'inconclusive',
            evidence: 'Could not externally verify the 138% NRR claim. Comparable infra companies (PlanetScale, Upstash) report NRR in 120-130% range at similar scale. 138% is plausible but at the high end.',
            sources: [
              { title: 'PlanetScale Series C announcement (Bessemer)', url: null, tier: 'tier_2' },
            ],
          },
          {
            id: 'finding_team',
            claim_ref: 'claim_ceo_role',
            topic: 'Founder credentials',
            verification_status: 'verified',
            evidence: 'Alex Chen profile on Vercel\'s engineering team page (archived 2023). Co-author of Vercel\'s Edge Network blog post (2022). Priya Mehta listed as Cloudflare staff engineer in three GitHub repos. All three roles match deck claims.',
            sources: [
              { title: 'Vercel team page (Wayback, Aug 2023)', url: null, tier: 'tier_1' },
              { title: 'Cloudflare GitHub org', url: null, tier: 'tier_1' },
            ],
          },
        ],
        contradictions: [
          {
            topic: 'Burn rate growth',
            claim_ref: 'claim_burn',
            description: 'Deck states $400K/mo burn at $1.2M ARR. Model implies $650K/mo average burn over the next two years. Either burn grows 60% or revenue grows much faster than the company is letting on. Partner should ask which.',
            severity: 'material',
          },
        ],
        competitive_map: {
          named_by_company: [
            { name: 'Cloudflare', note: 'Identified in deck as "underlying primitive provider" rather than a competitor.' },
          ],
          named_by_research: [
            {
              name: 'PlanetScale',
              rationale: 'Edge-replicated database with caching layer. Different architectural approach but overlapping buyer.',
              sources: [{ title: 'PlanetScale product page', url: 'https://planetscale.com' }],
            },
            {
              name: 'Upstash',
              rationale: 'Edge Redis. Direct competitor for the caching primitive.',
              sources: [{ title: 'Upstash product page', url: 'https://upstash.com' }],
            },
            {
              name: 'Tigris',
              rationale: 'Globally distributed object storage with caching. Newer entrant.',
              sources: [{ title: 'Tigris launch post', url: null }],
            },
          ],
        },
        founder_dossiers: [
          {
            founder_name: 'Alex Chen',
            role: 'CEO & Co-founder',
            background_summary: 'Spent 4 years at Vercel as a senior engineer on the Edge Network team. Co-authored the Vercel Edge Network blog post that announced their cache invalidation system. Stanford CS \'18.',
            sources: [
              { title: 'Vercel team page (Wayback, Aug 2023)', url: null },
              { title: 'GitHub commit history — vercel/edge-cache repo', url: null },
            ],
            open_questions: [
              'What was the specific scope of his work at Vercel — did he own the cache invalidation system or contribute to it?',
              'Why leave Vercel? Was the founding decision triggered by a specific customer pain point or general entrepreneurial ambition?',
            ],
          },
        ],
        research_gaps: [
          { topic: 'Customer concentration in top 10', rationale: 'Deck does not disclose what % of ARR comes from the top 10 customers. If concentration is >40% the growth claim is more fragile.', criticality: 'important' },
          { topic: 'Churn cohort behavior', rationale: 'NRR alone does not show gross retention. Need to see Day-365 logo retention.', criticality: 'important' },
          { topic: 'Why existing investors aren\'t taking the round', rationale: 'Bain Capital Ventures (seed lead) is pro-rata-eligible. Their non-participation could be informative.', criticality: 'should_address' },
        ],
        research_mode: 'no_web_search',
      },
      qa_answers: [
        { question_id: 'bg_001', answer_text: 'References were uniformly positive on Alex specifically. The strongest signal: Notion\'s VP Eng said "we evaluated five caching solutions and Stellate was the only one that didn\'t require us to refactor our database access layer." That is the kind of integration ergonomics that becomes a moat.', partner_id: null, answered_at: new Date(Date.now() - 3 * 86400000).toISOString(), feeds_dimensions: ['team'], category: 'background_track_record' },
        { question_id: 'bg_002', answer_text: 'Verified Alex\'s Vercel role via Wayback and a former colleague. Priya at Cloudflare confirmed via her old manager. We did not verify Stanford CS — not material.', partner_id: null, answered_at: new Date(Date.now() - 3 * 86400000).toISOString(), feeds_dimensions: ['team'], category: 'background_track_record' },
        { question_id: 'fmf_001', answer_text: 'Yes — surface answer was "we hated database bills at Vercel" but the deeper answer that emerged on call 3 was that Alex\'s last project at Vercel was an internal tool for cache invalidation that the company decided not to productize. Founder-product fit is unusually tight here.', partner_id: null, answered_at: new Date(Date.now() - 3 * 86400000).toISOString(), feeds_dimensions: ['team'], category: 'founder_market_fit' },
        { question_id: 'fmf_003', answer_text: 'Alex said: "I\'d go back to building cache invalidation systems somewhere else, probably as an early engineer. This is the only company I\'d start." Read as: problem owns him.', partner_id: null, answered_at: new Date(Date.now() - 3 * 86400000).toISOString(), feeds_dimensions: ['team'], category: 'founder_market_fit' },
      ],
      memo_draft_output: {
        header: {
          company_name: 'Stellate',
          sector: 'Developer infrastructure',
          stage: 'Series A',
          round_size: '$5M @ $45M post',
          deal_lead: null,
          memo_date: new Date().toISOString().slice(0, 10),
          draft_version: 'v0.3-final',
          agent_version: 'memo-agent v0.1',
        },
        paragraphs: [
          {
            id: 'p_exec_1',
            section_id: 'executive_summary',
            order: 0,
            prose: 'Stellate is an edge-caching layer for SaaS application databases, founded in late 2023 by ex-Vercel and ex-Cloudflare engineers who built and shipped cache invalidation systems at production scale at their prior companies. The company is at $1.2M ARR with 25% month-over-month growth across 47 paying SaaS customers, claimed 138% net revenue retention, and verifiable production deployments at Notion, Linear, and Ramp. Sequoia is leading the $5M Series A at a $45M post-money valuation; Hemrock would participate to fill out the round at the current allocation of $1.25M for a 2.8% target ownership stake. The thesis is that edge data infrastructure is the next layer to consolidate after edge compute (Cloudflare Workers, Vercel Edge Functions), and the founding team has both the technical depth and the proximity to the buyer (SaaS infra engineering leads) to win it.',
            sources: [
              { source_type: 'claim', source_id: 'claim_arr_q4' },
              { source_type: 'claim', source_id: 'claim_growth' },
              { source_type: 'claim', source_id: 'claim_nrr' },
              { source_type: 'finding', source_id: 'finding_arr_logos' },
            ],
            origin: 'agent_drafted',
            confidence: 'high',
            contains_projection: false,
            contains_unverified_claim: true,
            contains_contradiction: false,
          },
          {
            id: 'p_exec_2',
            section_id: 'executive_summary',
            order: 1,
            prose: 'The single largest unresolved issue is a 60% discrepancy between the company-stated burn rate ($400K/mo in the deck) and the financial model\'s implied two-year average ($650K/mo derived from the $18M projected 2027 ARR and stated hiring plan). Either burn ramps aggressively to fund the engineering hires required to support the projected logo growth, or the revenue plan is materially more conservative than the deck headline. A second-order concern: 138% NRR is at the top of the comparable range — PlanetScale and Upstash report 120-130% at similar scale — and is the assumption most load-bearing for the year-3 projection. Both items must be addressed in the partner conversation before a commitment can be made.',
            sources: [
              { source_type: 'claim', source_id: 'claim_burn' },
              { source_type: 'claim', source_id: 'claim_y3_burn' },
            ],
            origin: 'agent_drafted',
            confidence: 'high',
            contains_projection: true,
            contains_unverified_claim: false,
            contains_contradiction: true,
          },
          {
            id: 'p_recommendation_placeholder',
            section_id: 'recommendation',
            order: 0,
            prose: '[Partner to complete]',
            sources: [],
            origin: 'partner_only_placeholder',
            confidence: 'n/a',
            contains_projection: false,
            contains_unverified_claim: false,
            contains_contradiction: false,
          },
          {
            id: 'p_company_1',
            section_id: 'company_overview',
            order: 0,
            prose: 'Stellate provides a database query caching layer that runs at edge points-of-presence and sits between the application server and the origin database. SaaS engineering teams drop in the Stellate SDK without modifying their existing database access layer, and the system automatically caches read queries against a low-latency edge store with TTL-based invalidation and a write-through path that pushes mutations back to the origin database. The company\'s stated value proposition is a 30-40% reduction in monthly Postgres infrastructure spend plus measurable latency improvement for read-heavy SaaS workloads. The current customer base is 47 paying SaaS companies, anchored by Notion, Linear, and Ramp as flagship logos with public mentions of Stellate in their engineering blogs.',
            sources: [
              { source_type: 'claim', source_id: 'claim_customers' },
              { source_type: 'finding', source_id: 'finding_arr_logos' },
            ],
            origin: 'agent_drafted',
            confidence: 'high',
            contains_projection: false,
            contains_unverified_claim: false,
            contains_contradiction: false,
          },
          {
            id: 'p_product_1',
            section_id: 'product',
            order: 0,
            prose: 'The core product is a single npm package (`@stellate/cache`) plus a managed control plane. Developers wrap their existing database client and Stellate transparently caches qualifying read queries at the nearest edge POP — currently 18 regions on Cloudflare\'s network. The control-plane UI shows cache hit rate, p50/p95/p99 latency, and per-query cost savings; the data-room screenshots show real metrics from a customer with a 73% hit rate on a Postgres workload that previously cost $42K/month. Two reference customers (Notion and Linear) confirmed via public engineering blogs that the integration was deployed in under a day. The defensibility argument is integration ergonomics — once customers adopt the SDK pattern, the switching cost to a competitor (PlanetScale, Upstash) requires re-architecting the database access layer, which is a one-time engineering cost that compounds as the customer\'s data grows.',
            sources: [
              { source_type: 'finding', source_id: 'finding_arr_logos' },
              { source_type: 'claim', source_id: 'claim_customers' },
            ],
            origin: 'agent_drafted',
            confidence: 'high',
            contains_projection: false,
            contains_unverified_claim: false,
            contains_contradiction: false,
          },
          {
            id: 'p_market_1',
            section_id: 'market',
            order: 0,
            prose: 'The edge data infrastructure category is roughly a $5B addressable spend today (third-party estimates from Battery and Bessemer market maps), growing at 35-40% annually as more SaaS applications adopt globally distributed architectures. The category has produced at least two billion-dollar outcomes in the last 36 months — PlanetScale (acquired-talked at $1B+ implied valuation), Cloudflare R2 (public Cloudflare segment). Direct competitors include PlanetScale (edge-replicated database with caching), Upstash (edge Redis as a service), and Tigris (globally distributed object storage with caching primitives). Stellate did not name any of these in the deck — they positioned Cloudflare as a primitive provider rather than a competitor, which is defensible but also reveals that they\'re thinking of themselves as a vertical product on top of a platform. Tailwinds: AI-driven query growth, increasing latency sensitivity at the application layer, and continued consolidation toward edge-first architectures.',
            sources: [
              { source_type: 'finding', source_id: 'finding_nrr' },
              { source_type: 'qa_answer', source_id: 'bg_001' },
            ],
            origin: 'agent_drafted',
            confidence: 'medium',
            contains_projection: false,
            contains_unverified_claim: false,
            contains_contradiction: false,
          },
          {
            id: 'p_team_1_factual',
            section_id: 'team',
            order: 0,
            prose: 'Three-person founding team: Alex Chen (CEO), Priya Mehta (CTO), and Devon Rhodes (VP Engineering). Alex Chen, age 32, spent four years at Vercel from 2020-2024 on the Edge Network team, joining as a senior engineer and exiting as a tech lead; prior to Vercel he was an early engineer at Hashicorp on the Consul team for two years. Priya Mehta, age 34, was a staff engineer at Cloudflare from 2019-2024, working on the Workers KV product and previously the cache-invalidation subsystem of Cloudflare\'s CDN; before Cloudflare she spent three years at Akamai. Devon Rhodes, age 29, was a senior engineer at Vercel alongside Alex from 2022-2024, focused specifically on the cache-coherency layer of the Edge Network; prior to Vercel he was at Snowflake on the compute-storage separation work. All three hold BS Computer Science degrees — Alex from Stanford, Priya from CMU, Devon from Waterloo.',
            sources: [
              { source_type: 'finding', source_id: 'finding_team' },
              { source_type: 'qa_answer', source_id: 'bg_002' },
            ],
            origin: 'agent_drafted',
            confidence: 'high',
            contains_projection: false,
            contains_unverified_claim: false,
            contains_contradiction: false,
          },
          {
            id: 'p_team_2_prior_work',
            section_id: 'team',
            order: 1,
            prose: 'Founder-market fit is unusually direct: Alex\'s last project at Vercel was an internal cache-invalidation tool that Vercel decided not to productize, and Stellate is effectively the externalized version of that work with a different business model. Priya owned cache invalidation at Cloudflare during the period when Cloudflare scaled Workers KV from beta to GA — she has shipped this exact category of system at production scale serving trillions of requests per day. Devon\'s work on Vercel\'s cache-coherency layer overlaps precisely with the consistency guarantees Stellate\'s SDK provides today. Across the three of them, this is a team that has built and operated cache invalidation systems at three of the most demanding shops in the industry (Akamai, Cloudflare, Vercel) for a combined ~10 years before starting the company.',
            sources: [
              { source_type: 'qa_answer', source_id: 'fmf_001' },
              { source_type: 'qa_answer', source_id: 'bg_001' },
            ],
            origin: 'agent_drafted',
            confidence: 'high',
            contains_projection: false,
            contains_unverified_claim: false,
            contains_contradiction: false,
          },
          {
            id: 'p_team_3_public_output',
            section_id: 'team',
            order: 2,
            prose: 'Public output is substantial for a team this size. Alex co-authored Vercel\'s widely-referenced 2023 engineering blog post "How we invalidate the edge cache" which has been cited in 14+ infra-engineering talks at QCon and Strange Loop. Priya was a co-author on the Cloudflare Workers KV consistency model write-up (2022) and gave a keynote on edge consistency at All Things Distributed 2023. Devon maintains an active Github with non-trivial contributions to the open-source `tigerbeetle` distributed database project. None of the three are first-time founders, but none have founded a venture-backed company before either.',
            sources: [
              { source_type: 'finding', source_id: 'finding_team' },
              { source_type: 'qa_answer', source_id: 'bg_001' },
            ],
            origin: 'agent_drafted',
            confidence: 'medium',
            contains_projection: false,
            contains_unverified_claim: false,
            contains_contradiction: false,
          },
          {
            id: 'p_team_4_references',
            section_id: 'team',
            order: 3,
            prose: 'Partner Q&A surfaced two notable reference data points. From the Vercel reference call (verified via former colleague): Alex\'s product-engineering judgment was specifically called out as the differentiator — "Alex is the kind of engineer who would push back on a feature spec, build a prototype to prove the alternative, and ship the better version on time. Most engineers do at most two of those three." From the founder-market-fit Q&A: when asked what he\'d do if Stellate failed, Alex answered "I\'d go back to building cache invalidation systems somewhere else, probably as an early engineer. This is the only company I\'d start" — which reads as a founder whose identity is bound to the problem domain rather than to the act of company-building.',
            sources: [
              { source_type: 'qa_answer', source_id: 'bg_001' },
              { source_type: 'qa_answer', source_id: 'fmf_003' },
            ],
            origin: 'agent_drafted',
            confidence: 'high',
            contains_projection: false,
            contains_unverified_claim: false,
            contains_contradiction: false,
          },
          {
            id: 'p_team_5_partner',
            section_id: 'team',
            order: 4,
            prose: '[Partner to complete — character assessment, founder-market fit judgment, and overall team score]',
            sources: [],
            origin: 'partner_only_placeholder',
            confidence: 'n/a',
            contains_projection: false,
            contains_unverified_claim: false,
            contains_contradiction: false,
          },
          {
            id: 'p_traction_1',
            section_id: 'traction',
            order: 0,
            prose: 'Company-stated traction is $1.2M ARR, 25% MoM growth, 138% NRR, and 81% gross margin, with the ARR figure broken out as 47 paying customers averaging ~$2.1K MRR per logo. Notion and Linear are verified production users — both reference Stellate in their public engineering blog posts and reference checks with engineering leadership at both companies confirmed live deployment serving production traffic. Ramp is verified via the company\'s public customer page but reference outreach was not completed in time for this draft. The 138% NRR claim could not be independently verified within the diligence window; comparable peer companies PlanetScale and Upstash report 120-130% NRR at similar scale per their public S-1-style filings and analyst notes, so 138% is plausible but at the top end of the comparable band and would need direct review of cohort data to confirm.',
            sources: [
              { source_type: 'claim', source_id: 'claim_arr_q4' },
              { source_type: 'claim', source_id: 'claim_nrr' },
              { source_type: 'finding', source_id: 'finding_nrr' },
              { source_type: 'finding', source_id: 'finding_arr_logos' },
            ],
            origin: 'agent_drafted',
            confidence: 'medium',
            contains_projection: false,
            contains_unverified_claim: true,
            contains_contradiction: false,
          },
          {
            id: 'p_business_model_1',
            section_id: 'business_model',
            order: 0,
            prose: 'Subscription pricing structured as a base platform fee per workspace plus usage-based overage on cached query volume above the included monthly quota. Gross margin is claimed at 81%, which is consistent with peer infrastructure businesses operating at similar scale (PlanetScale reported 78% at their last public disclosure). The financial model projects $18M ARR by end of 2027 — a 15x increase from the current $1.2M base in 24 months, driven by a combination of new-logo acquisition (compounding at the stated 25% MoM rate) and expansion within existing customers (138% NRR). Reaching the projection requires both growth rates to hold simultaneously at scale, which has not been demonstrated for the category. Sensitivity analysis is the most important missing piece of the model — partner should request a downside scenario at 100% NRR and 12% MoM growth.',
            sources: [
              { source_type: 'claim', source_id: 'claim_y3_arr' },
              { source_type: 'finding', source_id: 'finding_nrr' },
            ],
            origin: 'agent_drafted',
            confidence: 'medium',
            contains_projection: true,
            contains_unverified_claim: true,
            contains_contradiction: false,
          },
          {
            id: 'p_competition_1',
            section_id: 'competition_moat',
            order: 0,
            prose: 'Direct competitors include PlanetScale (edge-replicated database with caching, $1B+ implied valuation, recent acquisition-talked status), Upstash (edge Redis as a service, last private round at $400M), and Tigris (globally distributed object storage with caching primitives, Series B). Stellate did not name any of these in the pitch deck and positioned Cloudflare as a platform primitive rather than a competitor. The omission is worth flagging — most competitive maps generated by partners on cold review will include these three immediately. The defensible position Stellate articulated is integration ergonomics: customers report adopting Stellate in under a day without refactoring their database access layer, where competitors typically require a several-week migration or a wholesale rewrite. That switching cost is asymmetric (high for customers leaving Stellate, low for customers joining), which creates a meaningful one-time switching cost moat but not a structural data or network-effect advantage.',
            sources: [
              { source_type: 'finding', source_id: 'finding_arr_logos' },
              { source_type: 'qa_answer', source_id: 'bg_001' },
            ],
            origin: 'agent_drafted',
            confidence: 'medium',
            contains_projection: false,
            contains_unverified_claim: false,
            contains_contradiction: false,
          },
          {
            id: 'p_outcomes_1',
            section_id: 'outcomes_analysis',
            order: 0,
            prose: 'Base-case scenario assumes Stellate executes the stated $18M ARR plan by end of 2027 and continues compounding into a $50-80M ARR business by year 7 (2030), which would be a credible Series C/D outcome. Recent comparable exits in edge infrastructure: PlanetScale at ~$1B implied (M&A talks, 2024); Vercel at $3.25B (last private round, 2024 — broader infra but adjacent); Cloudflare R2 segment estimated $200M+ revenue contribution. At $50-80M ARR, a strategic acquirer at 10-15x ARR multiple implies a $500M-$1.2B exit. At our entry valuation of $45M post and a $1.25M check for 2.8% ownership, the base case returns ~3-7x gross on our position over a 5-7 year horizon.',
            sources: [
              { source_type: 'claim', source_id: 'claim_y3_arr' },
              { source_type: 'finding', source_id: 'finding_arr_logos' },
            ],
            origin: 'agent_drafted',
            confidence: 'medium',
            contains_projection: true,
            contains_unverified_claim: false,
            contains_contradiction: false,
          },
          {
            id: 'p_outcomes_2',
            section_id: 'outcomes_analysis',
            order: 1,
            prose: 'Upside scenario: Stellate becomes the default edge data layer for the next generation of SaaS, reaching $150-250M ARR by year 7 with continued 50%+ growth, supporting an IPO or strategic acquisition at $3-5B. Comparable: PlanetScale at peak private valuation, MongoDB Atlas at the equivalent revenue scale. At those outcomes our position returns 15-30x gross. Downside scenario: growth stalls below 100% NRR after the current customer base saturates, the year-3 projection comes in at $5-7M ARR rather than $18M, the round following this one is flat or down, and the company is either acquired for talent at $50-100M or shuts down. At the talent-acquisition floor, our position returns roughly 1-2x; at shutdown, the position is a write-off. Partner judgment fields below capture the actual underwriting decision.',
            sources: [
              { source_type: 'finding', source_id: 'finding_nrr' },
              { source_type: 'claim', source_id: 'claim_y3_arr' },
            ],
            origin: 'agent_drafted',
            confidence: 'medium',
            contains_projection: true,
            contains_unverified_claim: false,
            contains_contradiction: false,
          },
          {
            id: 'p_outcomes_3_partner',
            section_id: 'outcomes_analysis',
            order: 2,
            prose: '[Partner to complete — base-case target multiple, upside thesis, downside floor, target ownership]',
            sources: [],
            origin: 'partner_only_placeholder',
            confidence: 'n/a',
            contains_projection: false,
            contains_unverified_claim: false,
            contains_contradiction: false,
          },
          {
            id: 'p_risks_1',
            section_id: 'risks_and_open_questions',
            order: 0,
            prose: 'Three open questions before commitment. First, the burn-rate contradiction: the deck shows $400K/mo, the model implies $650K/mo on a two-year average — partner should ask Alex directly which is correct and where the delta sits. Second, revenue concentration: the top-10 customer concentration is not disclosed in the data room, and for a 47-customer business it could materially affect the durability of the 138% NRR claim if a single large customer is driving the headline number. Third, Bain Capital Ventures (seed lead) is not taking their pro-rata in the Series A; this could be a benign signal (full fund, internal IC dynamics) or a real concern about thesis, and the partner should specifically ask Alex why Bain stepped down. Beyond the three open questions, the structural risks are concentration of the founding team in a single technical area (all three are cache infrastructure engineers — no obvious GTM or sales leadership on the founding team yet) and the moat being primarily a switching cost rather than a structural advantage.',
            sources: [
              { source_type: 'gap', source_id: 'concentration' },
              { source_type: 'gap', source_id: 'bain_pro_rata' },
              { source_type: 'finding', source_id: 'finding_nrr' },
            ],
            origin: 'agent_drafted',
            confidence: 'high',
            contains_projection: false,
            contains_unverified_claim: false,
            contains_contradiction: true,
          },
        ],
        partner_attention: [
          { kind: 'contradiction', urgency: 'must_address', body: 'Burn rate on deck ($400K/mo) is 60% lower than two-year model average ($650K/mo). Resolve before commitment.', links: [{ source_type: 'claim', source_id: 'claim_burn' }] },
          { kind: 'unverified_material_claim', urgency: 'should_address', body: '138% NRR is at the high end of comparable companies. Confirm via Stripe or finance review.', links: [{ source_type: 'claim', source_id: 'claim_nrr' }] },
          { kind: 'data_room_gap', urgency: 'should_address', body: 'No security/SOC 2 documentation in the data room — required for an infra product that sees customer queries.', links: [] },
          { kind: 'partner_only_blank', urgency: 'must_address', body: 'Recommendation section is empty.', links: [] },
          { kind: 'partner_only_blank', urgency: 'must_address', body: 'Team character assessment is empty.', links: [] },
        ],
        scores: [
          { dimension_id: 'market',            mode: 'machine',      score: 4,    confidence: 'high',   rationale: 'Edge data infrastructure is a $5B+ category with multiple recent $1B+ outcomes (PlanetScale, Cloudflare R2). Tailwinds from AI-driven query growth.', supporting_evidence: [{ source_type: 'finding', source_id: 'finding_nrr' }] },
            { dimension_id: 'product_technology', mode: 'machine',     score: 4,    confidence: 'medium', rationale: 'Architecturally sound. Verified production usage at Notion and Linear suggests the engineering bar is real. Integration ergonomics differentiates.', supporting_evidence: [{ source_type: 'finding', source_id: 'finding_arr_logos' }] },
          { dimension_id: 'traction',          mode: 'machine',      score: 4,    confidence: 'medium', rationale: '$1.2M ARR with 25% MoM growth and verifiable named customers. NRR claim is at the high end of comparables but not implausible.', supporting_evidence: [{ source_type: 'claim', source_id: 'claim_arr_q4' }] },
          { dimension_id: 'business_model',    mode: 'machine',      score: 3,    confidence: 'medium', rationale: 'Subscription + usage. 81% gross margin claim is plausible. Year-3 model assumes sustained 138% NRR, which is unproven at scale.', supporting_evidence: [{ source_type: 'claim', source_id: 'claim_y3_arr' }] },
          { dimension_id: 'competition_moat',  mode: 'machine',      score: 3,    confidence: 'medium', rationale: 'Three direct competitors. Defensibility comes from integration ergonomics, which is real but not a structural moat.', supporting_evidence: [] },
          { dimension_id: 'deal_terms',        mode: 'hybrid',       score: 3,    confidence: 'medium', rationale: '$45M post on $1.2M ARR is 37x ARR — high but inside the band for hot infrastructure rounds with named-tier-1 lead.', supporting_evidence: [] },
          { dimension_id: 'team',              mode: 'partner_only', score: null, confidence: null,     rationale: 'Founders verified ex-Vercel and ex-Cloudflare. Reference call with Notion VP Eng was strongly positive on Alex specifically. Founder-market fit signal: Alex\'s last project at Vercel was an internal cache invalidation system, suggesting unusually tight founder-product fit. Partner to assign team score.', supporting_evidence: [{ source_type: 'qa_answer', source_id: 'bg_001' }, { source_type: 'qa_answer', source_id: 'fmf_001' }] },
        ],
      },
    },
    attention: [
      { kind: 'contradiction',           urgency: 'must_address',   body: 'Burn rate on deck ($400K/mo) is 60% lower than two-year model average ($650K/mo). Resolve before commitment.', status: 'open' },
      { kind: 'unverified_material_claim', urgency: 'should_address', body: '138% NRR is at the high end of comparable companies. Confirm via Stripe or finance review.', status: 'open' },
      { kind: 'data_room_gap',           urgency: 'should_address', body: 'No security/SOC 2 documentation in the data room — required for an infra product that sees customer queries.', status: 'open' },
      { kind: 'partner_only_blank',      urgency: 'must_address',   body: 'Recommendation section is empty.', status: 'open' },
      { kind: 'partner_only_blank',      urgency: 'must_address',   body: 'Team character assessment is empty.', status: 'open' },
      { kind: 'low_confidence_score',    urgency: 'should_address', body: 'business_model: Year-3 model assumes sustained 138% NRR, which is unproven at scale.', status: 'addressed' },
    ],
  },

  {
    name: 'Lattice',
    sector: 'Vertical SaaS / Agriculture',
    stage_at_consideration: 'Seed',
    deal_status: 'active',
    current_memo_stage: 'qa',
    notes_summary: 'Mid-flow. Strong founder-market fit. LatAm exposure to manage.',
    documents: [
      { file_name: 'Lattice Seed Deck.pdf',     file_format: 'pdf',  file_size_bytes: 3_200_000, detected_type: 'pitch_deck',      type_confidence: 'high', parse_status: 'parsed' },
      { file_name: 'Co-op customer list.xlsx',  file_format: 'xlsx', file_size_bytes:    62_000, detected_type: 'customer_references', type_confidence: 'high', parse_status: 'parsed' },
      { file_name: 'Founder bios.pdf',          file_format: 'pdf',  file_size_bytes:   180_000, detected_type: 'team_bio',        type_confidence: 'high', parse_status: 'parsed' },
    ],
    notes: [
      'Marisol grew up on a coffee farm in Antioquia. Brother still runs it. Genuine domain context.',
      'Need to dig into FX exposure — co-ops pay in COP, Lattice prices in USD.',
    ],
    draft: {
      draft_version: 'v0.2-post-research',
      agent_version: 'memo-agent v0.1',
      is_draft: true,
      ingestion_output: {
        documents: [
          {
            document_id: 'lattice_deck',
            detected_type: 'pitch_deck',
            type_confidence: 'high',
            summary: 'Seed pitch deck. $480K ARR across 14 co-ops in Mexico and Colombia. 18% MoM growth. Founders are ex-McKinsey + ex-Globant.',
            claims: [
              { id: 'claim_arr', field: 'ARR_q4_2025', value: '$480K', context: 'slide 5, traction', verification_status: 'unverified', criticality: 'high' },
              { id: 'claim_growth', field: 'MoM_growth', value: '18%', context: 'slide 5', verification_status: 'unverified', criticality: 'high' },
              { id: 'claim_coops', field: 'paying_coops', value: '14', context: 'slide 6', verification_status: 'unverified', criticality: 'high' },
            ],
          },
          {
            document_id: 'lattice_coops',
            detected_type: 'customer_references',
            type_confidence: 'high',
            summary: 'Customer list with co-op names, country, member count, and ARR contribution. Top 3 co-ops are 62% of ARR.',
            claims: [
              { id: 'claim_concentration', field: 'top_3_concentration', value: '62%', context: 'spreadsheet summary', verification_status: 'unverified', criticality: 'high' },
            ],
          },
          {
            document_id: 'lattice_team',
            detected_type: 'team_bio',
            type_confidence: 'high',
            summary: 'Two-person founding team. Marisol Vega (CEO) ex-McKinsey, Colombian, grew up on a coffee farm. Tomás Aguirre (CTO) ex-Globant.',
            claims: [],
          },
        ],
        gap_analysis: {
          missing: [
            { expected_type: 'financial_model', criticality: 'blocker', rationale: 'No financial model. Cannot assess unit economics or runway plan.' },
            { expected_type: 'cap_table',       criticality: 'important', rationale: 'No cap table. Need to understand existing dilution before seeing the round.' },
          ],
          inadequate: [],
        },
        cross_doc_flags: [],
      },
      research_output: {
        findings: [
          {
            id: 'finding_marisol_mck',
            claim_ref: null,
            topic: 'Marisol\'s McKinsey background',
            verification_status: 'verified',
            evidence: 'McKinsey alumni directory confirms Marisol Vega, Bogota office, 2018-2022, agribusiness practice.',
            sources: [{ title: 'McKinsey alumni directory', url: null, tier: 'tier_1' }],
          },
          {
            id: 'finding_competitor',
            claim_ref: null,
            topic: 'Competitive landscape',
            verification_status: 'verified',
            evidence: 'Cropsifter is the dominant co-op management software in LatAm with ~150 co-op customers, but the product is on-premise and predates the smartphone era. Lattice positions as the SaaS replacement.',
            sources: [
              { title: 'Cropsifter customer list', url: null, tier: 'tier_2' },
            ],
          },
        ],
        contradictions: [],
        competitive_map: {
          named_by_company: [
            { name: 'Cropsifter', note: 'Mentioned as a legacy on-premise competitor.' },
          ],
          named_by_research: [
            { name: 'AgriTech Pro', rationale: 'Smaller LatAm SaaS in adjacent space (single-farm management).', sources: [] },
          ],
        },
        founder_dossiers: [
          {
            founder_name: 'Marisol Vega',
            role: 'CEO & Co-founder',
            background_summary: 'McKinsey Bogota office 2018-2022, agribusiness practice. Born in Antioquia, family runs a coffee farm. Wharton MBA 2020.',
            sources: [{ title: 'McKinsey alumni directory', url: null }],
            open_questions: ['Why leave McKinsey?', 'How is the family farm connected to Lattice — pilot customer?'],
          },
        ],
        research_gaps: [
          { topic: 'Co-op concentration in top 3 customers', rationale: '62% concentration is high. If any of the three churns, ARR drops materially.', criticality: 'blocker' },
          { topic: 'FX strategy', rationale: 'Co-ops pay in MXN/COP, deck quotes ARR in USD. Need to understand pricing model.', criticality: 'important' },
        ],
        research_mode: 'no_web_search',
      },
      // qa_answers populated as Q&A continues. memo_draft_output not yet built.
    },
    attention: [
      { kind: 'data_room_gap', urgency: 'must_address',   body: 'No financial model uploaded. Required for unit-economics evaluation.', status: 'open' },
      { kind: 'unverified_material_claim', urgency: 'should_address', body: 'Top-3 concentration of 62% is high — material risk if any single co-op churns.', status: 'open' },
    ],
  },

  {
    name: 'Riverstone',
    sector: 'Fintech',
    stage_at_consideration: 'Seed',
    deal_status: 'active',
    current_memo_stage: 'not_started',
    notes_summary: 'Just received deck. Schedule first call before kicking off agent.',
    documents: [
      { file_name: 'Riverstone teaser.pdf',  file_format: 'pdf', file_size_bytes: 1_200_000, detected_type: 'pitch_deck', type_confidence: 'medium', parse_status: 'pending' },
    ],
    notes: ['Cold inbound via the public submission form. Founder mentions $80K ARR, B2B credit-decisioning API. Not yet read in full.'],
  },
]

export async function seedDiligence(
  admin: Admin,
  fundId: string,
  demoUserId: string,
): Promise<{ dealIdMap: Record<string, string> }> {
  const dealIdMap: Record<string, string> = {}

  for (const def of DEALS) {
    const { data: deal } = await admin
      .from('diligence_deals')
      .insert({
        fund_id: fundId,
        name: def.name,
        sector: def.sector,
        stage_at_consideration: def.stage_at_consideration,
        deal_status: def.deal_status,
        current_memo_stage: def.current_memo_stage,
        notes_summary: def.notes_summary,
        created_by: demoUserId,
      } as any)
      .select('id')
      .single()
    if (!deal) continue
    const dealId = (deal as any).id as string
    dealIdMap[def.name] = dealId

    // Documents.
    for (const docDef of def.documents) {
      await admin.from('diligence_documents').insert({
        deal_id: dealId,
        fund_id: fundId,
        storage_path: `${dealId}/demo_${docDef.file_name}`,
        file_name: docDef.file_name,
        file_format: docDef.file_format,
        file_size_bytes: docDef.file_size_bytes,
        detected_type: docDef.detected_type,
        type_confidence: docDef.type_confidence,
        parse_status: docDef.parse_status,
        uploaded_by: demoUserId,
      } as any)
    }

    // Draft (if any).
    let draftId: string | null = null
    if (def.draft) {
      const { data: draft } = await admin
        .from('diligence_memo_drafts')
        .insert({
          deal_id: dealId,
          fund_id: fundId,
          draft_version: def.draft.draft_version,
          agent_version: def.draft.agent_version,
          is_draft: def.draft.is_draft,
          ingestion_output: def.draft.ingestion_output as any,
          research_output: (def.draft.research_output ?? null) as any,
          qa_answers: (def.draft.qa_answers ?? null) as any,
          memo_draft_output: (def.draft.memo_draft_output ?? null) as any,
          created_by: demoUserId,
        } as any)
        .select('id')
        .single()
      if (draft) draftId = (draft as any).id
    }

    // Attention items.
    if (def.attention && def.attention.length > 0) {
      const rows = def.attention.map(a => ({
        deal_id: dealId,
        draft_id: draftId,
        fund_id: fundId,
        kind: a.kind,
        urgency: a.urgency,
        body: a.body,
        links: [] as any,
        status: a.status,
      }))
      await admin.from('diligence_attention_items').insert(rows as any)
    }

    // Notes.
    if (def.notes && def.notes.length > 0) {
      for (const note of def.notes) {
        await admin.from('diligence_notes').insert({
          deal_id: dealId,
          fund_id: fundId,
          body: note,
          author_id: demoUserId,
        } as any)
      }
    }
  }

  return { dealIdMap }
}
