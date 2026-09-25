import type { ComponentProps } from 'react'
import type { PageContext } from '@/lib/pages/context'
import type { InteractionsContent } from './interactions-content'

export type InteractionsPageData = Pick<ComponentProps<typeof InteractionsContent>, 'interactions'>

/** The latest hundred interactions with the company name attached to each. */
export async function loadInteractionsPage({ admin, page }: PageContext): Promise<InteractionsPageData> {
  const { data: interactions } = await admin
    .from('interactions')
    .select('id, fund_id, company_id, email_id, user_id, tags, subject, summary, intro_contacts, body_preview, interaction_date, created_at')
    .eq('fund_id', page.fundId)
    .order('interaction_date', { ascending: false })
    .limit(100)

  // Batch-load company names
  const companyIds = Array.from(new Set((interactions ?? []).map((i: any) => i.company_id).filter(Boolean))) as string[]
  const companyNameMap: Record<string, string> = {}
  if (companyIds.length > 0) {
    const { data: companies } = await admin
      .from('companies')
      .select('id, name')
      .in('id', companyIds) as { data: { id: string; name: string }[] | null }
    for (const c of companies ?? []) {
      companyNameMap[c.id] = c.name
    }
  }

  const enriched = (interactions ?? []).map((i: any) => ({
    ...i,
    company_name: i.company_id ? companyNameMap[i.company_id] ?? null : null,
  }))
  return { interactions: enriched }
}
