import Anthropic from '@anthropic-ai/sdk'
import type { VCDealInsert } from './types'

// ─── Source definitions ───────────────────────────────────────────────────────

type SourceType = 'rss' | 'html'

interface Source {
  name: string
  url: string
  type: SourceType
}

const SOURCES: Source[] = [
  // ── RSS (confirmed active) ──────────────────────────────────────────────────
  {
    name: 'Google News – VC Global',
    url: 'https://news.google.com/rss/search?q=startup+funding+round+raised+million+venture+capital&hl=en-US&gl=US&ceid=US:en',
    type: 'rss',
  },
  {
    name: 'Google News – LatAm / Brazil',
    url: 'https://news.google.com/rss/search?q=startup+rodada+captacao+venture+capital+serie&hl=pt-BR&gl=BR&ceid=BR:pt',
    type: 'rss',
  },
  {
    name: 'Google News – Fintech Funding',
    url: 'https://news.google.com/rss/search?q=fintech+startup+series+funding+raised&hl=en-US&gl=US&ceid=US:en',
    type: 'rss',
  },
  {
    name: 'TechCrunch Funding',
    url: 'https://techcrunch.com/tag/funding/feed/',
    type: 'rss',
  },
  {
    name: 'Crunchbase News',
    url: 'https://news.crunchbase.com/feed/',
    type: 'rss',
  },
  // ── HTML scrape ─────────────────────────────────────────────────────────────
  {
    name: 'Pipeline Valor',
    url: 'https://pipelinevalor.globo.com/negocios/',
    type: 'html',
  },
  {
    name: 'Brazil Journal – PE/VC',
    url: 'https://braziljournal.com/hot-topic/private-equity-vc/',
    type: 'html',
  },
  {
    name: 'NeoFeed Startups',
    url: 'https://neofeed.com.br/startups/',
    type: 'html',
  },
  {
    name: 'Finsiders Brasil',
    url: 'https://finsidersbrasil.com.br/ultimas-noticias/',
    type: 'html',
  },
  {
    name: 'LATAM List – Funding',
    url: 'https://latamlist.com/category/startup-news/funding/',
    type: 'html',
  },
  {
    name: 'Startups.com.br',
    url: 'https://startups.com.br/ultimas-noticias/',
    type: 'html',
  },
  {
    name: 'Startupi',
    url: 'https://startupi.com.br/noticias/',
    type: 'html',
  },
  {
    name: 'LATAM Fintech',
    url: 'https://www.latamfintech.co/articles',
    type: 'html',
  },
]

// ─── Shared article interface ─────────────────────────────────────────────────

interface Article {
  title: string
  link: string
  pubDate: string
  description: string
  source: string
}

// ─── RSS parser ───────────────────────────────────────────────────────────────

function parseRSSItems(xml: string, sourceName: string): Article[] {
  const items: Article[] = []
  const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g)
  for (const match of matches) {
    const block = match[1]
    const title =
      block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s)?.[1]
        ?.replace(/<[^>]+>/g, '').trim() ?? ''
    const link =
      block.match(/<link\s*\/?>(.*?)(?:<\/link>|$)/)?.[1]?.trim() ??
      block.match(/<link>(.*?)<\/link>/s)?.[1]?.trim() ?? ''
    const pubDate =
      block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? ''
    const description =
      block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/s)?.[1]
        ?.replace(/<[^>]+>/g, '').trim().slice(0, 300) ?? ''
    if (title && link) items.push({ title, link, pubDate, description, source: sourceName })
  }
  return items.slice(0, 20)
}

// ─── HTML parser ─────────────────────────────────────────────────────────────
// Extracts article candidates from raw HTML by scanning anchor tags
// that look like article headlines (href + meaningful text).

function parseHTMLItems(html: string, baseUrl: string, sourceName: string): Article[] {
  const items: Article[] = []
  const seen = new Set<string>()

  // Extract <time> or datetime attributes for pub date hints
  const dateHints: string[] = []
  const timeMatches = html.matchAll(/<time[^>]*(?:datetime=["']([^"']+)["'])[^>]*>/g)
  for (const m of timeMatches) dateHints.push(m[1])

  // Extract anchor tags with meaningful text
  const anchorRegex = /<a[^>]+href=["']([^"'#?][^"']*)["'][^>]*>([\s\S]*?)<\/a>/g
  let idx = 0
  for (const match of html.matchAll(anchorRegex)) {
    const rawHref = match[1]
    const rawText = match[2].replace(/<[^>]+>/g, '').trim()

    // Skip nav/footer/social links — must have 20+ chars and look like a headline
    if (rawText.length < 20) continue
    if (/^(home|menu|login|sign|subscribe|newsletter|sobre|contato|privacy|terms)/i.test(rawText)) continue

    // Resolve relative URLs
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

    const pubDate = dateHints[idx] ?? ''
    items.push({ title: rawText, link: href, pubDate, description: '', source: sourceName })
    idx++
    if (items.length >= 20) break
  }

  return items
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchSource(source: Source): Promise<Article[]> {
  try {
    const res = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VCMarket/1.0)',
        'Accept': source.type === 'rss'
          ? 'application/rss+xml, application/xml, text/xml'
          : 'text/html',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return []
    const text = await res.text()
    return source.type === 'rss'
      ? parseRSSItems(text, source.name)
      : parseHTMLItems(text, source.url, source.name)
  } catch {
    return []
  }
}

// ─── AI extraction ────────────────────────────────────────────────────────────

