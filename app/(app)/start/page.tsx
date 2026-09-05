'use client'

import Link from 'next/link'
import { Plus, Landmark, HandCoins, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAccess } from '@/components/access-context'
import { useAnalystContext } from '@/components/analyst-context'
import { useIsAdmin } from '@/components/feature-visibility-context'
import { AnalystConversation } from '@/components/analyst-conversation'
import { AddCompanyButton } from '@/components/add-company-button'
import { AddInvestmentButton } from '@/components/add-investment-button'
import { useVehicle } from '@/components/accounting-vehicle'
import { AddVehicleButton } from '@/components/add-vehicle-button'
import { ImportDocumentsButton } from '@/components/import-documents'
import { createActions, suggestedPrompts } from '@/lib/start/quick-actions'

/**
 * Where a signed-in member lands.
 *
 * A CLIENT page on purpose, and that is the access answer rather than a hole in it: it queries
 * nothing on the server, so there is no fund data here for a gate to protect. Everything it shows
 * is either the user's own grants (already in the client access context) or a link to a page that
 * gates itself, and the chat goes through /api/analyst, which the middleware gates like every
 * other route. See the note at the top of lib/access/page-domains.ts — client pages are absent
 * from that registry deliberately.
 *
 * It also must stay reachable by a member with no `portfolio` grant, because it is the landing
 * page. Gating it on any one domain would lock those users out of the app's front door.
 */
export default function StartPage() {
  const access = useAccess()
  const { hasAIKey } = useAnalystContext()

  // Icons stay here rather than in lib/start/quick-actions.ts, which is a pure module the tests
  // import without React. The modal actions carry their own (a Plus, inside each button component);
  // these are the link actions'. The capital pair uses the same glyph as the page they open, and
  // the distribution gets the hand-with-coins because it is money going OUT.
  const LINK_ICONS: Record<string, LucideIcon> = {
    'add-deal': Plus,
    'issue-capital-call': Landmark,
    'declare-distribution': HandCoins,
  }

  const prompts = suggestedPrompts(access)
  const isAdmin = useIsAdmin()
  const actions = createActions(access, { isAdmin })
  // The capital actions link to the firm-wide capital accounts landing, which asks which entity.
  // When the browser already has one in context (the fund last worked in), skip the question.
  const { vehicleId } = useVehicle()
  const hrefFor = (href: string) =>
    vehicleId ? href.replace('/funds/capital-accounts', `/funds/${vehicleId}/capital-accounts`) : href

  // Desktop only. Adding a company or vehicle and importing documents are sit-down jobs —
  // forms and file pickers — and on a phone the buttons pushed the footer up past the tab bar
  // while offering nothing a thumb would start.
  // One row per group — see CreateAction.group. A group with nothing in it renders no row, so a
  // fund without LP capital sees exactly what it saw before.
  const groups = (['create', 'capital'] as const)
    .map(g => actions.filter(a => a.group === g))
    .filter(g => g.length > 0)

  const shortcuts = actions.length > 0 && (
    <div className="hidden space-y-3 md:block">
      <p className="text-left text-xs text-muted-foreground">Or start from here:</p>
      {groups.map((group, i) => (
      <div key={i} className="flex flex-wrap justify-start gap-2">
        {group.map(a => {
          if (a.kind === 'link') {
            const Icon = LINK_ICONS[a.id]
            return (
              <Button key={a.id} variant="outline" size="sm" asChild className="gap-1.5 h-8 py-2 text-muted-foreground hover:text-foreground">
                <Link href={hrefFor(a.href!)}>{Icon && <Icon className="h-3.5 w-3.5" />}{a.label}</Link>
              </Button>
            )
          }
          if (a.id === 'add-investment') return <AddInvestmentButton key={a.id} />
          if (a.id === 'add-company') return <AddCompanyButton key={a.id} />
          if (a.id === 'import-documents') return <ImportDocumentsButton key={a.id} />
          if (a.id === 'add-vehicle') return <AddVehicleButton key={a.id} />
          return null
        })}
      </div>
      ))}
    </div>
  )

  // This IS the page title. There is no separate "Analyst" h1 above it — one page, one title,
  // and this is the one that says what the page is for.
  const hero = (
    <h1 className="text-left text-2xl font-semibold tracking-tight">
      What would you like to do?
    </h1>
  )

  // No AI key configured means no chat to put front and centre. Rather than render a composer that
  // will only ever answer with an error, the page keeps its shortcuts and says why.
  if (!hasAIKey) {
    return (
      <div className="w-full px-4 pb-8 pt-4 md:pl-8 md:pr-4 md:pt-8">
        <div className="flex w-full max-w-4xl flex-col gap-6">
        {hero}
        <p className="text-left text-sm text-muted-foreground">
          Add an AI provider key in{' '}
          <Link href="/settings" className="text-brand-700 dark:text-brand-400 hover:underline">Settings</Link>{' '}
          to ask the Analyst questions from here.
        </p>
        {shortcuts}
        </div>
      </div>
    )
  }

  return (
    // On a phone the page claims the whole visible viewport less the header (100svh − 5rem), so
    // the footer starts under the tab bar instead of its top border peeking out above it when the
    // hero is shorter than the screen. The larger bottom padding keeps the storage note clear of
    // the bar too.
    <div className="flex h-full min-h-[calc(100svh-5rem)] w-full flex-col px-4 pb-20 pt-4 md:min-h-[32rem] md:pb-16 md:pl-8 md:pr-4 md:pt-8">
      <AnalystConversation
        variant="page"
        autoFocus
        hero={hero}
        suggestions={prompts.map(p => p.text)}
        belowComposer={shortcuts}
      />
    </div>
  )
}
