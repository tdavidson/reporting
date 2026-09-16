// The command palette's index and matcher — pure, so tests can pin what it offers.
//
// The palette is a third rendering of the nav, after the desktop aside and the phone's tab bar,
// and it is built from the SAME functions (`navSectionsFor`, `visibleChildrenFor`) so it cannot
// answer the access question differently from them. A palette that offered a page whose every
// request 403s would be worse than the sidebar doing it: the sidebar at least shows the page in
// context, the palette presents it as a match for what you typed.
//
// Affordances only, like the rest of the nav. Nothing here is a boundary — every href leads to a
// page or API that gates itself.

import { navSectionsFor, visibleChildrenFor, type NavItem } from '@/components/app-sidebar'
import type { Domain } from '@/lib/access/domains'
import type { FeatureKey } from '@/lib/types/features'
import type { AccessLevel } from '@/lib/access/effective'

export type PaletteGroup = 'pages' | 'entities' | 'companies' | 'lps' | 'deals'

export interface PaletteEntry {
  /** Stable, unique across the index — the list key and the "which one is active" handle. */
  id: string
  label: string
  /** Where it lives — the section for a page, the entity for an entity-scoped page. */
  hint?: string
  href: string
  group: PaletteGroup
  /** Extra text a match may hit (aliases, a founder's name). Never displayed. */
  keywords?: string[]
}

/** A vehicle as `/api/accounting/vehicle-index` returns it. */
export interface PaletteVehicle { name: string; id: string | null; kind?: string | null }

type Access = (domain: Domain, feature?: FeatureKey) => AccessLevel

export const GROUP_LABELS: Record<PaletteGroup, string> = {
  pages: 'Pages',
  entities: 'Entities',
  companies: 'Companies',
  lps: 'LPs',
  deals: 'Deals',
}

/** Render order. Pages first: they are what the palette is for, and what every member has. */
export const GROUP_ORDER: PaletteGroup[] = ['pages', 'entities', 'companies', 'lps', 'deals']

/** The `/funds/<seg>` segment for a vehicle — its id, or its encoded name for a legacy vehicle. */
function vehicleSeg(v: PaletteVehicle): string {
  return v.id ?? encodeURIComponent(v.name)
}

/**
 * Every page this user can reach, as palette entries.
 *
 * Sections and their children come straight from the nav. The Entities section is the one that
 * needs more: its children are per-entity pages (`/funds/<id>/journal`), so each vehicle
 * contributes its own copy, filtered by kind the way the sidebar filters them inside a fund — a
 * management company never gets a "Capital accounts" entry. The entity itself is an entry too,
 * in its own group, pointing at its overview.
 *
 * The badges are passed through so the palette agrees with the sidebar about Review and Pending
 * Actions, which exist only while something is waiting.
 */
export function pageEntries(
  isAdmin: boolean,
  access: Access,
  opts: {
    fofActive?: boolean
    vehicles?: PaletteVehicle[]
    badges?: { review?: number; pendingActions?: number }
  } = {},
): PaletteEntry[] {
  const out: PaletteEntry[] = []
  const sections = navSectionsFor(isAdmin, access, opts.badges)

  for (const item of sections) {
    out.push({ id: `page:${item.href}`, label: item.label, href: item.href, group: 'pages' })

    if (item.href === '/funds') {
      pushEntityEntries(out, item, isAdmin, access, opts)
      continue
    }

    for (const child of visibleChildrenFor(item, isAdmin, access, { fofActive: opts.fofActive })) {
      out.push({ id: `page:${child.href}`, label: child.label, hint: item.label, href: child.href, group: 'pages' })
    }
  }

  return out
}

function pushEntityEntries(
  out: PaletteEntry[],
  item: NavItem,
  isAdmin: boolean,
  access: Access,
  opts: { fofActive?: boolean; vehicles?: PaletteVehicle[] },
) {
  // The firm-wide pages (/funds/journal lists every entity and asks which one you mean).
  for (const child of visibleChildrenFor(item, isAdmin, access, { fofActive: opts.fofActive })) {
    out.push({ id: `page:${child.href}`, label: child.label, hint: 'All entities', href: child.href, group: 'pages' })
  }

  for (const v of opts.vehicles ?? []) {
    const seg = vehicleSeg(v)
    const children = visibleChildrenFor(item, isAdmin, access, { fofActive: opts.fofActive, fundSeg: seg, kind: v.kind ?? null })
    for (const child of children) {
      // The "Overview" child IS the entity: list it by name, in the entities group.
      if (child.exact) {
        out.push({ id: `entity:${seg}`, label: v.name, hint: v.kind ?? undefined, href: child.href, group: 'entities' })
        continue
      }
      out.push({ id: `page:${child.href}`, label: child.label, hint: v.name, href: child.href, group: 'pages', keywords: [v.name] })
    }
  }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * How well one token matches one field. Prefix of the whole field beats prefix of a word beats
 * substring; zero means no match. Kept coarse on purpose — a palette needs a stable order more
 * than a clever one.
 */
function tokenScore(token: string, field: string): number {
  if (!field) return 0
  if (field.startsWith(token)) return 3
  if (field.includes(' ' + token)) return 2
  if (field.includes(token)) return 1
  return 0
}

/**
 * Rank `entries` against `query`.
 *
 * Every whitespace-separated token has to match somewhere (label, hint or keywords); the score is
 * the sum over tokens of the best field score, with label matches weighted above the rest so
 * "Journal · Example Fund II" outranks "Example Fund II" (the entity) for "jour". Ties keep index
 * order, which is nav order — sections before children, the way the sidebar lists them.
 *
 * An empty query is the palette at rest: the sections, in nav order, nothing more.
 */
export function matchEntries(query: string, entries: PaletteEntry[], limit = 40): PaletteEntry[] {
  const tokens = norm(query).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) {
    return entries.filter(e => e.group === 'pages' && !e.hint).slice(0, limit)
  }

  const scored: { entry: PaletteEntry; score: number; index: number }[] = []
  entries.forEach((entry, index) => {
    const label = norm(entry.label)
    const hint = norm(entry.hint ?? '')
    const keywords = (entry.keywords ?? []).map(norm)
    let score = 0
    for (const token of tokens) {
      const inLabel = tokenScore(token, label) * 2
      const inHint = tokenScore(token, hint)
      const inKeywords = keywords.reduce((best, k) => Math.max(best, tokenScore(token, k)), 0)
      const best = Math.max(inLabel, inHint, inKeywords)
      if (best === 0) return
      score += best
    }
    scored.push({ entry, score, index })
  })

  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.slice(0, limit).map(s => s.entry)
}

/** The matches, bucketed for rendering, in `GROUP_ORDER` with empty groups dropped. */
export function groupEntries(entries: PaletteEntry[]): { group: PaletteGroup; label: string; entries: PaletteEntry[] }[] {
  return GROUP_ORDER
    .map(group => ({ group, label: GROUP_LABELS[group], entries: entries.filter(e => e.group === group) }))
    .filter(g => g.entries.length > 0)
}
