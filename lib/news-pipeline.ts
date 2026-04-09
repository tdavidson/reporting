/**
 * lib/news-pipeline.ts  (v2.4)
 *
 * Key fix (v2.4):
 *   Pass 1 AI now ONLY classifies category — it no longer re-validates companyId.
 *   The deterministic match (name/alias/domain) is already reliable; asking the AI
 *   to confirm the UUID was the root cause of 0 articles being saved (AI returned
 *   null companyId → article silently dropped).
 *
 *   Pass 1 result: { index, category }  — category defaults to 'outro' if AI uncertain.
 *   Pass 2 (review) stays as-is: keep=true bias, manual delete in UX.
 */

import { createClient } from '@/lib/supabase/server'
import { decryptApiKey } from '@/lib/crypto'
import Anthropic from '@anthropic-ai/sdk'

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

type Company = {
  id: string
  name: string
  website: string | null
  aliases: string[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THREE_DAYS_MS   = 3 * 24 * 60 * 60 * 1000
const DEDUP_THRESHOLD = 0.60

const CURATED_SOURCE_NAMES = new Set([
  'Pipeline Valor', 'Brazil Journal PE/VC', 'NeoFeed Startups',
  'Finsiders Brasil', 'LATAM List Funding', 'Startups.com.br',
  'Startupi', 'Latam Fintech', 'Startups Latam', 'TechCrunch',
])

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
  return intersection / (setA.size + setB.size - intersection)
}

export function titleSimilarity(a: string, b: string): number {
  return Math.max(levenshteinSimilarity(a, b), tokenSetRatio(a, b))
}

// ---------------------------------------------------------------------------
// Article confidence score (for best-pick within a cluster)
// ---------------------------------------------------------------------------

function articleScore(a: RawArticle): number {
  let score = 0
  if (CURATED_SOURCE_NAMES.has(a.source)) score += 100
  score += Math.min(a.title.length, 200) / 10
  try {
    const age = Date.now() - new Date(a.pubDate).getTime()
    score += Math.max(0, 1 - age / THREE_DAYS_MS) * 10
  } catch { /* no pubDate */ }
  return score
}

// ---------------------------------------------------------------------------
// Deduplication: cluster + best-pick
// ---------------------------------------------------------------------------

function clusterAndPick(
  newArticles: RawArticle[],
  storedTitles: Array<{ companyId: string; title: string }>
): {
  canonical:  RawArticle[]
  skippedCount: number
  dbDupCount:   number
  dbDupByCompany: Map<string, number>
} {
  type Cluster = { articles: RawArticle[] }
  const clusters: Cluster[] = []

  for (const article of newArticles) {
    let placed = false
    for (const cluster of clusters) {
      const rep = cluster.articles[0]
      if (
        rep.companyId === article.companyId &&
        titleSimilarity(rep.title, article.title) >= DEDUP_THRESHOLD
      ) {
        cluster.articles.push(article)
        placed = true
        break
      }
    }
    if (!placed) clusters.push({ articles: [article] })
  }

  const candidates: RawArticle[] = clusters.map(c =>
    c.articles.reduce((best, cur) => articleScore(cur) > articleScore(best) ? cur : best)
  )
  const skippedCount = newArticles.length - candidates.length

  const dbDupByCompany = new Map<string, number>()
  const canonical: RawArticle[] = []

  for (const candidate of candidates) {
    const isInDB = storedTitles.some(
      s => s.companyId === candidate.companyId &&
           titleSimilarity(s.title, candidate.title) >= DEDUP_THRESHOLD
    )
    if (isInDB) {
      dbDupByCompany.set(
        candidate.companyId,
        (dbDupByCompany.get(candidate.companyId) ?? 0) + 1
      )
    } else {
      canonical.push(candidate)
    }
  }

  const dbDupCount = [...dbDupByCompany.values()].reduce((s, v) => s + v, 0)
  return { canonical, skippedCount, dbDupCount, dbDupByCompany }
}

// ---------------------------------------------------------------------------
// Multi-source definitions
// ---------------------------------------------------------------------------

const CURATED_SOURCES = [
  { name: 'Pipeline Valor',       url: 'https://pipelinevalor.globo.com/negocios/' },
  { name: 'Brazil Journal PE/VC', url: 'https://braziljournal.com/hot-topic/private-equity-vc/' },
  { name: 'NeoFeed Startups',     url: 'https://neofeed.com.br/startups/' },
  { name: 'Finsiders Brasil',     url: 'https://finsidersbrasil.com.br/ultimas-noticias/' },
  { name: 'LATAM List Funding',   url: 'https://latamlist.com/category/startup-news/funding/' },
  { name: 'Startups.com.br',      url: 'https://startups.com.br/ultimas-noticias/' },
  { name: 'Startupi',             url: 'https://startupi.com.br/noticias/' },
  { name: 'Latam Fintech',        url: 'https://www.latamfintech.co/articles' },
  { name: 'Startups Latam',       url: 'https://startupslatam.com/' },
  { name: 'TechCrunch',           url: 'https://techcrunch.com/latest/' },
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
      try { const base = new URL(baseUrl); href = `${base.origin}${href}` } catch { continue }
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
    return parseHTMLArticles(text, source.url).map(i => ({ ...i, sourceName: source.name }))
  } catch {
    return []
  }
}

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
      const coDomain  = extractDomain(company.website)
      const allNames  = [company.name, ...company.aliases]
      const allTokens = allNames.flatMap(n => n.toLowerCase().split(/\s+/)).filter(t => t.length >= 4)
      const matched =
        (coDomain && (domain.includes(coDomain) || item.link.includes(coDomain))) ||
        allNames.some(n => titleLower.includes(n.toLowerCase())) ||
        allTokens.some(tok => titleLower.includes(tok))
      if (matched) {
        result.push({ title: item.title, link: item.link, pubDate: item.pubDate,
          source: item.sourceName, sourceDomain: domain, companyId: company.id, companyName: company.name })
        break
      }
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// RSS / Google News
// ---------------------------------------------------------------------------

