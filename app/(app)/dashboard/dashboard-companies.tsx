'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { ArrowDownAZ, ArrowUpZA, DollarSign, ArrowDown, ArrowUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DashboardSparklines } from './dashboard-sparklines'

interface Company {
  id: string
  name: string
  stage: string | null
  tags: string[]
  industry: string[] | null
  portfolioGroup: string[] | null
  lastReportAt: string | null
  openReviews: number
  metricsCount: number
  sparkMetrics: { id: string; name: string; unit: string | null; unit_position: string; value_type: string; display_order: number; is_active: boolean }[]
  latestCash: number | null
}

interface Props {
  companies: Company[]
  allGroups: string[]
}

type SortMode = 'alpha' | 'cash'

export function DashboardCompanies({ companies, allGroups }: Props) {
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
  const [groupSortAsc, setGroupSortAsc] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('alpha')
  const [cashSortAsc, setCashSortAsc] = useState(false)

  function toggleGroup(group: string) {
    setSelectedGroups(prev => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const filtered = useMemo(() => {
    let result = companies
    if (selectedGroups.size > 0) {
      result = result.filter(c => (c.portfolioGroup ?? []).some(g => selectedGroups.has(g)))
    }
    return result
  }, [companies, selectedGroups])

  const hasGroups = filtered.some(c => c.portfolioGroup && c.portfolioGroup.length > 0)

  function sortCompanies(list: Company[]) {
    if (sortMode === 'cash') {
      return [...list].sort((a, b) => {
        const aCash = a.latestCash ?? (cashSortAsc ? Infinity : -Infinity)
        const bCash = b.latestCash ?? (cashSortAsc ? Infinity : -Infinity)
        return cashSortAsc ? aCash - bCash : bCash - aCash
      })
    }
    return list
  }

  const grouped = useMemo(() => {
    if (!hasGroups) return null

    const groups = new Map<string, Company[]>()
    for (const c of filtered) {
      const keys = c.portfolioGroup && c.portfolioGroup.length > 0 ? c.portfolioGroup : ['Other']
      for (const key of keys) {
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(c)
      }
    }

    const tailGroups = ['spv', 'other']
    const sorted = Array.from(groups.entries()).sort(([a], [b]) => {
      const aIdx = tailGroups.indexOf(a.toLowerCase())
      const bIdx = tailGroups.indexOf(b.toLowerCase())
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
      if (aIdx !== -1) return 1
      if (bIdx !== -1) return -1
      return groupSortAsc ? a.localeCompare(b) : b.localeCompare(a)
    })

    if (sortMode === 'cash') {
      return sorted.map(([name, list]) => [name, sortCompanies(list)] as [string, Company[]])
    }

    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, hasGroups, groupSortAsc, sortMode, cashSortAsc])

  const sortedFiltered = useMemo(() => sortCompanies(filtered), [filtered, sortMode, cashSortAsc])

  return (
    <div>
      {/* Filter bar */}
      {(allGroups.length > 0 || filtered.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {allGroups.map(group => (
            <button
              key={`group-${group}`}
              onClick={() => toggleGroup(group)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                selectedGroups.has(group)
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-background text-muted-foreground border-border hover:border-foreground/30'
              }`}
            >
              {group}
            </button>
          ))}
          {selectedGroups.size > 0 && (
            <button
              onClick={() => setSelectedGroups(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground underline ml-1"
            >
              Clear
            </button>
          )}
          <div className="ml-auto flex items-center gap-1">
            {hasGroups && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => {
                  if (sortMode === 'alpha') {
                    setGroupSortAsc(prev => !prev)
                  } else {
                    setSortMode('alpha')
                  }
                }}
              >
                {groupSortAsc ? (
                  <><ArrowDownAZ className="h-3.5 w-3.5" /> A &rarr; Z</>
                ) : (
                  <><ArrowUpZA className="h-3.5 w-3.5" /> Z &rarr; A</>
                )}
              </Button>
            )}
            <Button
              variant={sortMode === 'cash' ? 'secondary' : 'ghost'}
              size="sm"
              className="text-xs gap-1.5"
              onClick={() => {
                if (sortMode === 'cash') {
                  setCashSortAsc(prev => !prev)
                } else {
                  setSortMode('cash')
                }
              }}
            >
              <DollarSign className="h-3.5 w-3.5" />
              {cashSortAsc ? (
                <><ArrowUp className="h-3 w-3" /> Low &rarr; High</>
              ) : (
                <><ArrowDown className="h-3 w-3" /> High &rarr; Low</>
              )}
            </Button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No companies match the selected filters.</p>
        </div>
      ) : grouped ? (
        <div className="space-y-6">
          {grouped.map(([groupName, groupCompanies]) => (
            <div key={groupName}>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">{groupName}</h2>
              <CompanyGrid companies={groupCompanies} />
            </div>
          ))}
        </div>
      ) : (
        <CompanyGrid companies={sortedFiltered} />
      )}
    </div>
  )
}

function CompanyGrid({ companies }: { companies: Company[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {companies.map((c) => (
        <Link
          key={c.id}
          href={`/companies/${c.id}`}
          className="rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{c.name}</span>
              {c.stage && (
                <Badge variant="outline" className="text-[10px] py-0">
                  {c.stage}
                </Badge>
              )}
              {(c.industry ?? []).map((ind) => (
                <Badge key={ind} variant="outline" className="text-[10px] py-0">
                  {ind}
                </Badge>
              ))}
              {c.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[10px] py-0">
                  {tag}
                </Badge>
              ))}
            </div>
            {c.openReviews > 0 && (
              <span className="rounded-full bg-amber-500 text-white text-[10px] font-semibold leading-none px-1.5 py-0.5 min-w-[18px] text-center">
                {c.openReviews}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
            {c.lastReportAt && (
              <span>Last report {new Date(c.lastReportAt).toLocaleDateString()}</span>
            )}
            <span>{c.metricsCount} metric{c.metricsCount !== 1 ? 's' : ''}</span>
          </div>

          {c.sparkMetrics.length > 0 && (
            <DashboardSparklines
              companyId={c.id}
              metrics={c.sparkMetrics}
            />
          )}
        </Link>
      ))}
    </div>
  )
}
