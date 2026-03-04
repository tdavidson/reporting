'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Users, Mail, ChevronDown, ChevronRight } from 'lucide-react'

interface IntroContact {
  name: string
  email?: string
  context: string
}

interface Interaction {
  id: string
  type: string
  subject: string | null
  summary: string | null
  intro_contacts: IntroContact[] | null
  interaction_date: string
}

function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function CompanyInteractions({ companyId }: { companyId: string }) {
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/companies/${companyId}/interactions?limit=5`)
      .then(res => res.json())
      .then(data => {
        setInteractions(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [companyId])

  if (loading) {
    return (
      <div className="mt-6">
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Recent Interactions</h2>
        <p className="text-xs text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (interactions.length === 0) return null

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-muted-foreground">Recent Interactions</h2>
        <Link
          href={`/interactions?company_id=${companyId}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          View all
        </Link>
      </div>

      <div className="space-y-1.5">
        {interactions.map(interaction => {
          const introContacts = interaction.intro_contacts ?? []
          const isExpanded = expandedId === interaction.id
          const hasIntros = introContacts.length > 0

          return (
            <div
              key={interaction.id}
              className={`border rounded-md p-2.5 text-sm ${
                interaction.type === 'intro'
                  ? 'border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-900/10'
                  : ''
              }`}
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {interaction.type === 'intro' ? (
                  <Users className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                ) : (
                  <Mail className="h-3 w-3" />
                )}
                <span>{formatRelativeTime(interaction.interaction_date)}</span>
                {interaction.type === 'intro' && (
                  <span className="text-amber-600 dark:text-amber-400 font-medium">Intro</span>
                )}
              </div>

              {interaction.subject && (
                <p className="font-medium mt-0.5 truncate">{interaction.subject}</p>
              )}

              {interaction.summary && (
                <p className="text-muted-foreground mt-0.5 line-clamp-2">{interaction.summary}</p>
              )}

              {hasIntros && (
                <>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : interaction.id)}
                    className="flex items-center gap-1 mt-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {introContacts.length} contact{introContacts.length !== 1 ? 's' : ''} introduced
                  </button>

                  {isExpanded && (
                    <div className="mt-1.5 pl-3 border-l-2 border-amber-200 dark:border-amber-800 space-y-1">
                      {introContacts.map((contact, idx) => (
                        <div key={idx} className="text-xs">
                          <span className="font-medium">{contact.name}</span>
                          {contact.context && (
                            <span className="text-muted-foreground"> — {contact.context}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