function parseRSSItems(xml: string, companyId: string, companyName: string): RawArticle[] {
  const cutoff = Date.now() - THREE_DAYS_MS
  return Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g))
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

async function fetchGoogleNews(company: Company): Promise<RawArticle[]> {
  try {
    const domain    = extractDomain(company.website)
    const nameParts = [`"${company.name}"`]
    for (const alias of company.aliases) {
      if (alias && alias !== company.name) nameParts.push(`"${alias}"`)
    }
    let q = `(${nameParts.join(' OR ')}) when:3d`
    if (domain) q += ` OR site:${domain}`
    const res = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsReader/1.0)' }, signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return []
    return parseRSSItems(await res.text(), company.id, company.name)
  } catch { return [] }
}

// ---------------------------------------------------------------------------
// Deterministic pre-filter
// ---------------------------------------------------------------------------

function deterministicPreFilter(articles: RawArticle[], companies: Company[]): RawArticle[] {
  const coMap = new Map(
    companies.map(c => [
      c.id,
      {
        domain:    extractDomain(c.website),
        allNames:  [c.name, ...c.aliases].map(n => n.toLowerCase()),
        allTokens: [c.name, ...c.aliases].flatMap(n => n.toLowerCase().split(/\s+/)).filter(t => t.length >= 4),
      },
    ] as const)
  )
  return articles.filter(a => {
    const co = coMap.get(a.companyId)
    if (!co) return false
    const tl = a.title.toLowerCase()
    if (co.domain && a.sourceDomain.includes(co.domain)) return true
    if (co.allNames.some(n => tl.includes(n)))           return true
    if (co.allTokens.some(tok => tl.includes(tok)))      return true
    return false
  })
}

