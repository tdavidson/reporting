'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Loader2, Share2 } from 'lucide-react'
import { useLpPortalEnabled } from '@/components/feature-visibility-context'

interface Investor { id: string; name: string }

/**
 * A "Share with LPs" button that opens a modal to choose which investors can
 * see this item (snapshot or letter) in their portal. Share-only — inviting LPs
 * lives in Settings → LP access. `shareEndpoint` is the item's share route
 * (GET/POST { lp_investor_ids }). Render it inside an action-button row.
 *
 * Renders NOTHING when the LP portal is off. Sharing an item into a portal no LP can open
 * is not a partial success, it is a no-op that looks like one — and the button used to sit
 * there regardless, on the snapshot and letter pages, offering exactly that. Gated here
 * rather than at each call site so no future caller can forget.
 */
/**
 * The investor picker itself, WITHOUT its own button/dialog chrome — so it can be dropped
 * straight into a dialog a caller already owns (e.g. the /lps "Share with LPs" flow), or wrapped
 * by LpShareControl below. Checking an investor persists immediately to `shareEndpoint`.
 */
export function LpSharePanel({ shareEndpoint }: { shareEndpoint: string }) {
  const [investors, setInvestors] = useState<Investor[]>([])
  const [shared, setShared] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [portalEnabled, setPortalEnabled] = useState<boolean | null>(null)
  const [groups, setGroups] = useState<{ name: string; investor_ids: string[] }[]>([])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/lps/investors').then(r => (r.ok ? r.json() : [])),
      fetch(shareEndpoint).then(r => (r.ok ? r.json() : { lp_investor_ids: [] })),
      fetch('/api/settings').then(r => (r.ok ? r.json() : null)),
      fetch('/api/lps/investor-groups').then(r => (r.ok ? r.json() : { groups: [] })),
    ])
      .then(([invs, sh, settings, grp]) => {
        setInvestors((Array.isArray(invs) ? invs : []).map((i: any) => ({ id: i.id, name: i.name })))
        setShared(new Set(sh.lp_investor_ids ?? []))
        setPortalEnabled(settings ? !!settings.lpPortalEnabled : null)
        setGroups(Array.isArray(grp?.groups) ? grp.groups : [])
      })
      .finally(() => setLoading(false))
  }, [shareEndpoint])

  async function persist(next: Set<string>) {
    setShared(new Set(next))
    setSaving(true)
    await fetch(shareEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lp_investor_ids: Array.from(next) }),
    }).catch(() => {})
    setSaving(false)
  }

  function toggle(id: string) {
    const next = new Set(shared)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    persist(next)
  }

  function selectGroup(name: string) {
    const g = groups.find(x => x.name === name)
    if (!g) return
    const valid = new Set(investors.map(i => i.id))
    const next = new Set(shared)
    g.investor_ids.forEach(id => { if (valid.has(id)) next.add(id) })
    persist(next)
  }

  const allShared = investors.length > 0 && investors.every(i => shared.has(i.id))

  return (
    <div className="space-y-3 min-w-0">
      {portalEnabled === false && (
        <div className="text-xs rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 px-2.5 py-2">
          The LP portal is off for this fund, shares won&apos;t reach LPs until you enable it in{' '}
          <a href="/settings" className="underline">Settings → LP Portal</a>.
        </div>
      )}

      {loading ? (
        <div className="text-xs text-muted-foreground py-4"><Loader2 className="h-3.5 w-3.5 inline animate-spin mr-1" /> Loading…</div>
      ) : investors.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4">No LP investors yet, add them from Settings → LP access.</div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              {shared.size} of {investors.length} shared
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            </span>
            <button onClick={() => persist(allShared ? new Set() : new Set(investors.map(i => i.id)))} className="text-[11px] text-primary hover:underline">
              {allShared ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          {groups.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">Select all in fund/SPV:</span>
              <select
                defaultValue=""
                onChange={e => { if (e.target.value) selectGroup(e.target.value); e.currentTarget.value = '' }}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs flex-1 min-w-0"
              >
                <option value="">Choose…</option>
                {groups.map(g => <option key={g.name} value={g.name}>{g.name} ({g.investor_ids.length})</option>)}
              </select>
            </div>
          )}
          <div className="rounded-md border divide-y max-h-[55vh] overflow-y-auto min-w-0">
            {investors.map(inv => (
              <label key={inv.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/30 min-w-0">
                <input type="checkbox" checked={shared.has(inv.id)} onChange={() => toggle(inv.id)} className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 min-w-0 truncate">{inv.name}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function LpShareControl({ shareEndpoint }: { shareEndpoint: string }) {
  const lpPortalEnabled = useLpPortalEnabled()
  const [open, setOpen] = useState(false)

  if (!lpPortalEnabled) return null

  return (
    <>
      <Button variant="outline" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)}>
        <Share2 className="h-4 w-4 mr-1" />
        Share with LPs
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Share with LPs</DialogTitle>
            <DialogDescription>Check an investor to make this visible in their portal. Invite LPs from Settings → LP access.</DialogDescription>
          </DialogHeader>
          {open && <LpSharePanel shareEndpoint={shareEndpoint} />}
        </DialogContent>
      </Dialog>
    </>
  )
}
