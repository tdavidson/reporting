import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { createFundAIProvider } from '@/lib/ai'
import { logAIUsage } from '@/lib/ai/usage'
import { aggregatePortfolioData } from '@/lib/lp-letters/aggregate'
import { buildPortfolioTableHtml, generateAllNarratives, assembleFullDraft } from '@/lib/lp-letters/generate'
import { DEFAULT_STYLE_GUIDE } from '@/lib/lp-letters/default-template'
import { logActivity } from '@/lib/activity'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  const { fundId } = writeCheck

  const limited = await rateLimit({ key: `lp-letter-gen:${user.id}`, limit: 5, windowSeconds: 300 })
  if (limited) return limited

  // Get the letter
  const { data: letter } = await admin
    .from('lp_letters')
    .select('*')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()

  if (!letter) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Get the template style guide
  let styleGuide = DEFAULT_STYLE_GUIDE
  if (letter.template_id) {
    const { data: template } = await admin
      .from('lp_letter_templates')
      .select('style_guide')
      .eq('id', letter.template_id)
      .maybeSingle()
    if (template?.style_guide) styleGuide = template.style_guide
  }

  // Set status to generating, clear any previous error
  await admin
    .from('lp_letters')
    .update({ status: 'generating', generation_error: null, updated_at: new Date().toISOString() })
    .eq('id', params.id)

  try {
    // Aggregate data
    const preview = await aggregatePortfolioData(
      admin, fundId,
      letter.period_year, letter.period_quarter,
      letter.portfolio_group, letter.is_year_end
    )

    // Build portfolio table
    const portfolioTableHtml = buildPortfolioTableHtml(preview)

    // Generate narratives
    const { provider, model, providerType } = await createFundAIProvider(admin, fundId)
    const companyPrompts = (letter.company_prompts && typeof letter.company_prompts === 'object')
      ? letter.company_prompts as Record<string, { prompt: string; mode: 'add' | 'replace' }>
      : null
    const { narratives, totalUsage } = await generateAllNarratives(
      provider, model, preview, styleGuide, letter.generation_prompt, companyPrompts
    )

    // Assemble full draft
    const fullDraft = assembleFullDraft(preview, portfolioTableHtml, narratives, preview.fundCurrency)

    // Store portfolio summary for export (avoids recalculating from transactions)
    const portfolioSummary = preview.companies.map(c => ({
      company_id: c.investment.companyId,
      company_name: c.investment.companyName,
      status: c.investment.status,
      stage: c.investment.stage,
      total_invested: c.investment.totalInvested,
      fmv: c.investment.fmv,
      moic: c.investment.moic,
    }))

    // Save
    await admin
      .from('lp_letters')
      .update({
        portfolio_table_html: portfolioTableHtml,
        company_narratives: narratives as any,
        full_draft: fullDraft,
        portfolio_summary: portfolioSummary as any,
        status: 'draft',
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)

    // Log usage
    await logAIUsage(admin, {
      fundId,
      userId: user.id,
      provider: providerType,
      model,
      feature: 'lp-letter-generation',
      usage: totalUsage,
    })

    logActivity(admin, fundId, user.id, 'lp-letter.generate', {
      letterId: params.id,
      periodLabel: letter.period_label,
      companiesCount: narratives.length,
    })

    // Return updated letter
    const { data: updated } = await admin
      .from('lp_letters')
      .select('*')
      .eq('id', params.id)
      .single()

    return NextResponse.json(updated)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Generation failed'
    // Revert status on failure, store the error
    await admin
      .from('lp_letters')
      .update({ status: 'draft', generation_error: errorMessage, updated_at: new Date().toISOString() })
      .eq('id', params.id)

    console.error('[lp-letters] Generation failed:', err)
    return NextResponse.json({ error: 'Letter generation failed. Please try again.' }, { status: 500 })
  }
}
