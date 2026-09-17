'use client'

import { usePathname } from 'next/navigation'
import { Building2, ClipboardCheck, ListChecks, Mail, Settings, LifeBuoy, Users, Crown, Lightbulb, Microscope, BookOpen, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ACCOUNTING_SECTIONS, sectionsForKind } from '@/lib/accounting/nav'
import { FUND_SUBPAGE_SLUGS } from '@/components/fund-subpages'
import type { FeatureKey } from '@/lib/types/features'
import { domainForFeature, type Domain } from '@/lib/access/domains'
import type { AccessLevel } from '@/lib/access/effective'

interface NavChild {
  href: string
  label: string
  adminOnly?: boolean
  featureKey?: FeatureKey
  /** Only where the featureKey can't imply it (or there is no featureKey). */
  domain?: Domain
  /** Notes moved from a top-level item into Portfolio, and its unread count moved with it. */
  badgeKey?: 'notes'
  /** Highlight only on the exact path, never on descendants. The Funds "Overview" child
   *  (/funds/<id>) is a prefix of every sibling, so a prefix match would light it everywhere. */
  exact?: boolean
  /** Only for a fund of funds. DERIVED from the data (at least one holding is a fund), not
   *  from a feature key — so it is filtered separately from canSee(). */
  requiresFof?: boolean
}
interface NavItem {
  href: string
  label: string
  /** The rail's label, where the full one does not fit under a 64px icon. Defaults to `label`. */
  railLabel?: string
  icon: LucideIcon
  badgeKey?: 'review' | 'settings' | 'notes' | 'pendingActions'
  adminOnly?: boolean
  featureKey?: FeatureKey
  /** Only where the featureKey can't imply it (or there is no featureKey). */
  domain?: Domain
  beta?: boolean
  children?: NavChild[]
}

/**
 * Can this user reach this nav entry? Answered by the SAME resolver the middleware applies to the
 * API behind it, given the entry's OWN feature key.
 *
 * That last part is the whole trick. This used to consult a precomputed level per domain — but
 * that map had to pick one feature key per domain, and several span more than one. A fund with
 * `lps: admin` + `lp_tracking: everyone` hid Capital accounts from a member who could open the
 * page and whose API calls returned 200, because the map answered for `lps` and the entry meant
 * `lp_tracking`.
 *
 * The nav is an affordance, not a boundary — but it must not LIE. A link to a page whose every
 * request 403s is worse than no link, and a link to data the user shouldn't have is worse still.
 */
export function canSee(
  entry: { adminOnly?: boolean; featureKey?: FeatureKey; domain?: Domain },
  isAdmin: boolean,
  access: (domain: Domain, feature?: FeatureKey) => AccessLevel,
): boolean {
  if (entry.adminOnly && !isAdmin) return false

  const domain = entry.domain ?? (entry.featureKey ? domainForFeature(entry.featureKey) : undefined)
  // No domain and no feature: an always-available entry (Settings, Support).
  if (!domain) return true

  const level = access(domain, entry.featureKey)
  return level === 'read' || level === 'write'
}

