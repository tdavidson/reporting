/**
 * lib/news-pipeline.ts  (v2)
 *
 * Shared news pipeline — used by:
 *   - POST /api/news/refresh  (manual, returns RefreshSummary)
 *   - GET  /api/news/cron     (scheduled, fire-and-forget)
 *
 * Changes from v1:
 *   1. Multi-source RSS/HTML — same 10 sources as vc-market scrapers.ts
 *   2. Hybrid dedup: Levenshtein + token-set ratio (more robust)
 *   3. No MAX_PER_COMPANY cap — all articles within time window are considered
 *   4. Pass 2 bias: "when in doubt → keep: true" (prefer recall over precision)
 *   5. JSON validation via manual schema check — silent drop replaced by warn+fallback
 *   6. Retry wrapper (3 attempts, exponential back-off) on Anthropic calls
 *   7. Structured per-call logging for observability
 */

import { createClient } from '@/lib/supabase/server'
import { decryptApiKey } from '@/lib/crypto'
import Anthropic from '@anthropic-ai/sdk'

// ---------------------------------------------------------------------------
// Escape hatch for tables not yet in generated Supabase types
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (supabase: ReturnType<typeof createClient>) => supabase as any

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
  total: number
  byCompany: RefreshSummaryByCompany[]
  ranAt: string
}

type RawArticle = Omit<NewsArticle, 'category' | 'isDuplicate' | 'duplicateOf'>
type Company    = { id: string; name: string; website: string | null }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THREE_DAYS_MS   = 3 * 24 * 60 * 60 * 1000
// Slightly lower threshold than v1 to reduce false-dedup on different events
// for the same company. Hybrid scorer (max of Levenshtein + token-set) is
// more robust, so we can afford a tighter threshold.
const DEDUP_THRESHOLD = 0.60

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
// Hybrid title similarity
//
// Combines:
//   a) Levenshtein edit distance (good for near-identical strings)
//   b) Token-set ratio / Jaccard (good for same-event, different wording)
//
// Final score = max(levenshtein_sim, token_set_ratio)
// This catches pairs like:
//   "Startup X levanta R$10M em rodada Série A"
//   "Startup X conclui Série A de R$10 milhões"
// which score low on Levenshtein but high on token overlap.
// ---------------------------------------------------------------------------

