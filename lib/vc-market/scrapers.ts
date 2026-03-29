import Anthropic from '@anthropic-ai/sdk'
import type { VCDealInsert } from './types'
 
// Pre-determined RSS sources for VC/startup funding news
const RSS_SOURCES = [
  {
    name: 'Google News – VC Global',
    url: 'https://news.google.com/rss/search?q=startup+funding+round+raised+million+venture+capital&hl=en-US&gl=US&ceid=US:en',
  },
  {
    name: 'Google News – LatAm / Brazil',
    url: 'https://news.google.com/rss/search?q=startup+rodada+captacao+venture+capital+serie&hl=pt-BR&gl=BR&ceid=BR:pt',
  },
  {
    name: 'Google News – Fintech Funding',
    url: 'https://news.google.com/rss/search?q=fintech+startup+series+funding+raised&hl=en-US&gl=US&ceid=US:en',
  },
  {
    name: 'TechCrunch Funding',
    url: 'https://techcrunch.com/tag/funding/feed/',
  },
]
 
interface RSSItem {
  title: string
  link: string
  pubDate: string
  description: string
}
 
function parseRSSItems(xml: string): RSSItem[] {
  const items: RSSItem[] = []
  const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g)
  for (const match of matches) {
    const block = match[1]
    const title = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? ''
    const link =
      block.match(/<link\s*\/?>(.*?)(?:<\/link>|$)/)?.[1]?.trim() ??
      block.match(/<link>(.*?)<\/link>/s)?.[1]?.trim() ??
      ''
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? ''
    const description =
      block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/s)?.[1]
        ?.replace(/<[^>]+>/g, '')
        .trim()
        .slice(0, 300) ?? ''
    if (title && link) items.push({ title, link, pubDate, description })
  }
  return items.slice(0, 20)
}
 
async function fetchRSSFeed(url: string): Promise<RSSItem[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VCMarket/1.0)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const xml = await res.text()
    return parseRSSItems(xml)
  } catch {
    return []
  }
}
 
interface ExtractedDeal {
  company_name: string
  amount_usd: number | null
  deal_date: string | null
  stage: string | null
  investors: string[]
  segment: string | null
  country: string | null
  source_url: string
}
 
async function extractDealsWithAI(items: RSSItem[], apiKey?: string): Promise<ExtractedDeal[]> {
  const client = new Anthropic({ apiKey })
 
  const articlesText = items
    .map(
      (item, i) =>
        `[${i}] Title: ${item.title}\nDate: ${item.pubDate}\nURL: ${item.link}\nSummary: ${item.description}`
    )
    .join('\n\n')
 
  const prompt = `From the news articles below, extract only those that describe a startup or company funding round (VC investment, Seed, Series A/B/C/D+, growth equity, angel round, etc.).
 
For each valid deal return a JSON object with:
- company_name: startup/company name (string)
- amount_usd: amount raised in USD as integer (convert from BRL/EUR if mentioned, null if unknown)
- deal_date: "YYYY-MM-DD" (use article publication date if deal date not stated, null if totally unknown)
- stage: "Pre-Seed" | "Seed" | "Series A" | "Series B" | "Series C" | "Series D" | "Series E" | "Growth" | "Bridge" (null if unknown)
- investors: array of investor/VC fund names mentioned (empty array if none)
- segment: vertical/industry e.g. "Fintech", "Healthtech", "SaaS", "E-commerce", "Proptech", "Edtech", "Deeptech", "Logistics", "Agritech" (null if unclear)
- country: 2-letter ISO country code where startup is based (null if unknown)
- source_url: exact article URL
 
Respond with a valid JSON array only — no markdown fences, no explanations. Skip any article that is NOT about a funding round.
 
Articles:
${articlesText}`
 
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })
 
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []
 
    const parsed = JSON.parse(jsonMatch[0]) as ExtractedDeal[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
 
/**
 * Scrapes pre-determined RSS sources and extracts VC deal data using AI.
 * Called by the /api/vc-market/scrape endpoint (triggered daily at 10am BRT).
 */
export async function scrapeVCDeals(fundId: string, apiKey?: string): Promise<VCDealInsert[]> {
  // Fetch all sources in parallel
  const results = await Promise.allSettled(RSS_SOURCES.map(s => fetchRSSFeed(s.url)))
  const allItems: RSSItem[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') allItems.push(...r.value)
  }
 
  if (allItems.length === 0) return []
 
  // Deduplicate by normalised title
  const seen = new Set<string>()
  const unique = allItems.filter(item => {
    const key = item.title.toLowerCase().trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
 
  const extracted = await extractDealsWithAI(unique, apiKey)
 
  return extracted
    .filter(d => d.company_name?.trim())
    .map(d => ({
      fund_id: fundId,
      company_name: d.company_name.trim(),
      amount_usd: d.amount_usd ?? null,
      deal_date: d.deal_date ?? null,
      stage: d.stage ?? null,
      investors: d.investors ?? [],
      segment: d.segment ?? null,
      country: d.country ?? null,
      source_url: d.source_url ?? null,
      source: 'scrape' as const,
    }))
}
