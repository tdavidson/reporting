import { createAdminClient } from '@/lib/supabase/admin'

type Supabase = ReturnType<typeof createAdminClient>

export interface FundMemberResult {
  user_id: string
  member_role: string
}

export async function checkFundMember(
  supabase: Supabase,
  fundId: string,
  fromAddress: string
): Promise<FundMemberResult | null> {
  const { data } = await supabase.rpc('is_fund_member_by_email', {
    p_fund_id: fundId,
    p_email: fromAddress,
  })

  const row = (data as FundMemberResult[] | null)?.[0]
  return row ?? null
}
