import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

const cache = new Map<string, { data: RawArticle[]; expiresAt: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000
const AI_CACHE = new Map<string, { articles: NewsArticle[]; expiresAt: number }>()

export type NewsRelevance = 'featured' | 'mentioned'

export interface NewsArticle {
  title: string
  link: string
  pubDate: string
  source: string
  sourceDomain: string
  companyId: string
  companyName: string
  relevance: NewsRelevance
}

type RawArticle = Omit<NewsArticle, 'relevance'>

const TLD_TO_COUNTRY: Record<string, string> = {
  'com': 'US', 'us': 'US', 'co.uk': 'UK', 'uk': 'UK',
  'com.br': 'BR', 'br': 'BR', 'de': 'DE', 'fr': 'FR',
  'es': 'ES', 'it': 'IT', 'ca': 'CA', 'au': 'AU',
  'co.au': 'AU', 'in': 'IN', 'co.in': 'IN', 'jp': 'JP',
  'cn': 'CN', 'sg': 'SG', 'io': 'TECH', 'ai': 'TECH',
}

function domainToCountry(domain: string): string {
  const d = domain.toLowerCase()
  for (const [suffix, country] of Object.entries(TLD_TO_COUNTRY)) {
    if (d.endsWith('.' + suffix) || d === suffix) return country
  }
  return 'US'
}

function getDateCutoff(dateRange: string): number | null {
  const now = new Date()
  if (dateRange === '24h') return Date.now() - 86400000
  if (dateRange === '7d') return Date.now() - 7 * 86400000
  if (dateRange === '30d') return Date.now() - 30 * 86400000
  if (dateRange === 'ytd') return new Date(now.getFullYear(), 0, 1).getTime()
  if (dateRange === 'lastyear') return new Date(now.getFullYear() - 1, 0, 1).getTime()
  return null
}

function getDateCeiling(dateRange: string): number | null {
  if (dateRange === 'lastyear') {
    const y = new Date().getFullYear() - 1
    return new Date(y, 11, 31, 23, 59, 59, 999).getTime()
  }
  return null
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    return (u.hostname + u.pathname).replace(/\/+$/, '').toLowerCase()
  } catch {
    return url.toLowerCase().trim()
  }
}

function extractDomain(website: string | null): string | null {
  if (!website) return null
  try {
    const url = website.startsWith('http') ? website : `https://${website}`
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function formatPubDate(dateStr: string): string {
  try { return new Date(dateStr).toISOString().split('T')[0] } catch { return dateStr }
}

function parseRSSItems(xml: string, companyId: string, companyName: string): RawArticle[] {
  const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g))
  return items.slice(0, 15).map(match => {
    const block = match[1]
    const title = block.match(/<title>(.*?)<\/title>/)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? ''
    const link = block.match(/<link\s*\/?>(.*?)(?:<\/link>|$)/)?.[1]?.trim()
      ?? block.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? ''
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? ''
    const source = block.match(/<source[^>]*>(.*?)<\/source>/)?.[1]?.trim() ?? 'Google News'
    const sourceUrl = block.match(/<source[^>]*url="([^"]*)"/)?.[1] ?? ''
    let sourceDomain = ''
    try { sourceDomain = new URL(sourceUrl).hostname.replace(/^www\./, '') } catch { sourceDomain = source.toLowerCase() }
    return { title, link, pubDate, source, sourceDomain, companyId, companyName }
  }).filter(a => a.title && a.link)
}

