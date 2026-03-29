import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BenchmarkingClient } from './benchmarking-client'

export const metadata: Metadata = { title: 'Benchmarking' }

export default async function BenchmarkingPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')
  return <BenchmarkingClient />
}
