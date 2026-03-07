'use client'

import { useState, useEffect } from 'react'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'
import { PortfolioNotesProvider, PortfolioNotesButton, PortfolioNotesPanel } from '@/components/portfolio-notes'
import { useFeatureVisibility } from '@/components/feature-visibility-context'
import { Lock } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { RelationshipsList } from './relationships-list'

interface Interaction {
  id: string
  fund_id: string
  company_id: string | null
  email_id: string | null
  user_id: string
  tags: string[]
  subject: string | null
  summary: string | null
  intro_contacts: any
  body_preview: string | null
  interaction_date: string
  created_at: string
  company_name: string | null
}

export function InteractionsContent({ interactions }: { interactions: Interaction[] }) {
  const fv = useFeatureVisibility()
  const [inboundAddress, setInboundAddress] = useState('')

  useEffect(() => {
    fetch('/api/settings').then(r => r.ok ? r.json() : null).then(s => {
      if (s?.postmarkInboundAddress) setInboundAddress(s.postmarkInboundAddress)
    }).catch(() => {})
  }, [])

  return (
    <PortfolioNotesProvider>
      <div className="p-4 md:py-8 md:pl-8 md:pr-4">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">{fv.interactions === 'admin' && <Lock className="h-4 w-4 text-amber-500" />}Interactions</h1>
          <div className="flex items-center gap-2">
            <PortfolioNotesButton />
            <AnalystToggleButton />
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <div className="flex-1 min-w-0 w-full max-w-5xl">
            <RelationshipsList interactions={interactions} inboundAddress={inboundAddress} />
          </div>
          <PortfolioNotesPanel />
          <AnalystPanel />
        </div>
      </div>
    </PortfolioNotesProvider>
  )
}
