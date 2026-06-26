'use client'

import { useState } from 'react'
import { EmailAuditList, type AuditEmail } from './email-audit-list'
import { RoutingAccuracyView } from './routing-accuracy-view'

export function EmailRoutingTabs({ emails, accuracy }: {
  emails: AuditEmail[]
  accuracy: { totalsByOriginal: Record<string, number>; weekly: Array<{ wk: string; flips: Array<[string, number]>; total: number }> }
}) {
  const [tab, setTab] = useState<'audit' | 'accuracy'>('audit')

  return (
    <div>
      <div className="flex gap-1 border-b mb-6">
        <TabButton active={tab === 'audit'} onClick={() => setTab('audit')}>
          Audit queue{emails.length > 0 && <span className="ml-1.5 text-xs bg-muted rounded-full px-1.5 py-0.5 text-muted-foreground">{emails.length}</span>}
        </TabButton>
        <TabButton active={tab === 'accuracy'} onClick={() => setTab('accuracy')}>Accuracy</TabButton>
      </div>

      {tab === 'audit' ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Inbound emails the classifier labelled &ldquo;other&rdquo; — newsletters, vendor pitches, auto-replies. Use Reroute on any row to recover an email that was wrongly dropped.
          </p>
          <EmailAuditList emails={emails} />
        </div>
      ) : (
        <RoutingAccuracyView totalsByOriginal={accuracy.totalsByOriginal} weekly={accuracy.weekly} />
      )}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${active ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
    >
      {children}
    </button>
  )
}