async function fetchCompanyNews(
  companyId: string,
  companyName: string,
  sources: string[],
  websiteDomain: string | null
): Promise<RawArticle[]> {
  const allSources = websiteDomain
    ? Array.from(new Set([...sources, websiteDomain]))
    : sources

  const cacheKey = `news:${companyId}:${[...allSources].sort().join(',')}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  try {
    let q1 = `"${companyName}"`
    if (allSources.length > 0) q1 += ` (${allSources.map(s => `site:${s}`).join(' OR ')})`

    const q2 = `${companyName} startup OR funding OR rodada OR investimento OR lançamento OR aquisição`

    const [res1, res2] = await Promise.allSettled([
      fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q1)}&hl=pt-BR&gl=BR&ceid=BR:pt`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsReader/1.0)' },
        signal: AbortSignal.timeout(6000),
      }),
      fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q2)}&hl=pt-BR&gl=BR&ceid=BR:pt`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsReader/1.0)' },
        signal: AbortSignal.timeout(6000),
      }),
    ])

    const articles: RawArticle[] = []
    const seen = new Set<string>()
    for (const r of [res1, res2]) {
      if (r.status !== 'fulfilled' || !r.value.ok) continue
      const xml = await r.value.text()
      for (const a of parseRSSItems(xml, companyId, companyName)) {
        const key = normalizeUrl(a.link)
        if (!seen.has(key)) { seen.add(key); articles.push(a) }
      }
    }

    cache.set(cacheKey, { data: articles, expiresAt: Date.now() + CACHE_TTL_MS })
    return articles
  } catch {
    return []
  }
}

type ClassifyResult = {
  index: number
  companyId: string | null
  relevance: NewsRelevance | null
}

type ReviewResult = {
  index: number
  keep: boolean
  reason?: string
}

// Pass 1 — classify articles: assign companyId + relevance
async function classifyArticles(
  anthropic: Anthropic,
  articles: RawArticle[],
  companies: { id: string; name: string; website: string | null }[]
): Promise<ClassifyResult[]> {
  const companyList = companies.map(c => {
    const domain = extractDomain(c.website)
    return `- id: ${c.id} | name: ${c.name}${domain ? ` | website: ${domain}` : ''}`
  }).join('\n')

  const articleList = articles.map((a, i) =>
    `[${i}] "${a.title}" · source: ${a.sourceDomain} · date: ${formatPubDate(a.pubDate)}`
  ).join('\n')

  const prompt = `You are a financial news classifier for a VC fund portfolio.

Portfolio companies (id | name | website domain):
${companyList}

News articles fetched from Google News for these companies (index · title · source · date):
${articleList}

IMPORTANT CONTEXT: These articles were already pre-filtered by Google News using the company name as a search query. Most articles WILL be relevant. Your job is to confirm the match and classify.

For each article return:
- companyId: UUID of the matching portfolio company. Use company name in title, known aliases, OR source domain matching company website as signals. Assign the most likely match.
- relevance:
  - "featured"  — company is the PRIMARY subject (funding, product launch, acquisition, IPO, exec change, legal issue, partnership announcement, etc.)
  - "mentioned" — company is clearly named or referenced but not the main subject
  - null        — article has absolutely no connection to any portfolio company (pure sector/macro news)

Rules:
- If the source domain matches a company’s website domain, that is a strong positive signal.
- Articles in Portuguese (PT-BR) are valid.
- Only return null when you are confident the article has zero connection to any portfolio company.
- Default to assigning the company whose name was used to fetch this article.

Respond ONLY with a JSON array, no explanation:
[{"index":0,"companyId":"uuid","relevance":"featured"},{"index":1,"companyId":null,"relevance":null}]`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '[]'
  const match = raw.match(/\[.*\]/s)
  try { return match ? JSON.parse(match[0]) : [] } catch { return [] }
}

// Pass 2 — review: remove obvious false positives only
async function reviewArticles(
  anthropic: Anthropic,
  candidates: NewsArticle[],
  companies: { id: string; name: string; website: string | null }[]
): Promise<NewsArticle[]> {
  if (candidates.length === 0) return []

  const companyById = new Map(
    companies.map(c => [c.id, { ...c, domain: extractDomain(c.website) }])
  )

  const articleList = candidates.map((a, i) => {
    const co = companyById.get(a.companyId)
    return `[${i}] company: "${co?.name}"${co?.domain ? ` (${co.domain})` : ''} | title: "${a.title}" | source: ${a.sourceDomain} | tag: ${a.relevance}`
  }).join('\n')

  const prompt = `You are a quality reviewer for a VC fund news feed. Articles below were classified as relevant to specific portfolio companies.

Your ONLY job is to remove obvious false positives — articles that have clearly zero connection to the assigned company.

Articles:
${articleList}

For each article:
- keep: true by default. Only set false if the article is OBVIOUSLY about a completely different company or topic.
- reason: brief note only when keep is false.

Guidelines:
- If the company name or a close variant appears anywhere in the title → always keep: true.
- If the source domain is the company’s own website → always keep: true.
- If there is reasonable doubt → keep: true (benefit of the doubt).
- Only mark keep: false for clear-cut mismatches (e.g. article about "Apple" assigned to a Brazilian fintech).

