'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Building2, ChevronDown, ChevronRight, Copy, Check, Mail, Users } from 'lucide-react'

interface IntroContact {
  name: string
  email?: string
  context: string
}

interface Interaction {
  id: string
  fund_id: string
  company_id: string | null
  email_id: string | null
  user_id: string
  type: string
  subject: string | null
  summary: string | null
  intro_contacts: IntroContact[] | null
  body_preview: string | null
  interaction_date: string
  created_at: string
  company_name: string | null
}

type FilterMode = 'all' | 'intros'

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

export function RelationshipsList({ interactions, inboundAddress }: { interactions: Interaction[]; inboundAddress?: string }) {
  const [filter, setFilter] = useState<FilterMode>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const filtered = filter === 'intros'
    ? interactions.filter(i => i.type === 'intro')
    : interactions

  return (
    <div>
      {/* Filter tabs + inbound address */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {(['all', 'intros'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              filter === f
                ? 'bg-foreground text-background font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            {f === 'all' ? 'All' : 'Intros'}
          </button>
        ))}
        {inboundAddress && (
          <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>BCC:</span>
            <code className="bg-muted px-2 py-1 rounded text-[11px]">{inboundAddress}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(inboundAddress)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              className="hover:text-foreground transition-colors"
              title="Copy to clipboard"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Mail className="h-8 w-8 mx-auto mb-3 opacity-50" />
          <p className="text-sm font-medium mb-1">No interactions yet</p>
          <p className="text-xs max-w-md mx-auto">
            BCC your fund&apos;s inbound email address on conversations with portfolio companies.
            The system will automatically log them here with AI-generated summaries.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map(interaction => {
            const introContacts = interaction.intro_contacts ?? []
            const isExpanded = expandedId === interaction.id
            const hasIntros = introContacts.length > 0

            return (
              <div
                key={interaction.id}
                className="border rounded-lg p-3 hover:bg-accent/30 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(interaction.interaction_date)}
                      </span>
                      {interaction.company_name && (
                        <Link
                          href={`/companies/${interaction.company_id}`}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Building2 className="h-3 w-3" />
                          {interaction.company_name}
                        </Link>
                      )}
                      {interaction.type === 'intro' && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-medium">
                          <Users className="h-2.5 w-2.5" />
                          {introContacts.length} intro{introContacts.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    {interaction.subject && (
                      <p className="text-sm font-medium mt-0.5 truncate">{interaction.subject}</p>
                    )}

                    {interaction.summary && (
                      <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{interaction.summary}</p>
                    )}

                    {/* Expandable intro details */}
                    {hasIntros && (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : interaction.id)}
                        className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        Intro details
                      </button>
                    )}

                    {isExpanded && hasIntros && (
                      <div className="mt-2 pl-3 border-l-2 border-amber-200 dark:border-amber-800 space-y-1.5">
                        {introContacts.map((contact, idx) => (
                          <div key={idx} className="text-xs">
                            <span className="font-medium">{contact.name}</span>
                            {contact.email && (
                              <span className="text-muted-foreground ml-1">({contact.email})</span>
                            )}
                            {contact.context && (
                              <span className="text-muted-foreground"> — {contact.context}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