const NAV_ITEMS: NavItem[] = [
  { href: '/review', label: 'Review', icon: ClipboardCheck, badgeKey: 'review', domain: 'portfolio' },
  // Admin-only, and — like Review — only shown when there's something waiting (badgeKey hides it
  // at zero). The list still filters rows by per-domain access; members reach theirs via the API/URL.
  { href: '/pending-actions', label: 'Pending Actions', railLabel: 'Pending', icon: ListChecks, domain: 'portfolio', adminOnly: true, badgeKey: 'pendingActions' },
  // Portfolio, not dealflow — the mailbox is where portfolio updates arrive and where the review
  // queue's emails live, so gating it on the Deals product hid the only page that can reprocess an
  // email from every fund running Portfolio Reporting alone. Deal-specific actions inside it gate
  // themselves. See ROUTE_DOMAINS['api/emails'].
  // The landing page. No domain and no feature key: it is the app's front door, and a member with
  // no grants still has to be able to reach it. What it OFFERS is filtered per-grant inside the
  // page (lib/start/quick-actions.ts).
  { href: '/start', label: 'Start', icon: Sparkles },
  { href: '/emails', label: 'Inbound', icon: Mail, domain: 'portfolio' },
  { href: '/deals', label: 'Deals', icon: Lightbulb, featureKey: 'deals' },
  {
    href: '/diligence', label: 'Diligence', icon: Microscope, featureKey: 'diligence',
    children: [
      { href: '/diligence/inbox',     label: 'Inbox' },
      { href: '/diligence/analytics', label: 'Analytics', adminOnly: true },
    ],
  },
  {
    href: '/dashboard', label: 'Portfolio', icon: Building2, domain: 'portfolio',
    children: [
      { href: '/import',       label: 'Import',       featureKey: 'imports' },
      { href: '/investments',  label: 'Investments',  featureKey: 'investments' },
      { href: '/fund-holdings', label: 'Underlying funds', featureKey: 'investments', requiresFof: true },
      { href: '/requests',     label: 'Asks',         featureKey: 'asks' },
      { href: '/interactions', label: 'Interactions', featureKey: 'interactions' },
      // What companies reported, searchable: the Company Updates corpus. Plain portfolio — it has
      // no feature switch of its own because it IS the reporting product's evidence layer.
      { href: '/company-updates', label: 'Updates', domain: 'portfolio' },
      // Letters are generated from PORTFOLIO data (the companies) and can be produced without
      // any LP tracking, so they live under Portfolio, not LPs.
      { href: '/letters',      label: 'Letters',      featureKey: 'lp_letters' },
      // Notes are about companies, so they belong under the portfolio rather than as a
      // top-level peer of it.
      { href: '/notes',        label: 'Notes',        featureKey: 'notes', badgeKey: 'notes' },
      { href: '/compliance',   label: 'Compliance',   featureKey: 'compliance' },
    ],
  },
  {
    href: '/lps', label: 'LPs', icon: Crown, featureKey: 'lps',
    children: [
      { href: '/lps/capital',   label: 'Capital accounts', featureKey: 'lp_tracking' },
      { href: '/lp-portal',     label: 'Documents',        featureKey: 'lp_portal' },
      // See the portal exactly as an LP does ("viewing as …"). Admin-only, and only where a
      // portal exists to preview.
      { href: '/lps/preview',   label: 'Preview portal',   featureKey: 'lp_portal', adminOnly: true },
      { href: '/lp-activity',   label: 'Activity',         featureKey: 'lp_activity' },
    ],
  },
  {
    // "Entities", not "Funds", because it is every entity the firm keeps books for — funds,
    // SPVs, GP entities, individuals AND the management company. The manco had a section of its
    // own while its pages were a parallel copy of these ones; they are the same pages now, so it
    // is one more kind of row. What it is NOT is one more grant: `requireVehicleAccess` still
    // refuses a management company to a caller holding only `accounting`, because the boundary
    // was always the entity's kind rather than the URL prefix.
    //
    // No `adminOnly` — the featureKey already gates it (defaults to 'off', and a fund
    // that turns it on to 'admin' still only shows it to admins). Hard-coding adminOnly
    // on top of that also hid it from the read-only demo viewer, who should see the books.
    href: '/funds', label: 'Entities', icon: BookOpen, featureKey: 'accounting',
    children: ACCOUNTING_SECTIONS.map(({ href, label, domain, requiresFof, feature }) => ({ href, label, domain, requiresFof, featureKey: feature })),
  },
  { href: '/usage', label: 'Usage', icon: Users, adminOnly: true, domain: 'admin' },
  { href: '/settings', label: 'Settings', icon: Settings, badgeKey: 'settings' },
  { href: '/support', label: 'Support', icon: LifeBuoy },
]