function levenshteinSimilarity(a: string, b: string): number {
  const s1 = a.toLowerCase().slice(0, 200)
  const s2 = b.toLowerCase().slice(0, 200)
  if (s1 === s2) return 1
  const len = Math.max(s1.length, s2.length)
  if (len === 0) return 1

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

function tokenSetRatio(a: string, b: string): number {
  // Tokenise: lowercase, split on non-alphanumeric, drop stopwords & short tokens
  const stopwords = new Set([
    'de', 'da', 'do', 'em', 'no', 'na', 'para', 'com', 'por', 'que',
    'the', 'a', 'an', 'in', 'on', 'at', 'to', 'of', 'and', 'or', 'is',
    'e', 'o', 'os', 'as', 'um', 'uma',
  ])
  const tokenise = (s: string) =>
    new Set(
      s.toLowerCase()
        .split(/[^a-z0-9áàãâéêíóôõúüçñ]+/)
        .filter(t => t.length >= 3 && !stopwords.has(t))
    )

  const setA = tokenise(a)
  const setB = tokenise(b)
  if (setA.size === 0 && setB.size === 0) return 1
  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  for (const t of setA) if (setB.has(t)) intersection++

  const union = setA.size + setB.size - intersection
  return intersection / union
}

export function titleSimilarity(a: string, b: string): number {
  return Math.max(levenshteinSimilarity(a, b), tokenSetRatio(a, b))
}

// ---------------------------------------------------------------------------
// Semantic deduplication
// ---------------------------------------------------------------------------

function semanticDedup(articles: RawArticle[]): { canonical: RawArticle[]; duplicateLinks: Set<string> } {
  const canonical: RawArticle[] = []
  const duplicateLinks = new Set<string>()

  for (const article of articles) {
    const isDup = canonical.some(
      c => c.companyId === article.companyId &&
           titleSimilarity(c.title, article.title) >= DEDUP_THRESHOLD
    )
    if (isDup) duplicateLinks.add(article.link)
    else       canonical.push(article)
  }

  return { canonical, duplicateLinks }
}

// ---------------------------------------------------------------------------
// Multi-source definitions (mirrors vc-market/scrapers.ts SOURCES)
// ---------------------------------------------------------------------------

const CURATED_SOURCES = [
  { name: 'Pipeline Valor',         url: 'https://pipelinevalor.globo.com/negocios/',                          type: 'html' as const },
  { name: 'Brazil Journal PE/VC',   url: 'https://braziljournal.com/hot-topic/private-equity-vc/',             type: 'html' as const },
  { name: 'NeoFeed Startups',       url: 'https://neofeed.com.br/startups/',                                   type: 'html' as const },
  { name: 'Finsiders Brasil',       url: 'https://finsidersbrasil.com.br/ultimas-noticias/',                   type: 'html' as const },
  { name: 'LATAM List Funding',     url: 'https://latamlist.com/category/startup-news/funding/',               type: 'html' as const },
  { name: 'Startups.com.br',        url: 'https://startups.com.br/ultimas-noticias/',                         type: 'html' as const },
  { name: 'Startupi',               url: 'https://startupi.com.br/noticias/',                                  type: 'html' as const },
  { name: 'Latam Fintech',          url: 'https://www.latamfintech.co/articles',                               type: 'html' as const },
  { name: 'Startups Latam',         url: 'https://startupslatam.com/',                                         type: 'html' as const },
  { name: 'TechCrunch',             url: 'https://techcrunch.com/latest/',                                     type: 'html' as const },
]

// ---------------------------------------------------------------------------
// HTML parsing for curated sources
// ---------------------------------------------------------------------------

function parseHTMLArticles(html: string, baseUrl: string): Array<{ title: string; link: string; pubDate: string }> {
  const items: Array<{ title: string; link: string; pubDate: string }> = []
  const seen = new Set<string>()

  const dateHints: string[] = []
  for (const m of html.matchAll(/<time[^>]*(?:datetime=["']([^"']+)["'])[^>]*>/g)) {
    dateHints.push(m[1])
  }

  let idx = 0
  for (const match of html.matchAll(/<a[^>]+href=["']([^"'#?][^"']*)['"'][^>]*>([\s\S]*?)<\/a>/g)) {
    const rawHref = match[1]
    const rawText = match[2].replace(/<[^>]+>/g, '').trim()

    if (rawText.length < 20) continue
    if (/^(home|menu|login|sign|subscribe|newsletter|sobre|contato|privacy|terms)/i.test(rawText)) continue

    let href = rawHref
    if (href.startsWith('/')) {
      try {
        const base = new URL(baseUrl)
        href = `${base.origin}${href}`
      } catch { continue }
    }
    if (!href.startsWith('http')) continue
    if (seen.has(href)) continue
    seen.add(href)

    items.push({ title: cleanTitle(rawText), link: href, pubDate: dateHints[idx] ?? '' })
    idx++
    if (items.length >= 50) break
  }

  return items
}

async function fetchCuratedSource(
  source: typeof CURATED_SOURCES[0]
): Promise<Array<{ title: string; link: string; pubDate: string; sourceName: string }>> {
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsReader/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return []
    const text = await res.text()
    const items = parseHTMLArticles(text, source.url)
    return items.map(i => ({ ...i, sourceName: source.name }))
  } catch {
    return []
  }
}

/**
 * Match curated articles against portfolio companies.
 * An article matches if the company name (or a significant token ≥5 chars)
 * appears in the title, OR the article's domain matches the company's website.
 */
function matchCuratedArticles(
  curatedItems: Array<{ title: string; link: string; pubDate: string; sourceName: string }>,
  companies: Company[],
): RawArticle[] {
  const cutoff = Date.now() - THREE_DAYS_MS
  const result: RawArticle[] = []

  for (const item of curatedItems) {
    if (!item.title || !item.link) continue
    if (item.pubDate) {
      const ts = new Date(item.pubDate).getTime()
      if (!isNaN(ts) && ts < cutoff) continue
    }

    const titleLower = item.title.toLowerCase()
    let domain = ''
    try { domain = new URL(item.link).hostname.replace(/^www\./, '') } catch { /* ignore */ }

    for (const company of companies) {
      const coName   = company.name.toLowerCase()
      const coDomain = extractDomain(company.website)
      const coTokens = company.name.toLowerCase().split(/\s+/).filter(t => t.length >= 5)

      const matched =
        (coDomain && (domain.includes(coDomain) || item.link.includes(coDomain))) ||
        titleLower.includes(coName) ||
        coTokens.some(tok => titleLower.includes(tok))

      if (matched) {
        result.push({
          title:        item.title,
          link:         item.link,
          pubDate:      item.pubDate,
          source:       item.sourceName,
          sourceDomain: domain,
          companyId:    company.id,
          companyName:  company.name,
        })
        break
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// RSS parsing (Google News per-company — no per-company cap)
// ---------------------------------------------------------------------------

function parseRSSItems(xml: string, companyId: string, companyName: string): RawArticle[] {
  const cutoff = Date.now() - THREE_DAYS_MS
  const items  = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g))

  // No MAX_PER_COMPANY cap — take all items within the time window
  return items
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
      if (!a.title || !a.link)      return false
      if (isGoogleNewsLink(a.link)) return false
      if (a.pubDate) {
        const ts = new Date(a.pubDate).getTime()
        if (!isNaN(ts) && ts < cutoff) return false
      }
      return true
    })
}

