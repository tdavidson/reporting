/**
 * lib/news-pipeline.ts
 *
 * Shared news pipeline used by both:
 *   - POST /api/news/refresh  (manual, returns RefreshSummary)
 *   - GET  /api/news/cron     (scheduled, fire-and-forget)
 *
 * Responsibilities:
 *   1. Fetch Google News RSS for each active company (last 3 days window)
 *   2. Deterministic pre-filter (company name / domain must appear)
 *   3. Semantic deduplication per company (Levenshtein-normalised ≤ 0.35 = same event)
 *   4. AI classify (Pass 1) + AI review (Pass 2) via Claude Haiku
 *   5. Upsert to news_articles, mark duplicates
 *   6. Return RefreshSummary
 */

import { createClient } from '@/lib/supabase/server'
import { decryptApiKey } from '@/lib/crypto'
import Anthropic from '@anthropic-ai/sdk'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NewsCategory =
  | 'rodada'
  | 'aquisicao'
  | 'parceria'
  | 'contratacao'
  | 'produto'
  | 'expansao'
  | 'premio'
  | 'crise'
  | 'ipo'
  | 'outro'

export interface NewsArticle {
  title: string
  link: string
  pubDate: string
  source: string
  sourceDomain: string
  companyId: string
  companyName: string
  category: NewsCategory
  isDuplicate?: boolean
  duplicateOf?: string | null
}

export interface RefreshSummaryByCompany {
  companyId: string
  companyName: string
  added: number
  duplicates: number
}

export interface RefreshSummary {
  added: number
  duplicates: number
  total: number       // articles scraped before dedup
  byCompany: RefreshSummaryByCompany[]
  ranAt: string       // ISO timestamp
}

type RawArticle = Omit<NewsArticle, 'category' | 'isDuplicate' | 'duplicateOf'>
type Company    = { id: string; name: string; website: string | null }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Only articles published in the last 3 days are considered */
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

/** Levenshtein similarity threshold — titles above this are "same event" */
const DEDUP_THRESHOLD = 0.65

/** Max articles to keep per company after fetching */
const MAX_PER_COMPANY = 20

// ---------------------------------------------------------------------------
// String / URL helpers
// ---------------------------------------------------------------------------

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    return (u.hostname + u.pathname).replace(/\/+$/, '').toLowerCase()
  } catch {
    return url.toLowerCase().trim()
  }
}

