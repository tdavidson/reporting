import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const cache = new Map<string, { data: NewsArticle[]; expiresAt: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000

export interface NewsArticle {
  title: string
  link: string
  pubDate: string
  source: string
  sourceDomain: string
  companyId: string
  companyName: string
}

function extractDomain(source: string): string {
  try {
    // source from Google News RSS is usually just the outlet name, not a URL
    // we'll use the source text as-is for domain detection
    return source.toLowerCase()
  } catch {
    return source.toLowerCase()
  }
}

function getTLD(domain: string): string {
  const parts = domain.split('.')
  return parts[parts.length - 1] ?? ''
}

const TLD_TO_COUNTRY: Record<string, string> = {
  'com': 'US',
  'us': 'US',
  'co.uk': 'UK',
  'uk': 'UK',
  'com.br': 'BR',
  'br': 'BR',
  'de': 'DE',
  'fr': 'FR',
  'es': 'ES',
  'it': 'IT',
  'ca': 'CA',
  'au': 'AU',
  'co.au': 'AU',
  'in': 'IN',
  'co.in': 'IN',
  'jp': 'JP',
  'cn': 'CN',
  'sg': 'SG',
  'io': 'TECH',
  'ai': 'TECH',
}

export function domainToCountry(domain: string): string {
  const d = domain.toLowerCase()
  for (const [suffix, country] of Object.entries(TLD_TO_COUNTRY)) {
    if (d.endsWith('.' + suffix) || d === suffix) return country
  }
  return 'US' // default
}

async function fetchCompanyNews(
  companyId: string,
  companyName: string,
  sources: string[]
): Promise<NewsArticle[]> {
  const cacheKey = `news:${companyId}:${sources.sort().join(',')}`
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
  const sourcesParam = req.nextUrl.searchParams.get('sources') // comma-separated domains
  const dateRange = req.nextUrl.searchParams.get('dateRange') // '24h' | '7d' | '30d' | 'all'
  const countryFilter = req.nextUrl.searchParams.get('country') // 'US' | 'BR' | etc

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

  const results = await Promise.all(list.map(c => fetchCompanyNews(c.id, c.name, sources)))
  let articles = results.flat()

  // Date filter
  if (dateRange && dateRange !== 'all') {
    const msMap: Record<string, number> = { '24h': 86400000, '7d': 7 * 86400000, '30d': 30 * 86400000 }
    const cutoff = Date.now() - (msMap[dateRange] ?? 0)
    articles = articles.filter(a => new Date(a.pubDate).getTime() >= cutoff)
  }

  // Country filter
  if (countryFilter && countryFilter !== 'all') {
    articles = articles.filter(a => domainToCountry(a.sourceDomain) === countryFilter)
  }

  articles = articles.sort((a, b) =>
    new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  )

  // Collect available countries from current result set
  const countriesInResults = [...new Set(articles.map(a => domainToCountry(a.sourceDomain)))].sort()

  return NextResponse.json({ articles, companies: list, countriesInResults })
}
