import { Circle, Mail, Upload, LineChart, BarChart3, StickyNote, MessageCircle, Handshake, Briefcase, Microscope, FileText, Calculator, Lock, FolderOpen, ShieldCheck, Database, Brain, ShieldUser, Users, Lightbulb, Send, Play, Github, Crown, Landmark, Receipt, Percent, Eye, Coins, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { orderedProducts, type ProductKey } from '@/lib/access/products'

export interface SiteFeature { title: string; text: string; screenshot?: string; icon?: string }
export interface SiteProductGroup {
  key?: ProductKey
  label: string
  description: string
  heroScreenshot?: string
  features: SiteFeature[]
}
/** A single figure in the stat strip — `value` is the big number, `label` the caption. */
export interface SiteStat { value: string; label: string }
export interface SiteWhy { icon?: string; title: string; text: string }
export interface SiteTierCta { kind: 'link' | 'calendly' | 'subscription'; label: string; href?: string }
export interface SiteTier { badge?: string; name: string; price: string; subtitle?: string; bullets: string[]; cta: SiteTierCta }
export interface SiteFaq { q: string; a: string }
export interface SiteAbout { name: string; photo?: string; bio: string; links: Array<{ label: string; href: string }> }
/** `features` points at the marketing site's product page (hemrock.com/reporting);
 *  the others are the repo and the read-only demo. All three feed the hero CTA row. */
export interface SiteLinks { github?: string; x?: string; demo?: string; features?: string }
/** A highlighted "hire me" card: an anchor with an optional badge and heading. */
export interface SiteCallout { badge?: string; title?: string; text: string; href: string }

export interface SiteContent {
  /** `emphasis` renders after the title in the display italic, in the brand accent
   *  — the one deliberate flourish in the hero. Omitted = plain headline. */
  hero: { title: string; subtitle: string; emphasis?: string }
  /** Proof figures under the hero. Empty = the strip isn't rendered. */
  stats: SiteStat[]
  productGroups: SiteProductGroup[]
  why: SiteWhy[]
  pricing: { note?: string; tiers: SiteTier[] }
  faqs: SiteFaq[]
  about: SiteAbout
  links: SiteLinks
  /** Optional personal CTA rendered as a highlighted card beside the About box.
   *  Its own field, separate from `heroCallout`, so the two can say different things. */
  cfoCallout?: SiteCallout
  /** The same card pulled up under the hero CTAs. Independent copy; falls back to
   *  `cfoCallout` when absent so JSON that only sets one still shows both cards. */
  heroCallout?: SiteCallout
}

// Allowlist of icons the JSON may reference by name. JSON can't hold components.
export const ICONS: Record<string, LucideIcon> = {
  Mail, Upload, LineChart, BarChart3, StickyNote, MessageCircle, Handshake, Briefcase,
  Microscope, FileText, Calculator, Lock, FolderOpen, ShieldCheck, Database, Brain,
  ShieldUser, Users, Lightbulb, Send, Play, Github, Circle,
  Crown, Landmark, Receipt, Percent, Eye, Coins, Search,
}

export function resolveIcon(name?: string): LucideIcon {
  return (name && Object.prototype.hasOwnProperty.call(ICONS, name) && ICONS[name]) || Circle
}

// ---- hand-rolled validation (no zod; cf. app/api/settings/theme/route.ts) ----
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const nonEmpty = (v: unknown): v is string => isStr(v) && v.trim().length > 0
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function feature(v: unknown): SiteFeature | null {
  if (!isObj(v) || !nonEmpty(v.title) || !isStr(v.text)) return null
  return {
    title: v.title, text: v.text,
    ...(isStr(v.screenshot) ? { screenshot: v.screenshot } : {}),
    ...(isStr(v.icon) ? { icon: v.icon } : {}),
  }
}

function group(v: unknown): SiteProductGroup | null {
  if (!isObj(v) || !nonEmpty(v.label) || !isStr(v.description)) return null
  const features = arr(v.features).map(feature).filter((f): f is SiteFeature => f !== null)
  if (features.length === 0) return null
  return {
    label: v.label, description: v.description, features,
    ...(isStr(v.key) && (orderedProducts() as string[]).includes(v.key) ? { key: v.key as ProductKey } : {}),
    ...(isStr(v.heroScreenshot) ? { heroScreenshot: v.heroScreenshot } : {}),
  }
}

function stat(v: unknown): SiteStat | null {
  if (!isObj(v) || !nonEmpty(v.value) || !nonEmpty(v.label)) return null
  return { value: v.value, label: v.label }
}

function why(v: unknown): SiteWhy | null {
  if (!isObj(v) || !nonEmpty(v.title) || !isStr(v.text)) return null
  return { title: v.title, text: v.text, ...(isStr(v.icon) ? { icon: v.icon } : {}) }
}

function tier(v: unknown): SiteTier | null {
  if (!isObj(v) || !nonEmpty(v.name) || !isStr(v.price)) return null
  const cta = isObj(v.cta) ? v.cta : {}
  const kind = cta.kind === 'calendly' || cta.kind === 'subscription' ? cta.kind : 'link'
  return {
    name: v.name, price: v.price,
    bullets: arr(v.bullets).filter(isStr),
    cta: { kind, label: isStr(cta.label) ? cta.label : '', ...(isStr(cta.href) ? { href: cta.href } : {}) },
    ...(isStr(v.badge) ? { badge: v.badge } : {}),
    ...(isStr(v.subtitle) ? { subtitle: v.subtitle } : {}),
  }
}

function faq(v: unknown): SiteFaq | null {
  if (!isObj(v) || !nonEmpty(v.q) || !isStr(v.a)) return null
  return { q: v.q, a: v.a }
}

function about(v: unknown): SiteAbout {
  if (!isObj(v)) return { name: '', bio: '', links: [] }
  const links = arr(v.links)
    .filter(isObj)
    .filter(l => nonEmpty(l.label) && nonEmpty(l.href))
    .map(l => ({ label: l.label as string, href: l.href as string }))
  return {
    name: isStr(v.name) ? v.name : '',
    bio: isStr(v.bio) ? v.bio : '',
    links,
    ...(isStr(v.photo) ? { photo: v.photo } : {}),
  }
}

function callout(v: unknown): SiteCallout | null {
  if (!isObj(v) || !nonEmpty(v.text) || !nonEmpty(v.href)) return null
  return {
    text: v.text, href: v.href,
    ...(nonEmpty(v.badge) ? { badge: v.badge } : {}),
    ...(nonEmpty(v.title) ? { title: v.title } : {}),
  }
}

function links(v: unknown): SiteLinks {
  if (!isObj(v)) return {}
  const out: SiteLinks = {}
  if (isStr(v.github)) out.github = v.github
  if (isStr(v.x)) out.x = v.x
  if (isStr(v.demo)) out.demo = v.demo
  if (isStr(v.features)) out.features = v.features
  return out
}

/** Validate a raw JSON blob into SiteContent, or null if the essential shape is absent.
 *  Essentials: a hero with a non-empty title+subtitle, and at least one valid product group. */
export function parseSiteContent(raw: unknown): SiteContent | null {
  if (!isObj(raw)) return null
  const hero = isObj(raw.hero) ? raw.hero : null
  if (!hero || !nonEmpty(hero.title) || !nonEmpty(hero.subtitle)) return null

  const productGroups = arr(raw.productGroups).map(group).filter((g): g is SiteProductGroup => g !== null)
  if (productGroups.length === 0) return null

  const pricingRaw = isObj(raw.pricing) ? raw.pricing : {}
  const foot = callout(raw.cfoCallout)
  const top = callout(raw.heroCallout)
  return {
    hero: {
      title: hero.title,
      subtitle: hero.subtitle,
      ...(nonEmpty(hero.emphasis) ? { emphasis: hero.emphasis } : {}),
    },
    stats: arr(raw.stats).map(stat).filter((s): s is SiteStat => s !== null),
    productGroups,
    why: arr(raw.why).map(why).filter((w): w is SiteWhy => w !== null),
    pricing: {
      tiers: arr(pricingRaw.tiers).map(tier).filter((t): t is SiteTier => t !== null),
      ...(isStr(pricingRaw.note) ? { note: pricingRaw.note } : {}),
    },
    faqs: arr(raw.faqs).map(faq).filter((f): f is SiteFaq => f !== null),
    about: about(raw.about),
    links: links(raw.links),
    ...(foot ? { cfoCallout: foot } : {}),
    ...(top ? { heroCallout: top } : {}),
  }
}