async function fetchGoogleNews(
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
// Deterministic pre-filter
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
// Retry wrapper (3 attempts, exponential back-off)
// ---------------------------------------------------------------------------

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  label = 'AI call',
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      const delay = 500 * Math.pow(2, attempt - 1)  // 500ms, 1s, 2s
      console.warn(`[news-pipeline] ${label} attempt ${attempt}/${maxAttempts} failed (retry in ${delay}ms):`, e)
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastError
}

// ---------------------------------------------------------------------------
// Manual JSON validation (replaces silent drops)
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set<string>([
  'rodada', 'aquisicao', 'parceria', 'contratacao',
  'produto', 'expansao', 'premio', 'crise', 'ipo', 'outro',
])

function isValidUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

interface ClassifyResult { index: number; companyId: string | null; category: NewsCategory | null }
interface ReviewResult   { index: number; keep: boolean }

function validateClassifyResult(raw: unknown): ClassifyResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const index = typeof r.index === 'number' ? r.index : null
  if (index === null) return null
  const companyId = (typeof r.companyId === 'string' && isValidUUID(r.companyId)) ? r.companyId : null
  const rawCat    = typeof r.category === 'string' ? r.category : null
  const category  = (rawCat && VALID_CATEGORIES.has(rawCat)) ? rawCat as NewsCategory : null
  return { index, companyId, category }
}

function validateReviewResult(raw: unknown): ReviewResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r     = raw as Record<string, unknown>
  const index = typeof r.index === 'number' ? r.index : null
  if (index === null) return null
  // Default keep=true when field is missing — pass 2 recall bias
  const keep  = typeof r.keep === 'boolean' ? r.keep : true
  return { index, keep }
}

// ---------------------------------------------------------------------------
// AI Pass 1 — classify
// ---------------------------------------------------------------------------

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
1. Source domain matches company website domain -> assign that company
2. Company name (or clear variant/acronym) appears in title -> assign and classify
3. Otherwise -> null, null. Do NOT guess from industry.

Respond ONLY with a JSON array — no markdown, no commentary:
[{"index":0,"companyId":"uuid","category":"rodada"},{"index":1,"companyId":null,"category":null}]`

  const raw = await withRetry(async () => {
    const msg = await anthropic.messages.create({
      model:      'claude-haiku-4-5',
      max_tokens: 2048,
      messages:   [{ role: 'user', content: prompt }],
    })
    return msg.content[0]?.type === 'text' ? msg.content[0].text : '[]'
  }, 3, 'classifyArticles')

  const match = raw.match(/\[[\s\S]*\]/)
  let parsed: unknown[] = []
  try { parsed = match ? JSON.parse(match[0]) : [] } catch {
    console.warn('[news-pipeline] classifyArticles: JSON parse failed, raw:', raw.slice(0, 200))
  }

  const results: ClassifyResult[] = []
  for (const item of parsed) {
    const v = validateClassifyResult(item)
    if (v) results.push(v)
    else   console.warn('[news-pipeline] classifyArticles: invalid item dropped:', JSON.stringify(item))
  }
  return results
}

// ---------------------------------------------------------------------------
// AI Pass 2 — review
// BIAS: keep=true when uncertain — user can delete false positives from the UX.
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
Remove OBVIOUS false positives only — articles that clearly refer to a DIFFERENT company.

Rules:
- keep: true  if company name (or clear variant) appears in title, OR source domain is the company's website
- keep: true  if you are UNCERTAIN — the user will manually delete incorrect articles if needed
- keep: false ONLY if the article clearly refers to a different entity (name collision, different industry, etc.)

Articles:
${articleList}

Respond ONLY with a JSON array — no markdown, no commentary:
[{"index":0,"keep":true},{"index":1,"keep":false}]`

  const raw = await withRetry(async () => {
    const msg = await anthropic.messages.create({
      model:      'claude-haiku-4-5',
      max_tokens: 1024,
      messages:   [{ role: 'user', content: prompt }],
    })
    return msg.content[0]?.type === 'text' ? msg.content[0].text : '[]'
  }, 3, 'reviewArticles')

  const match = raw.match(/\[.*\]/s)
  let parsed: unknown[] = []
  try {
    parsed = match ? JSON.parse(match[0]) : []
  } catch {
    // If JSON is unparseable, keep everything (recall bias)
    console.warn('[news-pipeline] reviewArticles: JSON parse failed — keeping all candidates')
    return candidates
  }

  const results: ReviewResult[] = []
  for (const item of parsed) {
    const v = validateReviewResult(item)
    if (v) results.push(v)
    else   console.warn('[news-pipeline] reviewArticles: invalid item, defaulting keep=true:', JSON.stringify(item))
  }

  return candidates.filter((_, i) => {
    const r = results.find(x => x.index === i)
    // keep=true if no result found for this index (recall bias)
    return !r || r.keep !== false
  })
}

