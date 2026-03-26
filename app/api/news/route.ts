import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

const cache = new Map<string, { data: RawArticle[]; expiresAt: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000
const AI_CACHE = new Map<string, { articles: NewsArticle[]; expiresAt: number }>()

export type NewsRelevance = 'featured' | 'mentioned' | 'related'

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
  try {
    return new Date(dateStr).toISOString().split('T')[0]
  } catch {
    return dateStr
  }
}

async function fetchRSS(query: string): Promise<RawArticle[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=BR&ceid=BR:pt`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsReader/1.0)' },
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) return []
  return res.text().then(xml => parseRSSItems(xml, '', ''))
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
    // Query 1: exact name match (with optional site filters)
    let q1 = `"${companyName}"`
    if (allSources.length > 0) {
      q1 += ` (${allSources.map(s => `site:${s}`).join(' OR ')})`
    }

    // Query 2: broader — name without quotes to catch partial matches & PT-BR content
    const q2 = `${companyName} startup OR funding OR rodada OR investimento OR lançamento`

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

type AIResult = {
  index: number
  companyId: string | null
  relevance: NewsRelevance | null
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

    const companyList = companies.map(c => {
      const domain = extractDomain(c.website)
      return `- id: ${c.id} | name: ${c.name}${domain ? ` | website: ${domain}` : ''}`
    }).join('\n')

    // Pass title + source domain + date for richer classification
    const articleList = articles.map((a, i) =>
      `[${i}] "${a.title}" · ${a.sourceDomain} · ${formatPubDate(a.pubDate)}`
    ).join('\n')

    const prompt = `You are a financial news classifier for a VC fund. Your job is to tag news articles with the correct portfolio company and relevance level.

Portfolio companies:
${companyList}

News articles (index · title · source domain · date):
${articleList}

For each article, determine:
1. companyId — UUID of the portfolio company this article is primarily about. Use the company name, website domain, and context clues (funding, product, executive names) to decide. Return null if the article is not about any portfolio company.
2. relevance:
   - "featured"  — company IS the main subject (funding round, product launch, executive change, acquisition, IPO, etc.)
   - "mentioned" — company is clearly named but is not the main subject
   - "related"   — article is about the company's market/sector but does not name it directly
   - null        — unrelated; discard

Important rules:
- Articles in Portuguese (PT-BR) are valid — do not discard based on language.
- Use the source domain to help disambiguate (e.g. a company's own blog domain = high confidence).
- A recent date combined with a relevant title is a strong signal.
- When companyId is null, relevance must also be null.
- Do NOT guess. If genuinely ambiguous, return null for both.

Respond ONLY with a JSON array, no explanation or markdown:
[{"index":0,"companyId":"uuid-here","relevance":"featured"},{"index":1,"companyId":null,"relevance":null}]`

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = message.content[0]?.type === 'text' ? message.content[0].text : '[]'
    const jsonMatch = raw.match(/\[.*\]/s)
    let results: AIResult[] = []
    try { results = jsonMatch ? JSON.parse(jsonMatch[0]) : [] } catch { /* fallback */ }

    const companyMap = new Map(companies.map(c => [c.id, c.name]))

    const enriched = articles
      .map((article, i) => {
        const match = results.find((r: AIResult) => r.index === i)
        if (!match || match.companyId === null || match.relevance === null) return null
        const name = companyMap.get(match.companyId)
        if (!name) return null
        return { ...article, companyId: match.companyId, companyName: name, relevance: match.relevance }
      })
      .filter((a): a is NewsArticle => a !== null)

    AI_CACHE.set(aiCacheKey, { articles: enriched, expiresAt: Date.now() + CACHE_TTL_MS })
    return enriched
  } catch (e) {
    console.error('[news] Claude enrichment failed, skipping:', e)
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

  // Clear in-memory caches on forced refresh
  if (bust) {
    cache.clear()
    AI_CACHE.clear()
  }

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

  // Deduplicate by normalized URL
  const seen = new Set<string>()
  articles = articles.filter(a => {
    const key = normalizeUrl(a.link)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Date filter
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

  // Country filter
  if (countryFilter && countryFilter !== 'all') {
    articles = articles.filter(a => domainToCountry(a.sourceDomain) === countryFilter)
  }

  // Claude enrichment: fix attribution + relevance tag
  const enriched = await aiEnrichAndFilter(articles, list)

  // Sort: featured first, then by date
  const relevanceOrder: Record<NewsRelevance, number> = { featured: 0, mentioned: 1, related: 2 }
  const sorted = enriched.sort((a, b) => {
    const rDiff = relevanceOrder[a.relevance] - relevanceOrder[b.relevance]
    if (rDiff !== 0) return rDiff
    return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  })

  const countriesInResults = Array.from(new Set(sorted.map(a => domainToCountry(a.sourceDomain)))).sort()

  return NextResponse.json({ articles: sorted, companies: list, countriesInResults })
}
