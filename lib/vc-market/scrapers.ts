import Anthropic from '@anthropic-ai/sdk'
import type { VCDealInsert } from './types'

// ─── LATAM country codes ──────────────────────────────────────────────────────

const LATAM_COUNTRIES = new Set([
  'AR','BO','BR','CL','CO','CR','CU','DO','EC','GT','HN','HT',
  'MX','NI','PA','PE','PY','SV','UY','VE','BZ','GY','SR','TT',
])

// ─── Source definitions ───────────────────────────────────────────────────────

type SourceType = 'rss' | 'html'

interface Source {
  name: string
  url: string
  type: SourceType
}

const SOURCES: Source[] = [
  // ── RSS LATAM-focused ───────────────────────────────────────────────────────
  {
    name: 'Google News – LatAm Funding',
    url: 'https://news.google.com/rss/search?q=startup+rodada+captacao+venture+capital+serie+latam&hl=pt-BR&gl=BR&ceid=BR:pt',
    type: 'rss',
  },
  {
    name: 'Google News – Brazil Startups',
    url: 'https://news.google.com/rss/search?q=startup+brazil+funding+raised+series+venture&hl=en&gl=BR&ceid=BR:en',
    type: 'rss',
  },
  {
    name: 'Google News – Mexico Startups',
    url: 'https://news.google.com/rss/search?q=startup+mexico+funding+raised+series+venture&hl=en&gl=MX&ceid=MX:en',
    type: 'rss',
  },
  {
    name: 'Google News – Colombia Startups',
    url: 'https://news.google.com/rss/search?q=startup+colombia+funding+raised+series+venture&hl=en&gl=CO&ceid=CO:en',
    type: 'rss',
  },
  {
    name: 'Google News – LATAM VC EN',
    url: 'https://news.google.com/rss/search?q=latin+america+startup+funding+venture+capital+series&hl=en-US&gl=US&ceid=US:en',
    type: 'rss',
  },
  // ── HTML LATAM sources ──────────────────────────────────────────────────────
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

function parseHTMLItems(html: string, baseUrl: string, sourceName: string): Article[] {
  const items: Article[] = []
  const seen = new Set<string>()

  const dateHints: string[] = []
  const timeMatches = html.matchAll(/<time[^>]*(?:datetime=["']([^"']+)["'])[^>]*>/g)
  for (const m of timeMatches) dateHints.push(m[1])

  const anchorRegex = /<a[^>]+href=["']([^"'#?][^"']*)["'][^>]*>([\s\S]*?)<\/a>/g
  let idx = 0
  for (const match of html.matchAll(anchorRegex)) {
    const rawHref = match[1]
    const rawText = match[2].replace(/<[^>]+>/g, '').trim()

    if (rawText.length < 20) continue
    if (/^(home|menu|login|sign|subscribe|newsletter|sobre|contato|privacy|terms)/i.test(rawText)) continue

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

const LATAM_COUNTRIES_LIST = [
  'Brazil (BR)', 'Mexico (MX)', 'Colombia (CO)', 'Argentina (AR)',
  'Chile (CL)', 'Peru (PE)', 'Uruguay (UY)', 'Costa Rica (CR)',
  'Panama (PA)', 'Ecuador (EC)', 'Bolivia (BO)', 'Paraguay (PY)',
  'Venezuela (VE)', 'Guatemala (GT)', 'Honduras (HN)', 'El Salvador (SV)',
  'Dominican Republic (DO)', 'Cuba (CU)', 'Nicaragua (NI)', 'Haiti (HT)',
  'Trinidad and Tobago (TT)', 'Guyana (GY)', 'Suriname (SR)', 'Belize (BZ)',
].join(', ')

function buildPrompt(articles: Article[]): string {
  const today     = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  const articlesText = articles
    .map((a, i) =>
      `[${i}] Source: ${a.source}\nTitle: ${a.title}\nDate: ${a.pubDate}\nURL: ${a.link}\nSummary: ${a.description}`
    )
    .join('\n\n')

  return `You are a precise financial data extraction engine specializing in Latin American venture capital.

Today's date: ${today}
Yesterday's date: ${yesterday}

Your task: analyze the news articles below and extract ONLY confirmed startup/company funding rounds from LATIN AMERICA.

━━━ GEOGRAPHIC FILTER — MANDATORY ━━━
ONLY include deals where the company is headquartered in a LATAM country:
${LATAM_COUNTRIES_LIST}

IMPORTANT: If the company is from USA, Europe, Asia, Africa, or any country outside LATAM, DO NOT include it — even if the article mentions Latin America investors or a LATAM expansion.
If the company's country cannot be determined and there is no clear indication it is LATAM-based, skip the article entirely.

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
- Any deal outside Latin America

━━━ DUPLICATE DETECTION ━━━
A deal is a duplicate if company_name + stage + deal_date (±30 days) all match.
Keep only the highest-confidence entry. Never include the same round twice.

━━━ OUTPUT FORMAT ━━━
Return a raw JSON array. No markdown fences. No explanations.
If zero valid LATAM deals are found, return: []

Each object:
{
  "company_name": string,
  "amount_usd": number | null,
  "deal_date": "YYYY-MM-DD" | null,
  "stage": "Pre-Seed" | "Seed" | "Series A" | "Series B" | "Series C" |
           "Series D" | "Series E" | "Growth" | "Bridge" |
           "IPO" | "SPAC" | "Acquisition" | null,
  "investors": string[],
  "segment": string | null,
  "country": "XX" | null,   // ISO 3166-1 alpha-2 — MUST be a LATAM country code
  "source_url": string,
  "confidence": "high" | "medium" | "low"
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
  const results = await Promise.allSettled(SOURCES.map(s => fetchSource(s)))
  const allArticles: Article[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') allArticles.push(...r.value)
  }

  if (allArticles.length === 0) return []

  // Deduplicate by title
  const seen = new Set<string>()
  const unique = allArticles.filter(a => {
    const key = a.title.toLowerCase().trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const extracted = await extractDealsWithAI(unique, apiKey)

  return extracted
    .filter(d =>
      d.company_name?.trim() &&
      d.confidence !== 'low' &&
      // Hard filter: drop anything not in a known LATAM country
      (d.country === null || LATAM_COUNTRIES.has(d.country.toUpperCase()))
    )
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