// ---------------------------------------------------------------------------
// Retry wrapper
// ---------------------------------------------------------------------------

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3, label = 'AI call'): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await fn() } catch (e) {
      lastError = e
      const delay = 500 * Math.pow(2, attempt - 1)
      console.warn(`[news-pipeline] ${label} attempt ${attempt}/${maxAttempts} failed (retry in ${delay}ms):`, e)
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastError
}

// ---------------------------------------------------------------------------
// JSON validation
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set<string>([
  'rodada', 'aquisicao', 'parceria', 'contratacao',
  'produto', 'expansao', 'premio', 'crise', 'ipo', 'outro',
])

interface CategoryResult { index: number; category: NewsCategory }
interface ReviewResult   { index: number; keep: boolean }

function validateCategoryResult(raw: unknown): CategoryResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const index = typeof r.index === 'number' ? r.index : null
  if (index === null) return null
  const rawCat = typeof r.category === 'string' ? r.category : null
  const category = (rawCat && VALID_CATEGORIES.has(rawCat)) ? rawCat as NewsCategory : 'outro'
  return { index, category }
}

function validateReviewResult(raw: unknown): ReviewResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r    = raw as Record<string, unknown>
  const index = typeof r.index === 'number' ? r.index : null
  if (index === null) return null
  const keep = typeof r.keep === 'boolean' ? r.keep : true
  return { index, keep }
}

// ---------------------------------------------------------------------------
// AI Pass 1 — classify category only
// companyId is TRUSTED from deterministic match — AI only assigns category.
// If AI returns null/unknown category → defaults to 'outro' (never drops article).
// ---------------------------------------------------------------------------

async function classifyCategories(
  anthropic: Anthropic,
  articles: RawArticle[],
): Promise<CategoryResult[]> {
  const articleList = articles.map((a, i) =>
    `[${i}] "${a.title}" · company: ${a.companyName} · source: ${a.sourceDomain} · date: ${formatPubDate(a.pubDate)}`
  ).join('\n')

  const prompt = `Classify each news article into one category.
Categories: rodada | aquisicao | parceria | contratacao | produto | expansao | premio | crise | ipo | outro

Articles:
${articleList}

Rules:
- rodada: funding round, investment, capital raise
- aquisicao: M&A, acquisition, merger
- parceria: partnership, deal, contract
- contratacao: hiring, new executive, C-level appointment
- produto: product launch, new feature, update
- expansao: geographic expansion, new market, new office
- premio: award, recognition, ranking
- crise: layoffs, shutdown, legal trouble, scandal
- ipo: IPO, public offering, listing
- outro: anything else

Respond ONLY with a JSON array — no markdown:
[{"index":0,"category":"rodada"},{"index":1,"category":"outro"}]`

  const raw = await withRetry(async () => {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5', max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })
    return msg.content[0]?.type === 'text' ? msg.content[0].text : '[]'
  }, 3, 'classifyCategories')

  const match = raw.match(/\[[\s\S]*\]/)
  let parsed: unknown[] = []
  try { parsed = match ? JSON.parse(match[0]) : [] } catch {
    console.warn('[news-pipeline] classifyCategories: JSON parse failed — defaulting all to outro')
  }

  // Build results map; any missing index defaults to 'outro'
  const resultsMap = new Map<number, NewsCategory>()
  for (const item of parsed) {
    const v = validateCategoryResult(item)
    if (v) resultsMap.set(v.index, v.category)
  }

  return articles.map((_, i) => ({
    index: i,
    category: resultsMap.get(i) ?? 'outro',
  }))
}

// ---------------------------------------------------------------------------
// AI Pass 2 — review (bias: keep=true when uncertain)
// ---------------------------------------------------------------------------