export function extractDomain(website: string | null): string | null {
  if (!website) return null
  try {
    const url = website.startsWith('http') ? website : `https://${website}`
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function cleanTitle(title: string): string {
  return title.replace(/\s+[-\u2013\u2014]\s+[^-\u2013\u2014]+$/, '').trim()
}

function isGoogleNewsLink(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h === 'news.google.com' || h.endsWith('.news.google.com')
  } catch {
    return false
  }
}

function formatPubDate(dateStr: string): string {
  try { return new Date(dateStr).toISOString().split('T')[0] } catch { return dateStr }
}

// ---------------------------------------------------------------------------
// Levenshtein-based title similarity  (O(n*m), capped at 200 chars)
// ---------------------------------------------------------------------------

function titleSimilarity(a: string, b: string): number {
  const s1 = a.toLowerCase().slice(0, 200)
  const s2 = b.toLowerCase().slice(0, 200)
  if (s1 === s2) return 1
  const len = Math.max(s1.length, s2.length)
  if (len === 0) return 1

  // dp row-by-row
  let row = Array.from({ length: s2.length + 1 }, (_, i) => i)
  for (let i = 1; i <= s1.length; i++) {
    let prev = i
    for (let j = 1; j <= s2.length; j++) {
      const temp = row[j]
      row[j] = s1[i - 1] === s2[j - 1]
        ? row[j - 1]
        : 1 + Math.min(row[j - 1], row[j], prev)
      prev = temp
    }
  }
  return 1 - row[s2.length] / len
}

// ---------------------------------------------------------------------------
// Semantic deduplication — per company, keeps canonical article
// ---------------------------------------------------------------------------

function semanticDedup(articles: RawArticle[]): { canonical: RawArticle[]; duplicateLinks: Set<string> } {
  const canonical: RawArticle[]     = []
  const duplicateLinks = new Set<string>()

  for (const article of articles) {
    const isDup = canonical.some(
      c => c.companyId === article.companyId &&
           titleSimilarity(c.title, article.title) >= DEDUP_THRESHOLD
    )
    if (isDup) {
      duplicateLinks.add(article.link)
    } else {
      canonical.push(article)
    }
  }

  return { canonical, duplicateLinks }
}

// ---------------------------------------------------------------------------
// RSS parsing
// ---------------------------------------------------------------------------

function parseRSSItems(xml: string, companyId: string, companyName: string): RawArticle[] {
  const cutoff = Date.now() - THREE_DAYS_MS
  const items  = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g))

  return items
    .slice(0, MAX_PER_COMPANY)
    .map(match => {
      const block      = match[1]
      const rawTitle   = block.match(/<title>(.*?)<\/title>/)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? ''
      const title      = cleanTitle(rawTitle)
      const link       =
        block.match(/<link\s*\/?>(.*?)(?:<\/link>|$)/)?.[1]?.trim() ??
        block.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? ''
      const pubDate    = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? ''
      const source     = block.match(/<source[^>]*>(.*?)<\/source>/)?.[1]?.trim() ?? 'Google News'
      const sourceUrl  = block.match(/<source[^>]*url="([^"]*)"/)?.[1] ?? ''
      let sourceDomain = ''
      try { sourceDomain = new URL(sourceUrl).hostname.replace(/^www\./, '') } catch { sourceDomain = source.toLowerCase() }
      return { title, link, pubDate, source, sourceDomain, companyId, companyName }
    })
    .filter(a => {
      if (!a.title || !a.link)             return false
      if (isGoogleNewsLink(a.link))        return false
      // Hard 3-day cutoff
      if (a.pubDate) {
        const ts = new Date(a.pubDate).getTime()
        if (!isNaN(ts) && ts < cutoff)     return false
      }
      return true
    })
}

async function fetchCompanyNews(
  companyId: string,
  companyName: string,
  websiteDomain: string | null
): Promise<RawArticle[]> {
  try {
    let q = `"${companyName}" when:3d`
    if (websiteDomain) q += ` OR site:${websiteDomain}`

    const res = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsReader/1.0)' },
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!res.ok) return []
    const xml = await res.text()
    return parseRSSItems(xml, companyId, companyName)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Deterministic pre-filter (reduces AI cost)
// ---------------------------------------------------------------------------

function deterministicPreFilter(articles: RawArticle[], companies: Company[]): RawArticle[] {
  const coMap = new Map(
    companies.map(c => [
      c.id,
      {
        name:   c.name,
        domain: extractDomain(c.website),
        tokens: c.name.toLowerCase().split(/\s+/).filter(t => t.length >= 4),
      },
    ] as const)
  )

  return articles.filter(a => {
    const co = coMap.get(a.companyId)
    if (!co) return false
    const tl = a.title.toLowerCase()
    if (co.domain && a.sourceDomain.includes(co.domain)) return true
    if (tl.includes(co.name.toLowerCase()))              return true
    if (co.tokens.some(tok => tl.includes(tok)))         return true
    return false
  })
}

// ---------------------------------------------------------------------------
// AI Pass 1 — classify
// ---------------------------------------------------------------------------

type ClassifyResult = { index: number; companyId: string | null; category: NewsCategory | null }
type ReviewResult   = { index: number; keep: boolean }

async function classifyArticles(
  anthropic: Anthropic,
  articles: RawArticle[],
  companies: Company[]
): Promise<ClassifyResult[]> {
  const companyList = companies.map(c => {
    const domain = extractDomain(c.website)
    return `- id: ${c.id} | name: ${c.name}${domain ? ` | website: ${domain}` : ''}`
  }).join('\n')

  const articleList = articles.map((a, i) =>
    `[${i}] "${a.title}" · source: ${a.sourceDomain} · date: ${formatPubDate(a.pubDate)}`
  ).join('\n')

  const prompt = `You are a strict financial news classifier for a VC fund portfolio.

Portfolio companies:
${companyList}

News articles:
${articleList}

For each article return companyId (UUID or null) and category (or null).

Categories: rodada | aquisicao | parceria | contratacao | produto | expansao | premio | crise | ipo | outro

Rules (apply in order):
1. Source domain matches company website domain → assign that company
2. Company name (or clear variant/acronym) appears in title → assign and classify
3. Otherwise → null, null. Do NOT guess from industry.

Respond ONLY with JSON array:
[{"index":0,"companyId":"uuid","category":"rodada"},{"index":1,"companyId":null,"category":null}]`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = msg.content[0]?.type === 'text' ? msg.content[0].text : '[]'
  const match = raw.match(/\[[\s\S]*\]/)
  try { return match ? JSON.parse(match[0]) : [] } catch { return [] }
}

