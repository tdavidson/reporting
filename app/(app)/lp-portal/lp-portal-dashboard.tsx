'use client'

import { LpAccessSettings } from '@/components/lp-access-settings'
import { LpDocumentsSettings } from '@/components/lp-documents-settings'
import { LpOnboardingSettings } from '@/components/lp-onboarding-settings'
import { LpMessagesSection } from '@/components/lp-messages-section'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </div>
      {children}
    </section>
  )
}

export function LpPortalDashboard() {
  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <AnalystToggleButton />
      </div>
      <p className="text-sm text-muted-foreground mb-8">
        Manage everything your investors see in their portal.
      </p>

      {/* Content and the Analyst side by side at lg, as on every other page with the panel. */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
      <div className="space-y-10 flex-1 min-w-0 w-full">
        <Section title="Access" description="Invite LPs and their authorized users, in bulk from a pasted sheet, or one at a time. Investors are matched by name; new ones are created.">
          <LpAccessSettings />
        </Section>
        <Section title="Onboarding" description="What each LP entity owes before, and after, admission: executed subscription documents, tax forms, KYC. LPs upload through their portal; you review here.">
          <LpOnboardingSettings />
        </Section>
        <Section title="Documents">
          <LpDocumentsSettings />
        </Section>
        <LpMessagesSection />
      </div>

      <AnalystPanel />
      </div>
    </div>
  )
}