async function reviewArticles(
  anthropic: Anthropic,
  candidates: NewsArticle[],
  companies: Company[]
): Promise<NewsArticle[]> {
  if (candidates.length === 0) return []

  const coById = new Map(companies.map(c => [c.id, { ...c, domain: extractDomain(c.website) }]))

  const articleList = candidates.map((a, i) => {
    const co       = coById.get(a.companyId)
    const aliasStr = (co?.aliases.length ?? 0) > 0 ? ` / aliases: ${co!.aliases.join(', ')}` : ''
    return `[${i}] company: "${co?.name}"${aliasStr}${co?.domain ? ` (${co.domain})` : ''} | title: "${a.title}" | source: ${a.sourceDomain}`
  }).join('\n')

  const prompt = `You are a quality reviewer for a VC fund news feed.
Remove OBVIOUS false positives only — articles that clearly refer to a DIFFERENT company.

Rules:
- keep: true  when company name OR any alias appears in title, OR source is company website
- keep: true  when UNCERTAIN — user will manually delete incorrect articles
- keep: false ONLY when article clearly refers to a different entity (name collision, different industry)

Articles:
${articleList}

Respond ONLY with a JSON array — no markdown:
[{"index":0,"keep":true},{"index":1,"keep":false}]`

  const raw = await withRetry(async () => {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5', max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })
    return msg.content[0]?.type === 'text' ? msg.content[0].text : '[]'
  }, 3, 'reviewArticles')

  const match = raw.match(/\[.*\]/s)
  let parsed: unknown[] = []
  try { parsed = match ? JSON.parse(match[0]) : [] } catch {
    console.warn('[news-pipeline] reviewArticles: JSON parse failed — keeping all')
    return candidates
  }
  const results: ReviewResult[] = []
  for (const item of parsed) {
    const v = validateReviewResult(item)
    if (v) results.push(v)
    else console.warn('[news-pipeline] reviewArticles: invalid item, keep=true:', JSON.stringify(item))
  }
  return candidates.filter((_, i) => {
    const r = results.find(x => x.index === i)
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
    if (fs?.claude_api_key_encrypted && fs?.encryption_key_encrypted)
      apiKey = decryptApiKey(fs.claude_api_key_encrypted, fs.encryption_key_encrypted)
  } catch (e) { console.error('[news-pipeline] failed to decrypt fund API key:', e) }
  return apiKey ?? process.env.ANTHROPIC_API_KEY
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DBCompany = { id: string; name: string; website: string | null }
type DBAlias   = { company_id: string; alias: string }

function buildCompanyList(dbCompanies: DBCompany[], dbAliases: DBAlias[]): Company[] {
  const aliasMap = new Map<string, string[]>()
  for (const row of dbAliases) {
    if (!aliasMap.has(row.company_id)) aliasMap.set(row.company_id, [])
    aliasMap.get(row.company_id)!.push(row.alias)
  }
  return dbCompanies.map(c => ({ id: c.id, name: c.name, website: c.website, aliases: aliasMap.get(c.id) ?? [] }))
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
  const { data: dbCompanies } = await supabase
    .from('companies')
    .select('id, name, website')
    .eq('fund_id', fundId)
    .eq('status', 'active')
    .order('name') as { data: DBCompany[] | null }

  const rawList = dbCompanies ?? []
  if (rawList.length === 0) return { added: 0, duplicates: 0, total: 0, byCompany: [], ranAt }

  // 2. Load aliases
  const companyIds = rawList.map(c => c.id)
  const { data: dbAliases } = await sdb
    .from('company_aliases').select('company_id, alias').in('company_id', companyIds) as { data: DBAlias[] | null }

  const list = buildCompanyList(rawList, dbAliases ?? [])

  // 3a. Google News
  const googleBatches  = await Promise.all(list.map(c => fetchGoogleNews(c)))
  const googleArticles = googleBatches.flat()

  // 3b. Curated sources
  const curatedBatches = await Promise.allSettled(CURATED_SOURCES.map(s => fetchCuratedSource(s)))
  const curatedRaw = curatedBatches
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchCuratedSource>>> => r.status === 'fulfilled')
    .flatMap(r => r.value)
  const curatedArticles = matchCuratedArticles(curatedRaw, list)

  // 4. Merge + URL-exact dedup
  const seenUrls = new Set<string>()
  const allRaw: RawArticle[] = []
  for (const a of [...googleArticles, ...curatedArticles]) {
    const key = normalizeUrl(a.link)
    if (!seenUrls.has(key)) { seenUrls.add(key); allRaw.push(a) }
  }
  const total = allRaw.length

  // 5. Deterministic name filter
  const preFiltered = deterministicPreFilter(allRaw, list)

  // 6. Resolve API key
  const apiKey = await resolveApiKey(fundId, supabase)
  if (!apiKey) {
    console.warn('[news-pipeline] no Anthropic API key — aborting')
    return { added: 0, duplicates: 0, total, byCompany: [], ranAt }
  }

  // 7. Fetch already-stored titles via date range
  const cutoffISO = new Date(Date.now() - THREE_DAYS_MS).toISOString()
  const { data: recentStored } = await sdb
    .from('news_articles')
    .select('link, title, company_id')
    .eq('fund_id', fundId)
    .gte('scraped_at', cutoffISO) as { data: Array<{ link: string; title: string; company_id: string }> | null }

  const storedRows    = recentStored ?? []
  const storedLinkSet = new Set<string>(storedRows.map(r => normalizeUrl(r.link)))
  const storedTitles  = storedRows.map(r => ({ companyId: r.company_id, title: r.title }))

  // 8. Remove URL-exact matches already in DB
  const newArticles = preFiltered.filter(a => !storedLinkSet.has(normalizeUrl(a.link)))

  if (newArticles.length === 0) {
    return { added: 0, duplicates: 0, total, byCompany: [], ranAt }
  }

  // 9. Cluster + best-pick
  const { canonical, skippedCount, dbDupCount, dbDupByCompany } =
    clusterAndPick(newArticles, storedTitles)

  console.log(`[news-pipeline] cluster: ${newArticles.length} new → ${canonical.length} canonical, ${skippedCount} intra-run merged, ${dbDupCount} already in DB`)

  if (canonical.length === 0) {
    const byCompany: RefreshSummaryByCompany[] = []
    for (const [companyId, dups] of dbDupByCompany.entries()) {
      const co = list.find(c => c.id === companyId)
      if (co) byCompany.push({ companyId, companyName: co.name, added: 0, duplicates: dups })
    }
    return { added: 0, duplicates: dbDupCount, total, byCompany, ranAt }
  }

  // 10. AI: classify category (Pass 1) + review false positives (Pass 2)
  const anthropic = new Anthropic({ apiKey })
  let enriched: NewsArticle[] = []

  try {
    // Pass 1: category only — companyId/companyName come from deterministic match
    const categoryResults = await classifyCategories(anthropic, canonical)
    const pass1: NewsArticle[] = canonical.map((article, i) => ({
      ...article,
      category: categoryResults[i]?.category ?? 'outro',
    }))

    // Pass 2: remove obvious false positives (keep=true bias)
    enriched = await reviewArticles(anthropic, pass1, list)
  } catch (e) {
    console.error('[news-pipeline] AI pipeline failed after retries — saving with category=outro:', e)
    // Fallback: save everything that passed deterministic filter
    enriched = canonical.map(a => ({ ...a, category: 'outro' as NewsCategory }))
  }

  // 11. Upsert
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

  // 12. Per-company summary
  const byCompanyMap = new Map<string, RefreshSummaryByCompany>()
  for (const c of list) byCompanyMap.set(c.id, { companyId: c.id, companyName: c.name, added: 0, duplicates: 0 })
  for (const a of enriched) { const e = byCompanyMap.get(a.companyId); if (e) e.added++ }
  for (const [companyId, dups] of dbDupByCompany.entries()) {
    const e = byCompanyMap.get(companyId)
    if (e) e.duplicates += dups
  }

  return {
    added:      enriched.length,
    duplicates: dbDupCount,
    total,
    byCompany:  [...byCompanyMap.values()].filter(x => x.added > 0 || x.duplicates > 0),
    ranAt,
  }
}
