'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Building2, ChevronDown, ChevronRight, Mail, Users } from 'lucide-react'

const KNOWN_TAGS = ['intro', 'hiring', 'strategy', 'fundraising', 'product', 'partnership', 'legal', 'operations'] as const

/**
 * Relationship tag → categorical slot.
 *
 * These were status colours doing categorical work, and it showed: "hiring" and
 * "product" were both info (indistinguishable), and "legal" was destructive —
 * a legal intro rendering as an error. Eight tags now take eight fixed slots
 * from the categorical palette (--cat-1..8, validated in globals.css).
 *
 * The hue rides as a 15% tint behind ink-coloured text rather than colouring the
 * text itself: the label carries the meaning, the tint carries identity, and it
 * keeps every pill readable regardless of which slot it drew.
 */
const TAG_COLORS: Record<string, string> = {
  intro: 'bg-cat-1/15 text-foreground',
  hiring: 'bg-cat-2/15 text-foreground',
  strategy: 'bg-cat-3/15 text-foreground',
  fundraising: 'bg-cat-4/15 text-foreground',
  product: 'bg-cat-5/15 text-foreground',
  partnership: 'bg-cat-6/15 text-foreground',
  legal: 'bg-cat-7/15 text-foreground',
  operations: 'bg-cat-8/15 text-foreground',
}

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
  tags: string[]
  subject: string | null
  summary: string | null
  intro_contacts: IntroContact[] | null
  body_preview: string | null
  interaction_date: string
  created_at: string
  company_name: string | null
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

export function RelationshipsList({ interactions }: { interactions: Interaction[] }) {
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [emailExpandedId, setEmailExpandedId] = useState<string | null>(null)
  const [fetchedBodies, setFetchedBodies] = useState<Record<string, string>>({})
  const [emailLoading, setEmailLoading] = useState<string | null>(null)

  const toggleEmailBody = async (interactionId: string, emailId: string) => {
    if (emailExpandedId === interactionId) {
      setEmailExpandedId(null)
      return
    }
    setEmailExpandedId(interactionId)
    if (fetchedBodies[emailId]) return
    setEmailLoading(interactionId)
    try {
      const res = await fetch(`/api/emails/${emailId}`)
      const data = await res.json()
      const payload = data.raw_payload ?? {}
      const body = payload.TextBody || payload.HtmlBody || ''
      setFetchedBodies(prev => ({ ...prev, [emailId]: body }))
    } catch {
      setFetchedBodies(prev => ({ ...prev, [emailId]: 'Failed to load email body.' }))
    } finally {
      setEmailLoading(null)
    }
  }

  // Only show tag filters for tags that exist in the data
  const usedTags = KNOWN_TAGS.filter(tag =>
    interactions.some(i => i.tags?.includes(tag))
  )

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const filtered = selectedTags.size === 0
    ? interactions
    : interactions.filter(i => i.tags?.some(t => selectedTags.has(t)))

  return (
    <div>
      {/* Tag filters + inbound address */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {usedTags.map(tag => (
          <button
            key={tag}
            onClick={() => toggleTag(tag)}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors capitalize ${ selectedTags.has(tag) ? TAG_COLORS[tag] + ' font-medium ring-1 ring-current/20' : 'text-muted-foreground hover:text-foreground hover:bg-accent' }`}
          >
            {tag}
          </button>
        ))}
        {selectedTags.size > 0 && (
          <button
            onClick={() => setSelectedTags(new Set())}
            className="px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
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
            const tags = interaction.tags ?? []

            return (
              <div
                key={interaction.id}
                className="border rounded-card p-3 hover:bg-accent/30 transition-colors"
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
                      {tags.includes('intro') && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-warning-subtle dark:bg-warning-subtle/30 text-warning text-[10px] font-medium">
                          <Users className="h-2.5 w-2.5" />
                          {introContacts.length} intro{introContacts.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {tags.filter(t => t !== 'intro').map(tag => (
                        <span
                          key={tag}
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium capitalize ${TAG_COLORS[tag] ?? 'bg-muted dark:bg-muted text-muted-foreground dark:text-muted-foreground'}`}
                        >
                          {tag}
                        </span>
                      ))}
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
                      <div className="mt-2 pl-3 border-l-2 border-warning space-y-1.5">
                        {introContacts.map((contact, idx) => (
                          <div key={idx} className="text-xs">
                            <span className="font-medium">{contact.name}</span>
                            {contact.email && (
                              <span className="text-muted-foreground ml-1">({contact.email})</span>
                            )}
                            {contact.context && (
                              <span className="text-muted-foreground">, {contact.context}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Expandable email body */}
                    {interaction.email_id && (
                      <button
                        onClick={() => toggleEmailBody(interaction.id, interaction.email_id!)}
                        className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        {emailExpandedId === interaction.id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        <Mail className="h-3 w-3" />
                        View email
                      </button>
                    )}

                    {emailExpandedId === interaction.id && interaction.email_id && (
                      <div className="mt-2 border rounded-card bg-muted/30 p-3">
                        {emailLoading === interaction.id ? (
                          <p className="text-xs text-muted-foreground animate-pulse">Loading email...</p>
                        ) : (
                          <pre className="text-xs whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
                            {fetchedBodies[interaction.email_id] || ''}
                          </pre>
                        )}
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
