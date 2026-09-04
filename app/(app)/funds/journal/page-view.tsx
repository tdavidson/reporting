'use client'

import { Suspense, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { JournalView } from './view'
import { TextLedgerView } from '../text/view'

type Tab = 'entries' | 'text'

/**
 * The journal page: the entries, and the plain-text editor that writes them, as two tabs of one
 * page.
 *
 * Plain text used to be a page of its own. It is not a different thing — it is the same journal
 * entries typed a different way, and the list is where you go the moment you have posted them —
 * so a separate page meant two places to look and a round trip between them. Here the editor is a
 * tab; "Post" lands you back on the list with the entries in it.
 *
 * The tab is in the URL (`?tab=text`) so the docs and the old /text links can open the editor
 * directly. That needs `useSearchParams`, hence the Suspense boundary around the inner component.
 */
export function JournalPageView() {
  return (
    <Suspense fallback={null}>
      <JournalTabs />
    </Suspense>
  )
}

function JournalTabs() {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'text' ? 'text' : 'entries')

  // Keep the URL in step with the tab, without a history entry per click.
  useEffect(() => {
    const qs = new URLSearchParams(params.toString())
    if (tab === 'text') qs.set('tab', 'text'); else qs.delete('tab')
    const next = qs.toString() ? `${pathname}?${qs}` : pathname
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== next) {
      router.replace(next, { scroll: false })
    }
  }, [tab, pathname, params, router])

  const tabCls = (t: Tab, edge: 'l' | 'r') =>
    `h-9 px-3 ${edge === 'l' ? 'rounded-l-md' : 'rounded-r-md border-l border-input'} ${tab === t ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground'}`

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-md border border-input text-sm" role="tablist" aria-label="Entries or plain text">
        <button role="tab" aria-selected={tab === 'entries'} onClick={() => setTab('entries')} className={tabCls('entries', 'l')}>
          Entries
        </button>
        <button role="tab" aria-selected={tab === 'text'} onClick={() => setTab('text')} className={tabCls('text', 'r')}>
          Plain text
        </button>
      </div>

      {tab === 'entries'
        ? <JournalView onPlainText={() => setTab('text')} />
        : <TextLedgerView onPosted={() => setTab('entries')} />}
    </div>
  )
}
