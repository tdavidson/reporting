import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const cache = new Map<string, { data: NewsArticle[]; expiresAt: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000

export interface NewsArticle {
  title: string
  link: string
  pubDate: string
  source: string
  companyId: string
  companyName: string
}

async function fetchCompanyNews(companyId: string, companyName: string): Promise<NewsArticle[]> {
  const cacheKey = `news:${companyId}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  try {
    const query = encodeURIComponent(`"${companyName}"`)
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsReader/1.0)' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []

    const xml = await res.text()
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g))

    const articles: NewsArticle[] = items.slice(0, 5).map(match => {
      const block = match[1]
      const title = block.match(/<title>(.*?)<\/title>/)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? ''
      const link = block.match(/<link\s*\/?>(.*?)(?:<\/link>|$)/)?.[1]?.trim()
        ?? block.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? ''
      const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? ''
      const source = block.match(/<source[^>]*>(.*?)<\/source>/)?.[1]?.trim() ?? 'Google News'
      return { title, link, pubDate, source, companyId, companyName }
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

  const { data: companies } = await supabase
    .from('companies')
    .select('id, name')
    .eq('fund_id', membership.fund_id)
    .eq('status', 'active')
    .order('name') as { data: { id: string; name: string }[] | null }

  const list = (companies ?? []).filter(c =>
    !companiesParam || companiesParam.split(',').includes(c.id)
  )

  const results = await Promise.all(list.map(c => fetchCompanyNews(c.id, c.name)))
  const articles = results.flat().sort((a, b) =>
    new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  )

  return NextResponse.json({ articles, companies: list })
}
