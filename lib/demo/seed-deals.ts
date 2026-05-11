import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

interface InboundDealDef {
  // Backing email
  from_email: string
  from_name: string
  subject: string
  body_text: string
  days_ago: number
  // Routing classifier output
  routing_label: 'reporting' | 'interactions' | 'deals' | 'other'
  routing_confidence: number
  routing_reasoning: string
  // Deal record
  company_name: string
  company_url: string | null
  company_domain: string | null
  founder_name: string
  founder_email: string
  co_founders?: Array<{ name: string; email?: string; role?: string }>
  intro_source: 'referral' | 'cold' | 'warm_intro' | 'accelerator' | 'demo_day' | 'event' | 'other'
  referrer_name?: string
  referrer_email?: string
  stage: string
  industry: string
  raise_amount: string
  company_summary: string
  thesis_fit_analysis: string
  thesis_fit_score: 'strong' | 'moderate' | 'weak' | 'out_of_thesis'
  status: 'new' | 'reviewing' | 'passed' | 'advancing' | 'met' | 'archived'
}

const INBOUND_DEALS: InboundDealDef[] = [
  {
    from_email: 'alex@stellate.dev',
    from_name: 'Alex Chen',
    subject: 'Stellate — edge caching for SaaS databases ($1.2M ARR, raising Series A)',
    body_text: `Hi Hemrock team,

Reaching out about Stellate, a developer infrastructure startup I founded with two ex-Vercel engineers. We help SaaS teams cut their cloud bill by 30-40% via real-time edge caching of database queries.

Quick numbers:
- $1.2M ARR, growing 25% MoM
- 47 paying customers (Notion, Linear, and 45 others)
- Net revenue retention: 138%
- Gross margin: 81%
- 9 FTEs, $400K/mo burn

We're raising $5M Series A at a $45M post led by Sequoia. Looking for thoughtful infrastructure-focused capital to fill out the round. Would love to chat.

— Alex Chen, CEO & Co-founder
alex@stellate.dev | https://stellate.dev`,
    days_ago: 2,
    routing_label: 'deals',
    routing_confidence: 0.94,
    routing_reasoning: 'Cold outreach pitching the fund with company metrics, raise size, and lead investor named.',
    company_name: 'Stellate',
    company_url: 'https://stellate.dev',
    company_domain: 'stellate.dev',
    founder_name: 'Alex Chen',
    founder_email: 'alex@stellate.dev',
    co_founders: [
      { name: 'Priya Mehta', email: 'priya@stellate.dev', role: 'CTO' },
      { name: 'Devon Rhodes', email: 'devon@stellate.dev', role: 'VP Engineering' },
    ],
    intro_source: 'cold',
    stage: 'Series A',
    industry: 'Developer infrastructure',
    raise_amount: '$5M @ $45M post',
    company_summary: 'Stellate is a developer-infrastructure SaaS that caches database query results at edge POPs to cut SaaS application cloud bills by 30-40%. The team is 9 FTEs, all ex-Vercel/Cloudflare. They claim $1.2M ARR with 25% MoM growth, 138% NRR, and 47 paying customers including Notion and Linear. Burning $400K/mo with 18 months of runway pre-raise.',
    thesis_fit_analysis: `Aligns strongly with two of the three thesis pillars (developer-tools focus and instrumentation-heavy products with measurable cost savings); the third pillar (vertical SaaS) is not a fit and the team is candid about that.

Pillar 1 — Developer infrastructure: Strong. Founders are well-credentialed (ex-Vercel, ex-Cloudflare). Product addresses a clearly-quantified pain point (cloud bills). Customer logos suggest the buyer persona is engineering leadership at high-growth SaaS, which matches our typical comparable companies (e.g. PlanetScale, Upstash).

Pillar 2 — Verifiable traction: Strong. 25% MoM revenue growth at $1.2M ARR is unusual; if true it implies $4M+ ARR exit by next year. NRR of 138% is high. We should verify against Stripe data (open question for diligence).

Pillar 3 — Vertical SaaS: Out of thesis as a horizontal infra play, but the founder mentions explicit vertical packaging in retail and fintech. Worth probing in Q&A.

Disqualifiers: None visible from the email alone. Series A round is led by a top-tier co-investor (Sequoia), so we'd be filling out the round rather than leading.

Open questions: revenue concentration in top 10 customers, retention of those NRR numbers when they hit $5M+ ARR, churn cohort behavior, why the existing investors aren't taking the full round.`,
    thesis_fit_score: 'strong',
    status: 'reviewing',
  },
  {
    from_email: 'grace@northpole-energy.io',
    from_name: 'Grace Okonkwo',
    subject: 'Intro from Bob Smith: NorthPole Energy — grid-scale flow batteries',
    body_text: `Hi —

Bob Smith from Acme Capital suggested I reach out. He's been advising us informally for the past year and thought our deal would resonate with your thesis.

NorthPole Energy is building modular zinc-bromine flow batteries for utility-scale grid storage. We're 18 months into a $4M seed (led by Energy Impact Partners) and now raising a $20M Series A to scale our pilot deployment with a Texas utility.

Happy to share the deck. Let me know if there's interest.

Best,
Grace Okonkwo
Co-founder & CEO, NorthPole Energy
grace@northpole-energy.io`,
    days_ago: 5,
    routing_label: 'deals',
    routing_confidence: 0.91,
    routing_reasoning: 'Pitch with explicit referrer mention and round details.',
    company_name: 'NorthPole Energy',
    company_url: 'https://northpole-energy.io',
    company_domain: 'northpole-energy.io',
    founder_name: 'Grace Okonkwo',
    founder_email: 'grace@northpole-energy.io',
    intro_source: 'warm_intro',
    referrer_name: 'Bob Smith',
    referrer_email: 'bob@acmecap.example',
    stage: 'Series A',
    industry: 'Climate / Energy storage',
    raise_amount: '$20M Series A',
    company_summary: 'NorthPole Energy builds modular zinc-bromine flow batteries for utility-scale grid storage. 18 months into operation. One pilot deployment underway with a Texas utility. Existing $4M seed led by Energy Impact Partners. Raising $20M Series A to scale.',
    thesis_fit_analysis: `Climate hardware sits outside our software-only thesis. The team and credentials look strong from the email alone, but the capital efficiency and time-to-revenue profile of a grid-scale hardware company is fundamentally different from what we underwrite.

Pillar 1 — Software-first: Out of thesis. Hardware capex.
Pillar 2 — 12-18 month time to revenue: Out of thesis. Grid deployments take 3-5 years.
Pillar 3 — Capital efficient: Out of thesis. $20M Series A on a single pilot is a structural commitment; the next round will likely be $50M+.

Disqualifiers: capital intensity, hardware risk, regulatory dependency. Nothing wrong with the company, just not for us.`,
    thesis_fit_score: 'out_of_thesis',
    status: 'archived',
  },
  {
    from_email: 'partner@hemrock.com',
    from_name: 'Hemrock Partner',
    subject: 'Fwd: pitch — Lattice (vertical SaaS for ag co-ops)',
    body_text: `Forwarded from a founder I met at the 4P conference.

---------- Forwarded message ----------
From: Marisol Vega <marisol@latticeag.com>
Subject: Lattice — operating system for ag co-ops

Hemrock Partner —

Met you at 4P last week. As discussed, sending over the deck for Lattice. We're building the operating system for agricultural co-ops in Latin America — currently $480K ARR across 14 co-ops in Mexico and Colombia, growing 18% MoM.

Founders are myself (ex-McKinsey, grew up on a coffee farm) and Tomás (ex-Globant, built the original platform). We're raising a $3M seed.

— Marisol`,
    days_ago: 8,
    routing_label: 'deals',
    routing_confidence: 0.88,
    routing_reasoning: 'Partner-forwarded pitch from a conference contact; contains pitch content rather than internal CRM notes.',
    company_name: 'Lattice',
    company_url: 'https://latticeag.com',
    company_domain: 'latticeag.com',
    founder_name: 'Marisol Vega',
    founder_email: 'marisol@latticeag.com',
    co_founders: [{ name: 'Tomás Aguirre', email: 'tomas@latticeag.com', role: 'CTO' }],
    intro_source: 'event',
    referrer_name: 'Hemrock Partner',
    stage: 'Seed',
    industry: 'Vertical SaaS / Agriculture',
    raise_amount: '$3M Seed',
    company_summary: 'Lattice is a vertical SaaS for agricultural co-operatives in Latin America. $480K ARR across 14 co-ops in Mexico and Colombia, growing 18% MoM. Founder Marisol Vega is ex-McKinsey with grew-up-on-a-coffee-farm context; co-founder Tomás Aguirre is ex-Globant.',
    thesis_fit_analysis: `Vertical SaaS in an emerging market — squarely on thesis if traction and unit economics hold up.

Pillar 1 — Vertical SaaS: Strong. Co-ops are an underserved buyer with consolidated decision-making and high switching costs.
Pillar 2 — Verifiable traction: Moderate. $480K ARR is early but 18% MoM is fast; need to verify GMV through co-op concentration.
Pillar 3 — Founder-market fit: Strong. Marisol has the rare combination of operator background and lived domain context.

Disqualifiers: LatAm market means USD-revenue concentration risk and FX exposure; need to understand how they price.

Open questions: customer concentration in top 3 co-ops, how Lattice differentiates from existing co-op management software (e.g. Cropsifter), unit economics on the freemium tier.`,
    thesis_fit_score: 'strong',
    status: 'advancing',
  },
  {
    from_email: 'jordan@finchapp.io',
    from_name: 'Jordan Bell',
    subject: 'Quick intro — Finch (consumer mental health app, $200K MRR)',
    body_text: `Hi,

Hope this lands well. Finch is a B2C mental health app — gamified self-care, daily check-ins, and a virtual pet that grows as users build habits. We're at $200K MRR after 14 months, growing 8% MoM, mostly App Store organic.

Raising $4M seed extension to fund retention experiments. Would love to hear if this is up your alley.

— Jordan Bell, Founder
jordan@finchapp.io`,
    days_ago: 12,
    routing_label: 'deals',
    routing_confidence: 0.92,
    routing_reasoning: 'Cold pitch with metrics and raise; B2C consumer.',
    company_name: 'Finch',
    company_url: 'https://finchapp.io',
    company_domain: 'finchapp.io',
    founder_name: 'Jordan Bell',
    founder_email: 'jordan@finchapp.io',
    intro_source: 'cold',
    stage: 'Seed extension',
    industry: 'Consumer / Mental health',
    raise_amount: '$4M seed extension',
    company_summary: 'Finch is a B2C mobile mental-health app with a gamified daily check-in and a virtual pet retention loop. $200K MRR, 14 months in, 8% MoM growth from App Store organic. Single-founder company. Raising a $4M seed extension.',
    thesis_fit_analysis: `B2C consumer is out of our default thesis but the unit economics here look unusually clean for a category that usually flames out post-launch.

Pillar 1 — B2B/SaaS: Out of thesis (B2C subscription).
Pillar 2 — Growth quality: Moderate. 8% MoM organic is real but App Store organic concentration is a single point of failure.
Pillar 3 — Defensibility: Weak. The "virtual pet retention loop" is interesting but not durable IP.

Disqualifiers: consumer subscription churn dynamics, App Store dependency, single-founder for a Series A trajectory.

Open questions: Day-30 / Day-90 retention by cohort, paid-vs-organic mix, founder's plan for the second hire.`,
    thesis_fit_score: 'weak',
    status: 'passed',
  },
  {
    from_email: 'recruit@stafftech.example',
    from_name: 'StaffTech Recruiting',
    subject: 'We have engineering candidates for your portfolio companies',
    body_text: `Hi there,

We're a recruiting agency specializing in placing senior engineers at fast-growing startups. We have a roster of 40+ vetted candidates and would love to share them with your portfolio.

Our standard fee is 25% of first-year salary.

Please reply if interested.

— StaffTech Recruiting Team`,
    days_ago: 4,
    routing_label: 'other',
    routing_confidence: 0.97,
    routing_reasoning: 'Vendor solicitation, not a deal pitch or portfolio update.',
    // Will not produce a deal row — this is for the audit log
    company_name: '',
    company_url: null,
    company_domain: null,
    founder_name: '',
    founder_email: '',
    intro_source: 'cold',
    stage: '',
    industry: '',
    raise_amount: '',
    company_summary: '',
    thesis_fit_analysis: '',
    thesis_fit_score: 'out_of_thesis',
    status: 'archived',
  },
  {
    from_email: 'kai@haptiq.dev',
    from_name: 'Kai Tanaka',
    subject: 'Haptiq — multimodal feedback API for fintech (raising $2.5M)',
    body_text: `Hello Hemrock,

Spinning out of a stealth incubator next month. Haptiq is a multimodal feedback API — fintech apps drop in our SDK and get haptic, audio, and visual confirmation primitives that have been A/B tested for transaction confidence.

3 design partners signed (Mercury, Brex, and a stealth bank). $0 ARR but contracts inked. Raising $2.5M pre-seed.

Quick call?

— Kai Tanaka, Founder
kai@haptiq.dev`,
    days_ago: 1,
    routing_label: 'deals',
    routing_confidence: 0.85,
    routing_reasoning: 'Cold pitch, pre-revenue, design-partner signal.',
    company_name: 'Haptiq',
    company_url: 'https://haptiq.dev',
    company_domain: 'haptiq.dev',
    founder_name: 'Kai Tanaka',
    founder_email: 'kai@haptiq.dev',
    intro_source: 'cold',
    stage: 'Pre-seed',
    industry: 'Fintech infrastructure',
    raise_amount: '$2.5M pre-seed',
    company_summary: 'Haptiq is a pre-revenue developer infrastructure company with a multimodal feedback SDK for fintech apps. 3 design-partner contracts (Mercury, Brex, undisclosed bank) but no recognized revenue yet. Solo founder spinning out of a stealth incubator. Raising $2.5M pre-seed.',
    thesis_fit_analysis: `Pre-revenue, single-founder, design-partner-only — too early for our typical entry point.

Pillar 1 — Developer infrastructure: Aligned in product shape.
Pillar 2 — Verifiable traction: Weak. Design partners are not paying customers; conversion to paid is the real question.
Pillar 3 — Capital efficiency: Unclear. $2.5M for a pre-seed with three large enterprise design partners is plausible, but the implied runway is short for an enterprise sales motion.

Disqualifiers: stage (we typically wait for $500K+ ARR), single-founder for an infra play.

Open questions: founder background, why solo, design-partner contract terms (purchase commitment vs. evaluation), competitive landscape (does anyone else ship this primitive?).`,
    thesis_fit_score: 'moderate',
    status: 'new',
  },
]