// ---------------------------------------------------------------------------
// AI Pass 2 — review (remove false positives)
// ---------------------------------------------------------------------------

async function reviewArticles(
  anthropic: Anthropic,
  candidates: NewsArticle[],
  companies: Company[]
): Promise<NewsArticle[]> {
  if (candidates.length === 0) return []

  const coById = new Map(companies.map(c => [c.id, { ...c, domain: extractDomain(c.website) }]))

  const articleList = candidates.map((a, i) => {
    const co = coById.get(a.companyId)
    return `[${i}] company: "${co?.name}"${co?.domain ? ` (${co.domain})` : ''} | title: "${a.title}" | source: ${a.sourceDomain}`
  }).join('\n')

  const prompt = `You are a quality reviewer for a VC fund news feed.
Remove false positives — articles NOT genuinely about the assigned company.

Rules:
- keep: true if company name (or clear variant) appears in title OR source domain is the company's website
- keep: false if title does not mention the company, or article is about a different entity
- When in doubt → keep: false

Articles:
${articleList}

Respond ONLY with JSON array:
[{"index":0,"keep":true},{"index":1,"keep":false}]`

  const msg   = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = msg.content[0]?.type === 'text' ? msg.content[0].text : '[]'
  const match = raw.match(/\[.*\]/s)
  let results: ReviewResult[] = []
  try { results = match ? JSON.parse(match[0]) : [] } catch { /* use empty */ }

  return candidates.filter((_, i) => {
    const r = results.find(x => x.index === i)
    return !r || r.keep !== false
  })
}

// ---------------------------------------------------------------------------
// Resolve Anthropic API key from fund settings or env
// ---------------------------------------------------------------------------

async function resolveApiKey(
  fundId: string,
  supabase: ReturnType<typeof createClient>
): Promise<string | undefined> {
  const { data: fs } = await supabase
    .from('fund_settings')
    .select('claude_api_key_encrypted, encryption_key_encrypted')
    .eq('fund_id', fundId)
    .maybeSingle()

  let apiKey: string | undefined
  try {
    if (fs?.claude_api_key_encrypted && fs?.encryption_key_encrypted) {
      apiKey = decryptApiKey(fs.claude_api_key_encrypted, fs.encryption_key_encrypted)
    }
  } catch (e) {
    console.error('[news-pipeline] failed to decrypt fund API key:', e)
  }
  return apiKey ?? process.env.ANTHROPIC_API_KEY
}

// ---------------------------------------------------------------------------
// Main pipeline entry point
// ---------------------------------------------------------------------------

