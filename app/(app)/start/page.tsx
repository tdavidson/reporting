'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useAccess } from '@/components/access-context'
import { useAnalystContext } from '@/components/analyst-context'
import { AnalystConversation } from '@/components/analyst-conversation'
import { AddCompanyButton } from '@/components/add-company-button'
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

  const prompts = suggestedPrompts(access)
  const actions = createActions(access)

  const shortcuts = actions.length > 0 && (
    <div className="space-y-3">
      <p className="text-center text-xs text-muted-foreground">Or start from here:</p>
      <div className="flex flex-wrap justify-center gap-2">
        {actions.map(a => {
          if (a.kind === 'link') {
            return (
              <Button key={a.id} variant="outline" size="sm" asChild className="h-8 py-2 text-muted-foreground hover:text-foreground">
                <Link href={a.href!}>{a.label}</Link>
              </Button>
            )
          }
          if (a.id === 'add-company') return <AddCompanyButton key={a.id} />
          if (a.id === 'import-documents') return <ImportDocumentsButton key={a.id} />
          if (a.id === 'add-vehicle') return <AddVehicleButton key={a.id} />
          return null
        })}
      </div>
    </div>
  )

  // This IS the page title. There is no separate "Analyst" h1 above it — one page, one title,
  // and this is the one that says what the page is for.
  const hero = (
    <h1 className="text-center text-2xl font-semibold tracking-tight">
      What would you like to do?
    </h1>
  )

  // No AI key configured means no chat to put front and centre. Rather than render a composer that
  // will only ever answer with an error, the page keeps its shortcuts and says why.
  if (!hasAIKey) {
    return (
      <div className="w-full px-4 pb-8 pt-4 md:pl-8 md:pr-4 md:pt-8">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 pt-12">
        {hero}
        <p className="text-center text-sm text-muted-foreground">
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
    <div className="flex h-full min-h-[32rem] w-full flex-col px-4 pb-8 pt-4 md:pl-8 md:pr-4 md:pt-8">
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
