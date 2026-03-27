import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

const cache = new Map<string, { data: RawArticle[]; expiresAt: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000
const AI_CACHE = new Map<string, { articles: NewsArticle[]; expiresAt: number }>()

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
}

type RawArticle = Omit<NewsArticle, 'category'>

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

/**
 * Strip the " - Source Name" suffix that Google News appends to article titles.
 * e.g. "NovaTech levanta R$50M - Pipeline Valor" → "NovaTech levanta R$50M"
 */
function cleanTitle(title: string): string {
  // Google News format: "Title - Source Name" — remove last " - ..." segment
  return title.replace(/\s+[-–—]\s+[^-–—]+$/, '').trim()
}

function parseRSSItems(xml: string, companyId: string, companyName: string): RawArticle[] {
  const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g))
  return items.slice(0, 15).map(match => {
    const block = match[1]
    const rawTitle = block.match(/<title>(.*?)<\/title>/)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? ''
    const title = cleanTitle(rawTitle)
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

    const res1 = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(q1)}&hl=pt-BR&gl=BR&ceid=BR:pt`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsReader/1.0)' },
        signal: AbortSignal.timeout(6000),
      }
    )

    const articles: RawArticle[] = []
    const seen = new Set<string>()

    if (res1.ok) {
      const xml = await res1.text()
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
  category: NewsCategory | null
}

type ReviewResult = {
  index: number
  keep: boolean
  reason?: string
}

/**
 * Deterministic pre-filter before calling the AI.
 * Keeps only articles where the company name (or a meaningful token) appears in the title,
 * or the source domain matches the company website.
 */
function deterministicPreFilter(
  articles: RawArticle[],
  companies: { id: string; name: string; website: string | null }[]
): RawArticle[] {
  const companyMap = new Map(companies.map(c => ({
    id: c.id,
    name: c.name,
    domain: extractDomain(c.website),
    tokens: c.name.toLowerCase().split(/\s+/).filter(t => t.length >= 4),
  })).map(c => [c.id, c]))

  return articles.filter(article => {
    const titleLower = article.title.toLowerCase()
    const co = companyMap.get(article.companyId)
    if (!co) return false
    if (co.domain && article.sourceDomain.includes(co.domain)) return true
    if (titleLower.includes(co.name.toLowerCase())) return true
    if (co.tokens.some(token => titleLower.includes(token))) return true
    return false
  })
}

// Pass 1 — classify articles: assign companyId + category
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

  const prompt = `You are a strict financial news classifier for a VC fund portfolio.

Portfolio companies (id | name | website domain):
${companyList}

News articles to classify (index · title · source · date):
${articleList}

For each article, determine:
- companyId: UUID of the matching portfolio company, or null.
- category: one of the values below, or null if companyId is null.

Category values (pick the most specific one based on the article title):
  "rodada"      — funding round, investment, capital raise, Series A/B/C, seed, bridge
  "aquisicao"   — M&A, acquisition, merger, takeover, buyout
  "parceria"    — partnership, integration, collaboration, joint venture, agreement
  "contratacao" — executive hire, new CXO/VP, layoffs, headcount change, team expansion
  "produto"     — product launch, new feature, platform update, beta release
  "expansao"    — geographic expansion, new market, international growth, new office
  "premio"      — award, ranking, recognition, certification
  "crise"       — scandal, lawsuit, regulatory issue, fraud, controversy, bankruptcy
  "ipo"         — IPO, public offering, listing, going public
  "outro"       — clearly relevant to the company but doesn't fit above categories

Classification rules (apply in order):
1. If the source domain matches a company's website domain → assign that company.
2. If the company name (or a clear abbreviation/acronym) appears in the title → assign and classify.
3. If neither condition is met → companyId: null, category: null. Do NOT guess.
4. Do NOT assign based on industry similarity alone.

Be conservative. When in doubt → null.

Respond ONLY with a JSON array, no explanation:
[{"index":0,"companyId":"uuid","category":"rodada"},{"index":1,"companyId":null,"category":null}]`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '[]'
  console.log('[classify] raw AI response:', raw.slice(0, 1000))
  const match = raw.match(/\[[\s\S]*\]/)
  try { return match ? JSON.parse(match[0]) : [] } catch { return [] }
}

// Pass 2 — review: remove false positives with a strict lens
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
    return `[${i}] company: "${co?.name}"${co?.domain ? ` (${co.domain})` : ''} | title: "${a.title}" | source: ${a.sourceDomain} | category: ${a.category}`
  }).join('\n')

  const prompt = `You are a quality reviewer for a VC fund news feed. Each article has been assigned to a portfolio company.

Remove false positives — articles that are NOT genuinely about the assigned company.

Articles:
${articleList}

Rules:
- keep: true if the company name (or clear variant) appears in the title, OR the source domain is the company's own website.
- keep: false if the title does not mention the company, or the article is clearly about a different entity.
- When in doubt → keep: false. Fewer, better results is the goal.

Respond ONLY with a JSON array:
[{"index":0,"keep":true},{"index":1,"keep":false,"reason":"Title does not mention the company"}]`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '[]'
  const match = raw.match(/\[.*\]/s)
  let results: ReviewResult[] = []
  try { results = match ? JSON.parse(match[0]) : [] } catch { }

  return candidates.filter((_, i) => {
    const r = results.find(x => x.index === i)
    return !r || r.keep !== false
  })
}

async function aiEnrichAndFilter(
  articles: RawArticle[],
  companies: { id: string; name: string; website: string | null }[],
  fundId: string,
  supabase: ReturnType<typeof createClient>
): Promise<NewsArticle[]> {
  if (articles.length === 0) return []

  const preFiltered = deterministicPreFilter(articles, companies)
  if (preFiltered.length === 0) return []

  // Check which articles are already saved in DB
  const links = preFiltered.map(a => a.link)
  const { data: existing } = await supabase
    .from('news_articles')
    .select('link, title, pub_date, source, source_domain, company_id, company_name, category')
    .eq('fund_id', fundId)
    .in('link', links)

  const existingByLink = new Map((existing ?? []).map((a: any) => [a.link, a]))

  const cached: NewsArticle[] = []
  const toClassify: RawArticle[] = []

  for (const article of preFiltered) {
    const saved = existingByLink.get(article.link)
    if (saved) {
      cached.push({
        ...article,
        category: saved.category as NewsCategory,
        companyId: saved.company_id ?? article.companyId,
        companyName: saved.company_name ?? article.companyName,
      })
    } else {
      toClassify.push(article)
    }
  }

  let newlyClassified: NewsArticle[] = []
  if (toClassify.length > 0) {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const companyMap = new Map(companies.map(c => [c.id, c.name]))

      const classified = await classifyArticles(anthropic, toClassify, companies)
      const pass1: NewsArticle[] = toClassify
        .map((article, i) => {
          const r = classified.find(x => x.index === i)
          if (!r || r.companyId === null || r.category === null) return null
          const name = companyMap.get(r.companyId)
          if (!name) return null
          return { ...article, companyId: r.companyId, companyName: name, category: r.category }
        })
        .filter((a): a is NewsArticle => a !== null)

      newlyClassified = await reviewArticles(anthropic, pass1, companies)

      if (newlyClassified.length > 0) {
        await supabase.from('news_articles').upsert(
          newlyClassified.map(a => ({
            fund_id: fundId,
            company_id: a.companyId,
            company_name: a.companyName,
            title: a.title,
            link: a.link,
            pub_date: a.pubDate ? new Date(a.pubDate).toISOString() : new Date().toISOString(),
            source: a.source,
            source_domain: a.sourceDomain,
            category: a.category,
          })),
          { onConflict: 'fund_id,link', ignoreDuplicates: true }
        )
      }
    } catch (e) {
      console.error('[news] AI pipeline failed:', e)
      newlyClassified = toClassify
        .filter(a => {
          const co = companies.find(c => c.id === a.companyId)
          return co && a.title.toLowerCase().includes(co.name.toLowerCase())
        })
        .map(a => ({ ...a, category: 'outro' as NewsCategory }))
    }
  }

  return [...cached, ...newlyClassified]
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
  const countryFilter = req.nextUrl.searchParams.get('country')
  const bust = req.nextUrl.searchParams.get('bust')
  const fromDate = req.nextUrl.searchParams.get('fromDate') // new param

  if (bust) { cache.clear() }

  const sources = sourcesParam
    ? sourcesParam.split(',').map(s => s.trim()).filter(Boolean) : []

  const { data: companies } = await supabase
    .from('companies')
    .select('id, name, website')
    .eq('fund_id', membership.fund_id)
    .eq('status', 'active')
    .order('name') as { data: { id: string; name: string; website: string | null }[] | null }

  const list = (companies ?? []).filter(c =>
    !companiesParam || companiesParam.split(',').includes(c.id)
  )

  // Fetch fresh RSS articles
  const results = await Promise.all(
    list.map(c => fetchCompanyNews(c.id, c.name, sources, extractDomain(c.website)))
  )
  let articles = results.flat()

  // Deduplicate
  const seen = new Set<string>()
  articles = articles.filter(a => {
    const key = normalizeUrl(a.link)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (countryFilter && countryFilter !== 'all') {
    articles = articles.filter(a => domainToCountry(a.sourceDomain) === countryFilter)
  }

  // Classify only new articles, return cached for existing
  const enriched = await aiEnrichAndFilter(articles, list, membership.fund_id, supabase)

  // Apply fromDate filter (hides articles, doesn't delete)
  let filtered = enriched
  if (fromDate) {
    const cutoff = new Date(fromDate).getTime()
    filtered = enriched.filter(a => new Date(a.pubDate).getTime() >= cutoff)
  }

  const CATEGORY_ORDER: Record<NewsCategory, number> = {
    rodada: 0, ipo: 1, aquisicao: 2, parceria: 3, contratacao: 4,
    produto: 5, expansao: 6, premio: 7, crise: 8, outro: 9,
  }

  const sorted = filtered.sort((a, b) => {
    const cDiff = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]
    if (cDiff !== 0) return cDiff
    return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  })

  const countriesInResults = Array.from(
    new Set(sorted.map(a => domainToCountry(a.sourceDomain)))
  ).sort()

  return NextResponse.json({ articles: sorted, companies: list, countriesInResults })
}