export async function runNewsPipeline(
  fundId: string,
  supabase: ReturnType<typeof createClient>
): Promise<RefreshSummary> {
  const ranAt = new Date().toISOString()

  // 1. Load active companies
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name, website')
    .eq('fund_id', fundId)
    .eq('status', 'active')
    .order('name') as { data: Company[] | null }

  const list = companies ?? []
  if (list.length === 0) {
    return { added: 0, duplicates: 0, total: 0, byCompany: [], ranAt }
  }

  // 2. Fetch RSS concurrently
  const fetched = await Promise.all(
    list.map(c => fetchCompanyNews(c.id, c.name, extractDomain(c.website)))
  )

  // 3. Flatten + URL-level exact dedup across all companies
  const seenUrls = new Set<string>()
  const allRaw: RawArticle[] = []
  for (const batch of fetched) {
    for (const a of batch) {
      const key = normalizeUrl(a.link)
      if (!seenUrls.has(key)) {
        seenUrls.add(key)
        allRaw.push(a)
      }
    }
  }

  const total = allRaw.length

  // 4. Deterministic pre-filter
  const preFiltered = deterministicPreFilter(allRaw, list)

  // 5. Semantic dedup per company
  const { canonical, duplicateLinks } = semanticDedup(preFiltered)

  // 6. Resolve API key
  const apiKey = await resolveApiKey(fundId, supabase)
  if (!apiKey) {
    console.warn('[news-pipeline] no Anthropic API key — aborting AI pass')
    return { added: 0, duplicates: duplicateLinks.size, total, byCompany: [], ranAt }
  }

  // 7. Exclude already-stored links
  const canonicalLinks = canonical.map(a => a.link)
  const { data: existing } = await supabase
    .from('news_articles')
    .select('link')
    .eq('fund_id', fundId)
    .in('link', canonicalLinks)

  const existingLinkSet = new Set((existing ?? []).map((r: any) => r.link as string))
  const toClassify = canonical.filter(a => !existingLinkSet.has(a.link))

  if (toClassify.length === 0) {
    // Everything is already in DB — mark duplicates and return
    const byCompany = list.map(c => ({
      companyId:   c.id,
      companyName: c.name,
      added:       0,
      duplicates:  [...duplicateLinks].filter(l => canonical.find(a => a.link === l)?.companyId === c.id).length,
    })).filter(x => x.added > 0 || x.duplicates > 0)

    return { added: 0, duplicates: duplicateLinks.size, total, byCompany, ranAt }
  }

  // 8. AI classify + review
  const anthropic  = new Anthropic({ apiKey })
  const companyMap = new Map(list.map(c => [c.id, c.name]))

  let enriched: NewsArticle[] = []

  try {
    const classified = await classifyArticles(anthropic, toClassify, list)

    const pass1: NewsArticle[] = toClassify
      .map((article, i) => {
        const r = classified.find(x => x.index === i)
        if (!r || r.companyId === null || r.category === null) return null
        const name = companyMap.get(r.companyId)
        if (!name) return null
        return { ...article, companyId: r.companyId, companyName: name, category: r.category }
      })
      .filter((a): a is NewsArticle => a !== null)

    enriched = await reviewArticles(anthropic, pass1, list)
  } catch (e) {
    console.error('[news-pipeline] AI pipeline failed:', e)
    // Graceful fallback: company name in title
    enriched = toClassify
      .filter(a => {
        const co = list.find(c => c.id === a.companyId)
        return co && a.title.toLowerCase().includes(co.name.toLowerCase())
      })
      .map(a => ({ ...a, category: 'outro' as NewsCategory }))
  }

  // 9. Upsert newly classified articles
  if (enriched.length > 0) {
    await supabase.from('news_articles').upsert(
      enriched.map(a => ({
        fund_id:       fundId,
        company_id:    a.companyId,
        company_name:  a.companyName,
        title:         a.title,
        link:          a.link,
        pub_date:      a.pubDate ? new Date(a.pubDate).toISOString() : new Date().toISOString(),
        source:        a.source,
        source_domain: a.sourceDomain,
        category:      a.category,
        is_duplicate:  false,
        scraped_at:    new Date().toISOString(),
      })),
      { onConflict: 'fund_id,link', ignoreDuplicates: true }
    )
  }

  // 10. Mark semantic duplicates in DB
  if (duplicateLinks.size > 0) {
    await supabase
      .from('news_articles')
      .update({ is_duplicate: true })
      .eq('fund_id', fundId)
      .in('link', [...duplicateLinks])
  }

  // 11. Build summary per company
  const byCompanyMap = new Map<string, RefreshSummaryByCompany>()
  for (const c of list) {
    byCompanyMap.set(c.id, { companyId: c.id, companyName: c.name, added: 0, duplicates: 0 })
  }
  for (const a of enriched) {
    const entry = byCompanyMap.get(a.companyId)
    if (entry) entry.added++
  }
  for (const link of duplicateLinks) {
    const article = preFiltered.find(a => a.link === link)
    if (article) {
      const entry = byCompanyMap.get(article.companyId)
      if (entry) entry.duplicates++
    }
  }

  const byCompany = [...byCompanyMap.values()].filter(x => x.added > 0 || x.duplicates > 0)

  return {
    added:      enriched.length,
    duplicates: duplicateLinks.size,
    total,
    byCompany,
    ranAt,
  }
}