// ---------------------------------------------------------------------------
// Resolve Anthropic API key
// ---------------------------------------------------------------------------

async function resolveApiKey(
  fundId: string,
  supabase: ReturnType<typeof createClient>
): Promise<string | undefined> {
  const { data: fs } = await db(supabase)
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
// Main pipeline
// ---------------------------------------------------------------------------

export async function runNewsPipeline(
  fundId: string,
  supabase: ReturnType<typeof createClient>
): Promise<RefreshSummary> {
  const ranAt = new Date().toISOString()
  const sdb   = db(supabase)

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

  // 2a. Fetch Google News RSS per company (personalised query, no cap)
  const googleBatches = await Promise.all(
    list.map(c => fetchGoogleNews(c.id, c.name, extractDomain(c.website)))
  )
  const googleArticles = googleBatches.flat()

  // 2b. Fetch curated LATAM/BR sources once (same 10 as vc-market)
  const curatedBatches = await Promise.allSettled(
    CURATED_SOURCES.map(s => fetchCuratedSource(s))
  )
  const curatedRaw = curatedBatches
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchCuratedSource>>> => r.status === 'fulfilled')
    .flatMap(r => r.value)

  // Match curated articles to portfolio companies
  const curatedArticles = matchCuratedArticles(curatedRaw, list)

  // 3. Merge + URL-level dedup
  const seenUrls = new Set<string>()
  const allRaw: RawArticle[] = []
  for (const a of [...googleArticles, ...curatedArticles]) {
    const key = normalizeUrl(a.link)
    if (!seenUrls.has(key)) { seenUrls.add(key); allRaw.push(a) }
  }
  const total = allRaw.length

  // 4. Deterministic pre-filter
  const preFiltered = deterministicPreFilter(allRaw, list)

  // 5. Semantic dedup per company (hybrid Levenshtein + token-set)
  const { canonical, duplicateLinks } = semanticDedup(preFiltered)

  // 6. Resolve API key
  const apiKey = await resolveApiKey(fundId, supabase)
  if (!apiKey) {
    console.warn('[news-pipeline] no Anthropic API key — aborting AI pass')
    return { added: 0, duplicates: duplicateLinks.size, total, byCompany: [], ranAt }
  }

  // 7. Exclude already-stored links
  const canonicalLinks = canonical.map(a => a.link)
  const { data: existing } = await sdb
    .from('news_articles')
    .select('link')
    .eq('fund_id', fundId)
    .in('link', canonicalLinks)

  const existingLinkSet = new Set<string>((existing ?? []).map((r: { link: string }) => r.link))
  const toClassify = canonical.filter(a => !existingLinkSet.has(a.link))

  if (toClassify.length === 0) {
    const byCompany = list
      .map(c => ({
        companyId:   c.id,
        companyName: c.name,
        added:       0,
        duplicates:  [...duplicateLinks].filter(
          l => canonical.find(a => a.link === l)?.companyId === c.id
        ).length,
      }))
      .filter(x => x.added > 0 || x.duplicates > 0)
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
    console.error('[news-pipeline] AI pipeline failed after retries:', e)
    // Fallback: keep articles with literal name match, categorise as 'outro'
    enriched = toClassify
      .filter(a => {
        const co = list.find(c => c.id === a.companyId)
        return co && a.title.toLowerCase().includes(co.name.toLowerCase())
      })
      .map(a => ({ ...a, category: 'outro' as NewsCategory }))
  }

  // 9. Upsert
  if (enriched.length > 0) {
    await sdb.from('news_articles').upsert(
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

  // 10. Mark semantic duplicates
  if (duplicateLinks.size > 0) {
    await sdb
      .from('news_articles')
      .update({ is_duplicate: true })
      .eq('fund_id', fundId)
      .in('link', [...duplicateLinks])
  }

  // 11. Build per-company summary
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

  return {
    added:      enriched.length,
    duplicates: duplicateLinks.size,
    total,
    byCompany:  [...byCompanyMap.values()].filter(x => x.added > 0 || x.duplicates > 0),
    ranAt,
  }
}
