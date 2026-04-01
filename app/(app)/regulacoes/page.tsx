import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RegulacoesBRClient } from './regulacoes-client'

export const metadata: Metadata = { title: 'BR Regulations' }

export default async function RegulacoesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')
  return <RegulacoesBRClient />
}