/**
 * What a phone's tab bar offers, in preference order.
 *
 * A phone does not get this sidebar. It gets four destinations across the bottom of
 * the screen plus a "More" button that opens the sidebar in a drawer — because a
 * sidebar is a poor fit for the shape of the device and worse for the shape of an
 * installed app. It is twenty-odd rows deep, which on a phone is a full screen and a
 * half; it sits behind a control in the TOP-LEFT corner, the hardest place on a
 * handset to reach; and every navigation costs two taps. In a standalone PWA there is
 * also no browser chrome to fall back on, so a menu you cannot reach is a dead end
 * rather than an inconvenience.
 *
 * Four is the count both platforms' own tab bars settle on once a "More" affordance
 * takes the fifth slot, and it is about as many labels as fit legibly across a narrow
 * screen.
 *
 * The list is a PREFERENCE, not a fixed bar: entries the user cannot see are dropped
 * (same canSee as the sidebar — the tab bar must not offer a page whose every request
 * 403s), and the bar is then topped up from the rest of NAV_ITEMS so a fund running an
 * unusual mix of features still gets a full bar rather than two tabs and a gap.
 */
const MOBILE_TAB_HREFS = ['/dashboard', '/emails', '/lps', '/funds', '/deals', '/diligence', '/review'] as const

/** Slots before "More" takes the last one. */
export const MOBILE_TAB_COUNT = 4

export function mobileTabsFor(
  isAdmin: boolean,
  access: (domain: Domain, feature?: FeatureKey) => AccessLevel,
): NavItem[] {
  const byHref = new Map(NAV_ITEMS.map(item => [item.href, item]))
  const preferred = MOBILE_TAB_HREFS.map(href => byHref.get(href)).filter((i): i is NavItem => !!i)
  const rest = NAV_ITEMS.filter(item => !preferred.includes(item))
  return [...preferred, ...rest].filter(item => canSee(item, isAdmin, access)).slice(0, MOBILE_TAB_COUNT)
}

/**
 * Is `pathname` inside this nav item's section?
 *
 * Children are checked as well as the item itself, because half the sections keep
 * theirs at unrelated paths — Portfolio's children are /investments, /notes, /letters
 * — so a prefix match on the parent alone would leave the bar showing nothing selected
 * across most of the app. This is deliberately looser than the sidebar's exact match:
 * a tab bar is answering "which part of the app am I in", not "which row am I on".
 */
export function navItemMatches(item: NavItem, pathname: string): boolean {
  const under = (href: string) => pathname === href || pathname.startsWith(href + '/')
  return under(item.href) || (item.children ?? []).some(child => under(child.href))
}

/**
 * Every top-level section this user can see, in nav order.
 *
 * Shared by the desktop aside and the phone's "More" sheet so the two cannot answer
 * the access question differently — the sheet is no longer the sidebar rendered in a
 * drawer, so without this it would be a second list to keep in step.
 *
 * The badge counts are here because two entries are conditional on having something
 * waiting: Review and Pending Actions are noise at zero, and Pending Actions in
 * particular is an empty page most days.
 */
export function navSectionsFor(
  isAdmin: boolean,
  access: (domain: Domain, feature?: FeatureKey) => AccessLevel,
  badges: { review?: number; pendingActions?: number } = {},
): NavItem[] {
  return NAV_ITEMS.filter(item => {
    if (!canSee(item, isAdmin, access)) return false
    if (item.badgeKey === 'review' && (badges.review ?? 0) === 0) return false
    if (item.badgeKey === 'pendingActions' && (badges.pendingActions ?? 0) === 0) return false
    return true
  })
}

/**
 * What the phone's "More" sheet lists: every section the user can see that the tab bar
 * is not already showing.
 *
 * The split lives here rather than in the sheet so the two halves of the phone's nav
 * are computed from one list in one place — a destination that is in neither half is
 * unreachable on a handset, and in a standalone window there is no address bar to fall
 * back on. tests/mobile-nav-tabs.test.ts pins the two halves as disjoint and complete.
 */
export function moreSectionsFor(
  isAdmin: boolean,
  access: (domain: Domain, feature?: FeatureKey) => AccessLevel,
  tabHrefs: string[],
  badges: { review?: number; pendingActions?: number } = {},
): NavItem[] {
  const inBar = new Set(tabHrefs)
  return navSectionsFor(isAdmin, access, badges).filter(item => !inBar.has(item.href))
}

