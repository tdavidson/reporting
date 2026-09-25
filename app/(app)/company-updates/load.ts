import type { PageContext } from '@/lib/pages/context'

export interface CompanyUpdatesPageData {
  companies: Array<{ id: string; name: string }>
}

export async function loadCompanyUpdatesPage({ admin, page }: PageContext): Promise<CompanyUpdatesPageData> {
  const { data: companies } = await admin
    .from('companies')
    .select('id, name')
    .eq('fund_id', page.fundId)
    .eq('holding_type', 'company')
    .order('name') as { data: Array<{ id: string; name: string }> | null }
  return { companies: companies ?? [] }
}
