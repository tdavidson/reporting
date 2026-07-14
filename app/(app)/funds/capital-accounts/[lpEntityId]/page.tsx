import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireAccountingAccess } from '../../guard'
import { LpStatementView } from './view'

export const metadata: Metadata = { title: 'LP capital statement' }

export default async function LpStatementPage({ params }: { params: { lpEntityId: string } }) {
  await requireAccountingAccess()
  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <Link href="/funds/capital-accounts" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />Capital accounts
      </Link>
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">LP capital statement</h1>
      </div>
      <LpStatementView lpEntityId={params.lpEntityId} />
    </div>
  )
}