/**
 * The Funds section's children. Two shapes, decided by the URL alone:
 *
 *   - Inside a fund (/funds/<id>/…): fund-first — every child points at /funds/<id>/<page>, with
 *     an "Overview" entry for the fund's lead page, and the pages the vehicle's kind has no use
 *     for left out.
 *   - Anywhere else: firm-wide — every child points at /funds/<page>, the landing that lists
 *     every entity and asks which one you mean.
 *
 * It used to fall back to the vehicle the browser last had in context, which made the subnav a
 * guess: after a visit to a management company the context WAS the manco, so "Funds → Bank" led
 * to the manco's bank page. The URL is the only thing the user can see, so it is the only input.
 */
export function fundsChildrenFor(fundSeg: string | null, fofActive: boolean, kind: string | null = null): NavChild[] {
  const sections = sectionsForKind(ACCOUNTING_SECTIONS, fundSeg ? kind : null).filter(s => !s.requiresFof || fofActive)
  const children: NavChild[] = sections.map(s => ({
    href: fundSeg ? `/funds/${fundSeg}/${s.href.slice('/funds/'.length)}` : s.href,
    label: s.label,
    domain: s.domain,
    featureKey: s.feature,
  }))
  return fundSeg ? [{ href: `/funds/${fundSeg}`, label: 'Overview', exact: true }, ...children] : children
}

/**
 * The children of one section this user can see — the admin gate, the per-feature
 * visibility, and the fund-of-funds pages that only exist once the fund holds a fund.
 */
export function visibleChildrenFor(
  item: NavItem,
  isAdmin: boolean,
  access: (domain: Domain, feature?: FeatureKey) => AccessLevel,
  opts: { fofActive?: boolean; fundSeg?: string | null; kind?: string | null } = {},
): NavChild[] {
  const children = item.href === '/funds'
    ? fundsChildrenFor(opts.fundSeg ?? null, !!opts.fofActive, opts.kind ?? null)
    : item.children
  return (children ?? [])
    .filter(c => canSee(c, isAdmin, access))
    .filter(c => !c.requiresFof || !!opts.fofActive)
}

/**
 * Which fund the Funds subnav points at: the one in the URL when we are under a fund, else
 * none — and none means the firm-wide pages, not a guess from the vehicle context. See
 * fundsChildrenFor for why the context is deliberately not consulted here.
 */
export function fundSegFromPath(pathname: string): string | null {
  const fundMatch = pathname.match(/^\/funds\/([^/]+)/)
  return fundMatch && !FUND_SUBPAGE_SLUGS.has(fundMatch[1]) ? fundMatch[1] : null
}

export function useFundSeg(): string | null {
  return fundSegFromPath(usePathname())
}

/**
 * The section `pathname` is in, for the rail's highlight and the panel's contents — the first
 * visible section whose own path or any child's path contains it. Null off every section (a
 * company page, say), and then there is no panel: the rail alone is the nav.
 *
 * Same looseness as the phone's tab bar, and for the same reason: the question is "which part
 * of the app am I in", and the panel answers "which row" underneath it.
 */
export function currentSectionFor(pathname: string, sections: NavItem[]): NavItem | null {
  return sections.find(item => navItemMatches(item, pathname)) ?? null
}

/**
 * Where the entity switcher goes: the same accounting page, on another entity — or on none.
 *
 *   /funds/<a>/journal   + seg <b>  → /funds/<b>/journal
 *   /funds/journal       + seg <b>  → /funds/<b>/journal
 *   /funds/<a>/journal   + null     → /funds/journal        (the firm-wide landing)
 *   /funds/<a>           + seg <b>  → /funds/<b>
 *
 * Only the section (the first subpage segment) survives the jump: a deeper param like an LP id
 * belongs to the entity being left. Off the Entities section entirely, it is the entity's overview.
 */
export function vehicleTargetPath(pathname: string, seg: string | null): string {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] !== 'funds') return seg ? `/funds/${seg}` : '/funds'
  const inEntity = !!parts[1] && !FUND_SUBPAGE_SLUGS.has(parts[1])
  const section = inEntity ? parts[2] : parts[1]
  const base = seg ? `/funds/${seg}` : '/funds'
  return section ? `${base}/${section}` : base
}

export type { NavItem, NavChild }
