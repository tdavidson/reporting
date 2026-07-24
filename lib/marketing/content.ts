import { Circle, Mail, Upload, LineChart, BarChart3, StickyNote, MessageCircle, Handshake, Briefcase, Microscope, FileText, Calculator, Lock, FolderOpen, ShieldCheck, Database, Brain, ShieldUser, Users, Lightbulb, Send, Play, Github } from 'lucide-react'
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
export interface SiteWhy { icon?: string; title: string; text: string }
export interface SiteTierCta { kind: 'link' | 'calendly' | 'subscription'; label: string; href?: string }
export interface SiteTier { badge?: string; name: string; price: string; subtitle?: string; bullets: string[]; cta: SiteTierCta }
export interface SiteFaq { q: string; a: string }
export interface SiteAbout { name: string; photo?: string; bio: string; links: Array<{ label: string; href: string }> }
export interface SiteLinks { github?: string; x?: string; demo?: string }

export interface SiteContent {
  hero: { title: string; subtitle: string }
  productGroups: SiteProductGroup[]
  why: SiteWhy[]
  pricing: { note?: string; tiers: SiteTier[] }
  faqs: SiteFaq[]
  about: SiteAbout
  links: SiteLinks
}

// Allowlist of icons the JSON may reference by name. JSON can't hold components.
export const ICONS: Record<string, LucideIcon> = {
  Mail, Upload, LineChart, BarChart3, StickyNote, MessageCircle, Handshake, Briefcase,
  Microscope, FileText, Calculator, Lock, FolderOpen, ShieldCheck, Database, Brain,
  ShieldUser, Users, Lightbulb, Send, Play, Github, Circle,
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

function links(v: unknown): SiteLinks {
  if (!isObj(v)) return {}
  const out: SiteLinks = {}
  if (isStr(v.github)) out.github = v.github
  if (isStr(v.x)) out.x = v.x
  if (isStr(v.demo)) out.demo = v.demo
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
  return {
    hero: { title: hero.title, subtitle: hero.subtitle },
    productGroups,
    why: arr(raw.why).map(why).filter((w): w is SiteWhy => w !== null),
    pricing: {
      tiers: arr(pricingRaw.tiers).map(tier).filter((t): t is SiteTier => t !== null),
      ...(isStr(pricingRaw.note) ? { note: pricingRaw.note } : {}),
    },
    faqs: arr(raw.faqs).map(faq).filter((f): f is SiteFaq => f !== null),
    about: about(raw.about),
    links: links(raw.links),
  }
}
