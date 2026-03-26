import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import OpenAI from 'openai'

const cache = new Map<string, { data: NewsArticle[]; expiresAt: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000
const AI_CACHE = new Map<string, { articles: NewsArticle[]; expiresAt: number }>()

export interface NewsArticle {
  title: string
  link: string
  pubDate: string
  source: string
  sourceDomain: string
  companyId: string
  companyName: string
}

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

async function fetchCompanyNews(
  companyId: string,
  companyName: string,
  sources: string[]
): Promise<NewsArticle[]> {
  const cacheKey = `news:${companyId}:${[...sources].sort().join(',')}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  try {
    let queryStr = `"${companyName}"`
    if (sources.length > 0) {
      const siteFilters = sources.map(s => `site:${s}`).join(' OR ')
      queryStr += ` (${siteFilters})`
    }

    const query = encodeURIComponent(queryStr)
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsReader/1.0)' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []

    const xml = await res.text()
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g))

    const articles: NewsArticle[] = items.slice(0, 10).map(match => {
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

    cache.set(cacheKey, { data: articles, expiresAt: Date.now() + CACHE_TTL_MS })
    return articles
  } catch {
    return []
  }
}

type AIResult = { index: number; companyId: string | null }

async function aiEnrichAndFilter(
  articles: NewsArticle[],
  companies: { id: string; name: string }[]
): Promise<NewsArticle[]> {
  if (articles.length === 0) return []

  const aiCacheKey = articles.map(a => a.link).sort().join('|')
  const aiCached = AI_CACHE.get(aiCacheKey)
  if (aiCached && aiCached.expiresAt > Date.now()) return aiCached.articles

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const companyList = companies.map(c => `${c.id}:${c.name}`).join('\n')
    const articleList = articles
      .map((a, i) => `[${i}] ${a.title}`)
      .join('\n')

    const prompt = `You are a financial news classifier for a VC fund.

Companies in the portfolio:
${companyList}

News articles (index: title):
${articleList}

For each article, identify which portfolio company is the PRIMARY subject of the news.
Rules:
- Only assign a company if the article is CLEARLY about that specific company.
- If the article mentions a company only tangentially or as context, return null.
- If the article is about a competitor, market trend, or unrelated topic, return null.
- Do NOT guess. When in doubt, return null.

Respond ONLY with a JSON array. Example:
[{"index":0,"companyId":"uuid-here"},{"index":1,"companyId":null}]`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    })

    const raw = response.choices[0]?.message?.content ?? '{}'
    // model may return {"results": [...]} or just [...]
    let results: AIResult[] = []
    try {
      const parsed = JSON.parse(raw)
      results = Array.isArray(parsed) ? parsed : (parsed.results ?? parsed.articles ?? Object.values(parsed)[0] ?? [])
    } catch { /* fallback: keep all */ }

    const companyMap = new Map(companies.map(c => [c.id, c.name]))

    const enriched = articles
      .map((article, i) => {
        const match = results.find((r: AIResult) => r.index === i)
        if (!match) return article // no AI result → keep as-is
        if (match.companyId === null) return null // AI says not relevant → discard
        const name = companyMap.get(match.companyId)
        if (!name) return null
        return { ...article, companyId: match.companyId, companyName: name }
      })
      .filter((a): a is NewsArticle => a !== null)

    AI_CACHE.set(aiCacheKey, { articles: enriched, expiresAt: Date.now() + CACHE_TTL_MS })
    return enriched
  } catch (e) {
    console.error('[news] AI enrichment failed, skipping:', e)
    return articles
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

  const sources = sourcesParam ? sourcesParam.split(',').map(s => s.trim()).filter(Boolean) : []

  const { data: companies } = await supabase
    .from('companies')
    .select('id, name')
    .eq('fund_id', membership.fund_id)
    .eq('status', 'active')
    .order('name') as { data: { id: string; name: string }[] | null }

  const list = (companies ?? []).filter(c =>
    !companiesParam || companiesParam.split(',').includes(c.id)
  )

  // 1. Fetch raw articles per company
  const results = await Promise.all(list.map(c => fetchCompanyNews(c.id, c.name, sources)))
  let articles = results.flat()

  // 2. Deduplicate by normalized URL
  const seen = new Set<string>()
  articles = articles.filter(a => {
    const key = normalizeUrl(a.link)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // 3. Date filter
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

  // 4. Country filter
  if (countryFilter && countryFilter !== 'all') {
    articles = articles.filter(a => domainToCountry(a.sourceDomain) === countryFilter)
  }

  // 5. AI enrichment + relevance filter
  articles = await aiEnrichAndFilter(articles, list)

  // 6. Sort
  articles = articles.sort((a, b) =>
    new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  )

  const countriesInResults = Array.from(new Set(articles.map(a => domainToCountry(a.sourceDomain)))).sort()

  return NextResponse.json({ articles, companies: list, countriesInResults })
}