Respond ONLY with a JSON array:
[{"index":0,"keep":true},{"index":1,"keep":false,"reason":"Article is about Apple, not the portfolio company"}]`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '[]'
  const match = raw.match(/\[.*\]/s)
  let results: ReviewResult[] = []
  try { results = match ? JSON.parse(match[0]) : [] } catch { /* on parse fail keep all */ }

  return candidates.filter((_, i) => {
    const r = results.find(x => x.index === i)
    return !r || r.keep !== false
  })
}

async function aiEnrichAndFilter(
  articles: RawArticle[],
  companies: { id: string; name: string; website: string | null }[]
): Promise<NewsArticle[]> {
  if (articles.length === 0) return []

  const aiCacheKey = articles.map(a => a.link).sort().join('|')
  const aiCached = AI_CACHE.get(aiCacheKey)
  if (aiCached && aiCached.expiresAt > Date.now()) return aiCached.articles

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const companyMap = new Map(companies.map(c => [c.id, c.name]))

    // Pass 1: classify
    const classified = await classifyArticles(anthropic, articles, companies)
    const pass1: NewsArticle[] = articles
      .map((article, i) => {
        const r = classified.find(x => x.index === i)
        if (!r || r.companyId === null || r.relevance === null) return null
        const name = companyMap.get(r.companyId)
        if (!name) return null
        return { ...article, companyId: r.companyId, companyName: name, relevance: r.relevance }
      })
      .filter((a): a is NewsArticle => a !== null)

    // Pass 2: reject obvious false positives
    const pass2 = await reviewArticles(anthropic, pass1, companies)

    AI_CACHE.set(aiCacheKey, { articles: pass2, expiresAt: Date.now() + CACHE_TTL_MS })
    return pass2
  } catch (e) {
    console.error('[news] AI pipeline failed:', e)
    // Fallback: return all articles as mentioned to avoid empty state
    return articles.map(a => ({ ...a, relevance: 'mentioned' as NewsRelevance }))
  }
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: membership } = await supabase
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle() as { data: { fund_id: string } | null }
  if (!membership) return NextResponse.json({ error: 'No fund' }, { status: 403 })

  const companiesParam = req.nextUrl.searchParams.get('companies')
  const sourcesParam = req.nextUrl.searchParams.get('sources')
  const dateRange = req.nextUrl.searchParams.get('dateRange')
  const countryFilter = req.nextUrl.searchParams.get('country')
  const bust = req.nextUrl.searchParams.get('bust')

  if (bust) { cache.clear(); AI_CACHE.clear() }

  const sources = sourcesParam ? sourcesParam.split(',').map(s => s.trim()).filter(Boolean) : []

  const { data: companies } = await supabase
    .from('companies')
    .select('id, name, website')
    .eq('fund_id', membership.fund_id)
    .eq('status', 'active')
    .order('name') as { data: { id: string; name: string; website: string | null }[] | null }

  const list = (companies ?? []).filter(c =>
    !companiesParam || companiesParam.split(',').includes(c.id)
  )

  const results = await Promise.all(
    list.map(c => fetchCompanyNews(c.id, c.name, sources, extractDomain(c.website)))
  )
  let articles = results.flat()

  const seen = new Set<string>()
  articles = articles.filter(a => {
    const key = normalizeUrl(a.link)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (dateRange && dateRange !== 'all') {
    const cutoff = getDateCutoff(dateRange)
    const ceiling = getDateCeiling(dateRange)
    if (cutoff !== null) {
      articles = articles.filter(a => {
        const t = new Date(a.pubDate).getTime()
        return t >= cutoff && (ceiling === null || t <= ceiling)
      })
    }
  }

  if (countryFilter && countryFilter !== 'all') {
    articles = articles.filter(a => domainToCountry(a.sourceDomain) === countryFilter)
  }

  const enriched = await aiEnrichAndFilter(articles, list)

  const relevanceOrder: Record<NewsRelevance, number> = { featured: 0, mentioned: 1 }
  const sorted = enriched.sort((a, b) => {
    const rDiff = relevanceOrder[a.relevance] - relevanceOrder[b.relevance]
    if (rDiff !== 0) return rDiff
    return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  })

  const countriesInResults = Array.from(new Set(sorted.map(a => domainToCountry(a.sourceDomain)))).sort()

  return NextResponse.json({ articles: sorted, companies: list, countriesInResults })
}