interface ExtractedDeal {
  company_name: string
  amount_usd: number | null
  deal_date: string | null
  stage: string | null
  investors: string[]
  segment: string | null
  country: string | null
  source_url: string
  confidence: 'high' | 'medium' | 'low'
}

function buildPrompt(articles: Article[]): string {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  const articlesText = articles
    .map((a, i) =>
      `[${i}] Source: ${a.source}\nTitle: ${a.title}\nDate: ${a.pubDate}\nURL: ${a.link}\nSummary: ${a.description}`
    )
    .join('\n\n')

  return `You are a precise financial data extraction engine specializing in venture capital.

Today's date: ${today}
Yesterday's date: ${yesterday}

Your task: analyze the news articles below and extract ONLY confirmed startup/company funding rounds, IPOs, SPACs, and M&A events. Be conservative — when in doubt, skip the article.

━━━ DATE FILTER — STRICT ━━━
Only process articles published on ${yesterday} or ${today}.
Ignore any article with a publication date older than ${yesterday}.
If the publication date is missing or ambiguous, skip the article entirely.

━━━ WHAT QUALIFIES AS A VALID DEAL ━━━
Include:
- Equity funding rounds: Pre-Seed, Seed, Series A/B/C/D/E+
- Growth equity and late-stage VC rounds
- Bridge rounds backed by institutional investors
- Angel rounds with named investors
- IPOs and SPACs (include amount raised and exchange if mentioned)
- M&A, acquisitions and mergers (acquirer goes into investors[], stage = "Acquisition")

Exclude strictly:
- Debt rounds, loans, credit facilities, revenue-based financing
- Government grants, subsidies, public funding
- Crowdfunding (Kickstarter, Indiegogo, etc.)
- Real estate or infrastructure deals
- Articles that only MENTION a company without confirming a closed event

━━━ DUPLICATE DETECTION — APPLY BEFORE INCLUDING ANY DEAL ━━━
A deal is a duplicate if ALL THREE conditions match another deal in your output:
  1. company_name is the same or highly similar (e.g. "Nubank" = "Nu Holdings")
  2. stage is the same
  3. deal_date is within ±30 days of another deal for the same company

If a duplicate is detected:
- Keep only the entry with the highest confidence
- If confidence is equal, keep the one with more fields populated
- Never include the same funding round twice, even if reported by multiple sources

━━━ OUTPUT FORMAT ━━━
Return a raw JSON array. No markdown fences. No explanations. No extra text.
If zero valid deals are found, return an empty array: []

Each object must follow this exact schema:
{
  "company_name": string,           // official company name, not product name
  "amount_usd": number | null,      // total raised in USD as integer (e.g. 5000000)
                                    // convert: BRL ÷ 5.8 | EUR × 1.08 | GBP × 1.27
                                    // null if amount is not stated anywhere
  "deal_date": "YYYY-MM-DD" | null, // date the round was announced or closed
                                    // fallback: article publication date
                                    // must be between 2020-01-01 and ${today}
                                    // null only if completely impossible to determine
  "stage": "Pre-Seed" | "Seed" | "Series A" | "Series B" | "Series C" |
           "Series D" | "Series E" | "Growth" | "Bridge" |
           "IPO" | "SPAC" | "Acquisition" | null,
  "investors": string[],            // VC fund/angel/acquirer names only
                                    // empty array [] if none mentioned
  "segment": string | null,         // pick exactly one from the list below
  "country": "XX" | null,           // ISO 3166-1 alpha-2, company HQ country
  "source_url": string,             // exact article URL, no shorteners
  "confidence": "high" | "medium" | "low"
                                    // high = amount + stage + date all confirmed
                                    // medium = 1-2 fields missing or inferred
                                    // low = mostly inferred, consider skipping
}

━━━ SEGMENT — pick exactly one ━━━
"AI/ML" | "Fintech" | "Healthtech" | "SaaS" | "E-commerce" | "Proptech" |
"Edtech" | "Deeptech" | "Cybersecurity" | "Logistics" | "Agritech" |
"Cleantech" | "Biotech" | "Gaming" | "Web3/Crypto" | "HR Tech" |
"Legal Tech" | "Retail Tech" | "Marketplace" | "Other"

━━━ ARTICLES ━━━
${articlesText}`
}

async function extractDealsWithAI(articles: Article[], apiKey?: string): Promise<ExtractedDeal[]> {
  const client = new Anthropic({ apiKey })

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: buildPrompt(articles) }],
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

// ─── Main export ──────────────────────────────────────────────────────────────

export async function scrapeVCDeals(userId: string, apiKey?: string): Promise<VCDealInsert[]> {
  // Fetch all sources in parallel
  const results = await Promise.allSettled(SOURCES.map(s => fetchSource(s)))
  const allArticles: Article[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') allArticles.push(...r.value)
  }

  if (allArticles.length === 0) return []

  // Deduplicate by title before sending to AI
  const seen = new Set<string>()
  const unique = allArticles.filter(a => {
    const key = a.title.toLowerCase().trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const extracted = await extractDealsWithAI(unique, apiKey)

  // Filter low-confidence deals and map to insert shape
  return extracted
    .filter(d => d.company_name?.trim() && d.confidence !== 'low')
    .map(d => ({
      user_id:      userId,
      company_name: d.company_name.trim(),
      amount_usd:   d.amount_usd ?? null,
      deal_date:    d.deal_date ?? null,
      stage:        d.stage ?? null,
      investors:    d.investors ?? [],
      segment:      d.segment ?? null,
      country:      d.country ?? null,
      source_url:   d.source_url ?? null,
      source:       'scrape' as const,
    }))
}