export async function seedInboundDeals(
  admin: Admin,
  fundId: string,
  demoUserId: string,
): Promise<{ inboundEmailIdMap: Record<string, string>; dealIdMap: Record<string, string> }> {
  const inboundEmailIdMap: Record<string, string> = {}
  const dealIdMap: Record<string, string> = {}

  for (const def of INBOUND_DEALS) {
    const receivedAt = new Date(Date.now() - def.days_ago * 86400000).toISOString()

    // Insert the backing email row.
    const { data: email } = await admin
      .from('inbound_emails')
      .insert({
        fund_id: fundId,
        from_address: def.from_email,
        subject: def.subject,
        received_at: receivedAt,
        processing_status: def.routing_label === 'other' ? 'not_processed' : 'success',
        metrics_extracted: 0,
        attachments_count: 0,
        routing_label: def.routing_label,
        routing_confidence: def.routing_confidence,
        routing_reasoning: def.routing_reasoning,
        routed_to: def.routing_label === 'other' ? 'audit' : 'deals',
        raw_payload: {
          From: def.from_email,
          FromFull: { Email: def.from_email, Name: def.from_name },
          To: 'reports@hemrock-demo.com',
          Subject: def.subject,
          TextBody: def.body_text,
        } as any,
      })
      .select('id')
      .single()

    if (!email) continue
    inboundEmailIdMap[def.from_email] = (email as any).id

    // For 'other'-labeled emails, no deal row.
    if (def.routing_label === 'other') continue

    // Insert the deal row.
    const { data: deal } = await admin
      .from('inbound_deals')
      .insert({
        fund_id: fundId,
        email_id: (email as any).id,
        company_name: def.company_name,
        company_url: def.company_url,
        company_domain: def.company_domain,
        founder_name: def.founder_name,
        founder_email: def.founder_email,
        co_founders: (def.co_founders ?? []) as any,
        intro_source: def.intro_source,
        referrer_name: def.referrer_name ?? null,
        referrer_email: def.referrer_email ?? null,
        stage: def.stage,
        industry: def.industry,
        raise_amount: def.raise_amount,
        company_summary: def.company_summary,
        thesis_fit_analysis: def.thesis_fit_analysis,
        thesis_fit_score: def.thesis_fit_score,
        status: def.status,
      } as any)
      .select('id')
      .single()

    if (deal) dealIdMap[def.company_name] = (deal as any).id
  }

  // Add a couple of known referrers so the Settings page isn't empty.
  await admin.from('known_referrers').insert([
    {
      fund_id: fundId,
      email: 'bob@acmecap.example',
      name: 'Bob Smith (Acme Capital)',
      notes: 'YC partner, sent us NorthPole. Good signal generally.',
      added_by: demoUserId,
    },
    {
      fund_id: fundId,
      email: 'scout@founderfwd.example',
      name: 'Founder Forward Scout',
      notes: 'Forwards 2-3 deals/quarter. Decent quality.',
      added_by: demoUserId,
    },
  ] as any)

  return { inboundEmailIdMap, dealIdMap }
}

// Default thesis + screening prompt for the demo fund so the Deal Screening
// settings page has populated values.
export const DEMO_DEAL_THESIS = `Hemrock Ventures invests at Seed and Series A in:

1. **Developer infrastructure and B2B SaaS** with measurable, technical-buyer-validated value. We like products where engineering leadership is the buyer and the cost-of-not-using-the-product is quantifiable in $ saved or $ unlocked.
2. **Vertical SaaS** for underserved buyer types (cooperatives, mid-market trades, regulated niches) where the workflow is sticky and the buyer is consolidated. Bonus for emerging-markets founders with deep domain context.
3. **Instrumentation and analytics** for above categories where the data exhaust becomes the moat.

We avoid:
- Pure B2C / consumer subscription apps without an enterprise wedge
- Hardware, biotech, deep tech with multi-year time-to-revenue
- Crypto, defense, regulated platforms

Check size: $1-3M Seed lead, $1-2M Series A follow-on. We co-invest happily; we don't price-lead Series B and beyond.

Founders we back: technical operators with deep domain context, ideally from a category-defining incumbent (e.g. ex-Vercel for infra, ex-McKinsey-with-domain for vertical SaaS).`
