/**
 * GET /api/news
 *
 * Reads articles from the database only — no live RSS.
 * Supports: dateRange (3d|7d|30d|ytd|lastyear|all), companyIds (comma list)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { NewsCategory, NewsArticle } from '@/lib/news-pipeline'

re-export types for page.tsx backwards-compat
export type { NewsCategory, NewsArticle } from '@/lib/news-pipeline'

const CATEGORY_ORDER: Record<NewsCategory, number> = {
  rodada: 0, ipo: 1, aquisicao: 2, parceria: 3, contratacao: 4,
  produto: 5, expansao: 6, premio: 7, crise: 8, outro: 9,
}

function getDateCutoff(dateRange: string): number | null {
  if (dateRange === '3d')       return Date.now() - 3  * 86_400_000
  if (dateRange === '7d')       return Date.now() - 7  * 86_400_000
  if (dateRange === '30d')      return Date.now() - 30 * 86_400_000
  if (dateRange === 'ytd')      return new Date(new Date().getFullYear(), 0, 1).getTime()
  if (dateRange === 'lastyear') return new Date(new Date().getFullYear() - 1, 0, 1).getTime()
  return null
}

function getDateCeiling(dateRange: string): number | null {
  if (dateRange === 'lastyear') {
    const y = new Date().getFullYear() - 1
    return new Date(y, 11, 31, 23, 59, 59, 999).getTime()
  }
  return null
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

  const { fund_id } = membership
  const params       = req.nextUrl.searchParams
  const dateRange    = params.get('dateRange') ?? 'all'
  const companyIds   = params.get('companyIds')?.split(',').filter(Boolean) ?? []

  // Load companies for filter dropdown
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name, website')
    .eq('fund_id', fund_id)
    .eq('status', 'active')
    .order('name')

  // Query articles from DB
  let query = supabase
    .from('news_articles')
    .select('id, title, link, pub_date, source, source_domain, company_id, company_name, category, is_duplicate, scraped_at')
    .eq('fund_id', fund_id)
    .eq('is_duplicate', false)
    .order('pub_date', { ascending: false })
    .limit(200)

  if (companyIds.length > 0) {
    query = query.in('company_id', companyIds)
  }

  const { data: rows, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const cutoff  = getDateCutoff(dateRange)
  const ceiling = getDateCeiling(dateRange)

  let articles: NewsArticle[] = (rows ?? []).map((r: any) => ({
    title:        r.title,
    link:         r.link,
    pubDate:      r.pub_date,
    source:       r.source,
    sourceDomain: r.source_domain,
    companyId:    r.company_id,
    companyName:  r.company_name,
    category:     r.category as NewsCategory,
    isDuplicate:  r.is_duplicate,
  }))

  if (cutoff)  articles = articles.filter(a => new Date(a.pubDate).getTime() >= cutoff)
  if (ceiling) articles = articles.filter(a => new Date(a.pubDate).getTime() <= ceiling)

  const sorted = articles.sort((a, b) => {
    const pd = new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
    if (pd !== 0) return pd
    return (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9)
  })

  return NextResponse.json({
    articles: sorted,
    companies: (companies ?? []).map((c: any) => ({ id: c.id, name: c.name })),
  })
}
