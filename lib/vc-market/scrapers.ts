import Anthropic from '@anthropic-ai/sdk'
import type { VCDeal, VCDealInsert } from './types'

// ─── LATAM country codes ────────────────────────────────────────────────────────

const LATAM_COUNTRIES = new Set([
  'Argentina','Bolivia','Brazil','Colombia','Ecuador',
  'Mexico','Peru','Paraguay','Uruguay','Venezuela',
])

// ─── Source definitions ────────────────────────────────────────────────────────────

type SourceType = 'rss' | 'html'

interface Source {
  name: string
  url: string
  type: SourceType
}

const SOURCES: Source[] = [
  { name: 'Pipeline Valor',         url: 'https://pipelinevalor.globo.com/negocios/', type: 'html' },
  { name: 'Brazil Journal – PE/VC', url: 'https://braziljournal.com/hot-topic/private-equity-vc/', type: 'html' },
  { name: 'NeoFeed Startups',       url: 'https://neofeed.com.br/startups/', type: 'html' },
  { name: 'Finsiders Brasil',       url: 'https://finsidersbrasil.com.br/ultimas-noticias/', type: 'html' },
  { name: 'LATAM List – Funding',   url: 'https://latamlist.com/category/startup-news/funding/', type: 'html' },
  { name: 'Startups.com.br',        url: 'https://startups.com.br/ultimas-noticias/', type: 'html' },
  { name: 'Startupi',               url: 'https://startupi.com.br/noticias/', type: 'html' },
  { name: 'Latam Fintech',          url: 'https://www.latamfintech.co/articles', type: 'html' },
  { name: 'Startups Latam',         url: 'https://startupslatam.com/', type: 'html' },
  { name: 'TechCrunch',             url: 'https://techcrunch.com/latest/', type: 'html' },
]

// ─── Report types ─────────────────────────────────────────────────────────────────

export interface SourceResult {
  name: string
  status: 'ok' | 'error' | 'empty'
  articlesFound: number
  error?: string
}

export interface DealReviewRow {
  company: string
  stage: string | null
  country: string | null
  confidence: 'high' | 'medium' | 'low'
  outcome: 'approved' | 'rejected_review' | 'rejected_filter'
  reason?: string
}

export interface ScrapeReport {
  sources: SourceResult[]
  totalArticles: number
  uniqueArticles: number
  articlesAfterKeywordFilter: number
  articlesAfterDateFilter: number
  dealsExtracted: number
  dealsAfterReview: number
  dealsAfterFilter: number
  reviewRejections: { company: string; reason: string }[]
  hardFilterRejections: { company: string; reason: string }[]
  dealRows: DealReviewRow[]
  aiError?: string
  reviewError?: string
}

// ─── Shared article interface ────────────────────────────────────────────────────────────────

interface Article {
  title: string
  link: string
  pubDate: string
  description: string
  source: string
}

// ─── Date helpers ───────────────────────────────────────────────────────────────────

function parseArticleDate(raw: string): Date | null {
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

function isRecentArticle(article: Article, cutoffMs: number): boolean {
  const d = parseArticleDate(article.pubDate)
  if (!d) return true  // no date → let reviewer decide
  return d.getTime() >= cutoffMs
}

// ─── Keyword pre-filter ───────────────────────────────────────────────────────────────────

const FUNDING_KEYWORDS = [
  'rodada', 'captação', 'captacao', 'investimento', 'aporte', 'levantou', 'levanta',
  'série a', 'serie a', 'série b', 'serie b', 'série c', 'serie c',
  'seed', 'pré-seed', 'pre-seed', 'anjo', 'ipo',
  'aquisição', 'aquisicao', 'adquiriu', 'adquirido', 'comprou', 'compra',
  'fusão', 'fusao', 'fundião', 'fundiu',
  'm&a', 'venture capital', 'fundo', 'unicorn', 'valuation',
  'fidc',  // Fundo de Investimento em Direitos Creditórios
  'ronda', 'financiamiento', 'inversión', 'inversion', 'levantó', 'levanto',
  'serie a', 'serie b', 'serie c', 'capital de riesgo',
  'adquisición', 'adquisicion', 'fusion', 'fusión',
  'raised', 'raises', 'funding', 'series a', 'series b', 'series c', 'series d',
  'seed round', 'pre-seed', 'growth round', 'bridge round', 'venture',
  'acquired', 'acquisition', 'merger', 'acquires', 'buys', 'buyout',
  'm&a', 'ipo', 'spac', 'valuation', 'unicorn', 'backed by', 'led by',
  'million', 'billion', '$',
]

const KEYWORDS_RE = new RegExp(
  FUNDING_KEYWORDS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i',
)

function isFundingArticle(article: Article): boolean {
  const haystack = `${article.title} ${article.description}`
  return KEYWORDS_RE.test(haystack)
}

// ─── RSS parser ─────────────────────────────────────────────────────────────────────

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

// ─── HTML parser ────────────────────────────────────────────────────────────────────

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

// ─── Article body fetcher ────────────────────────────────────────────────────────

async function fetchArticleBody(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VCMarket/1.0)', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return ''
    const html = await res.text()

    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '')

    const bodyMatch =
      cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
      cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
      cleaned.match(/<div[^>]*class=["'][^"']*(?:content|post|entry|article-body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ??
      cleaned

    const dateInPage =
      bodyMatch.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1] ??
      bodyMatch.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1] ??
      ''

    const text = bodyMatch
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1500)

    return dateInPage ? `[date:${dateInPage}] ${text}` : text
  } catch {
    return ''
  }
}

// ─── Enrich articles with full body + extracted date ───────────────────────────────

async function enrichArticles(articles: Article[]): Promise<Article[]> {
  const results = await Promise.allSettled(
    articles.map(async (a) => {
      if (a.description.length >= 300) return a
      const body = await fetchArticleBody(a.link)
      if (!body) return a
      const dateMatch = body.match(/^\[date:([^\]]+)\]/)
      const extractedDate = dateMatch?.[1] ?? ''
      const cleanBody = body.replace(/^\[date:[^\]]+\]\s*/, '')
      return { ...a, description: cleanBody, pubDate: a.pubDate || extractedDate }
    })
  )
  return results.map((r, i) => (r.status === 'fulfilled' ? r.value : articles[i]))
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────────────

async function fetchSource(source: Source): Promise<{ articles: Article[]; error?: string }> {
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
    if (!res.ok) return { articles: [], error: `HTTP ${res.status}` }
    const text = await res.text()
    const articles = source.type === 'rss'
      ? parseRSSItems(text, source.name)
      : parseHTMLItems(text, source.url, source.name)
    return { articles }
  } catch (err) {
    return { articles: [], error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── JSON extraction helper ────────────────────────────────────────────────────

function extractJsonArray(text: string): unknown[] {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const start = stripped.indexOf('[')
  if (start === -1) return []
  let end = stripped.lastIndexOf(']')
  let raw: string
  if (end === -1 || end < start) {
    raw = stripped.slice(start)
    const lastClose = raw.lastIndexOf('}')
    raw = lastClose !== -1 ? raw.slice(0, lastClose + 1) + ']' : '[]'
  } else {
    raw = stripped.slice(start, end + 1)
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    const objects: unknown[] = []
    for (const m of raw.matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g)) {
      try { objects.push(JSON.parse(m[0])) } catch { /* skip */ }
    }
    return objects
  }
}

// ─── Stage enum (shared between both prompts) ──────────────────────────────────
//
// FIDC = Fundo de Investimento em Direitos Creditórios.
// Brazilian debt/securitization instrument widely used by fintechs & startups
// to raise working capital. Not equity, but tracked as a distinct funding event.

const STAGE_ENUM =
  '"Pre-Seed"|"Seed"|"Series A"|"Series B"|"Series C"|"Series D"|"Series E"|' +
  '"Growth"|"Bridge"|"IPO"|"SPAC"|"M&A"|"FIDC"|null'

const SEGMENT_ENUM =
  '"AI/ML"|"Fintech"|"Healthtech"|"SaaS"|"E-commerce"|"Proptech"|"Edtech"|"Deeptech"|' +
  '"Cybersecurity"|"Logistics"|"Agritech"|"Cleantech"|"Biotech"|"Gaming"|"HR Tech"|' +
  '"Legal Tech"|"Retail Tech"|"Marketplace"|"Other"|null'

// ─── Prompt 1 — Extractor ─────────────────────────────────────────────────────────────

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

function buildExtractorPrompt(articles: Article[], today: string): string {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const articlesText = articles
    .map((a, i) =>
      `[${i}] Source: ${a.source}\nTitle: ${a.title}\nDate: ${a.pubDate || `unknown — assume ${today}`}\nURL: ${a.link}\nContent: ${a.description}`
    )
    .join('\n\n')

  return `You are a financial data extraction engine for Latin American VC deals.
Today: ${today} | Yesterday: ${yesterday}

Extract ALL potential funding deals from the articles. Be liberal — a second reviewer will validate.
Focus on: company name, amount, date, stage, investors, segment, country.

━━━ LATAM ONLY ━━━
Company must be headquartered in: ${LATAM_COUNTRIES_LIST}
Skip if clearly non-LATAM. If uncertain, include with low confidence.

━━━ VALID DEAL TYPES ━━━
Equity rounds (Pre-Seed to Series E+), Growth, Bridge, Angel, IPO, SPAC, M&A.
FIDC (Fundo de Investimento em Direitos Creditórios) — Brazilian securitization instrument.
Whenever a deal is funded via FIDC or mentions "fundo de recebíveis", "securitização" as the
primary funding mechanism, set stage = "FIDC".
Exclude: traditional bank loans/credit lines not backed by a FIDC structure, government grants,
crowdfunding, real estate.

━━━ OUTPUT ━━━
Raw JSON array only. No markdown. Return [] if nothing found.
[{
  "company_name": string,
  "amount_usd": number | null,
  "deal_date": "YYYY-MM-DD" | null,
  "stage": ${STAGE_ENUM},
  "investors": string[],
  "segment": ${SEGMENT_ENUM},
  "country": "XX" | null,
  "source_url": string,
  "confidence": "high"|"medium"|"low"
}]

━━━ ARTICLES ━━━
${articlesText}`
}

async function extractDeals(
  articles: Article[],
  today: string,
  apiKey?: string,
): Promise<{ deals: ExtractedDeal[]; error?: string }> {
  const client = new Anthropic({ apiKey })
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: buildExtractorPrompt(articles, today) }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    if (!text || text === '[]') return { deals: [] }
    return { deals: extractJsonArray(text) as ExtractedDeal[] }
  } catch (err) {
    return { deals: [], error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Prompt 2 — Reviewer ─────────────────────────────────────────────────────────────

interface ReviewedDeal extends ExtractedDeal {
  approved: boolean
  rejection_reason?: string
  deal_date: string
  stage: string | null
  segment: string | null
  country: string | null
  investors: string[]
}

function buildReviewerPrompt(
  candidates: ExtractedDeal[],
  existingDeals: Pick<VCDeal, 'company_name' | 'deal_date' | 'stage'>[],
  today: string,
): string {
  const cutoffDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const candidatesText = JSON.stringify(candidates, null, 2)

  const existingText = existingDeals.length > 0
    ? existingDeals
        .map(d => `- ${d.company_name} | ${d.stage ?? 'unknown stage'} | ${d.deal_date ?? 'unknown date'}`)
        .join('\n')
    : '(empty — no existing deals in database)'

  return `You are a senior VC data analyst reviewing extracted deals before they enter a database.
Today: ${today}
Date cutoff (48h window): ${cutoffDate} to ${today}

You will receive:
1. CANDIDATES — deals extracted from today/yesterday news
2. EXISTING DEALS — deals already in the database (last 60 days)

For each candidate, decide APPROVE or REJECT based on ALL of these rules:

━━━ RULE 1 — DATE ━━━
The deal_date must be ${cutoffDate} or later (within last 48h).
If deal_date is null, set it to today (${today}) and APPROVE.
If deal_date is clearly older than ${cutoffDate}, REJECT with reason "outdated".

━━━ RULE 2 — DUPLICATE VS DATABASE ━━━
A deal is a duplicate if the EXISTING DEALS list contains the same company
with any deal within the last 60 days (regardless of stage).
Assume a company will not close two separate rounds within 2 months.
If duplicate found, REJECT with reason "duplicate: already in DB as [stage] on [date]".

━━━ RULE 3 — LATAM GEOGRAPHY ━━━
Company must be based in Latin America. If country is null and you cannot
determine it from the company name/context, REJECT with reason "country unknown".

━━━ RULE 4 — DATA QUALITY ━━━
For approved deals, correct/enrich the fields:
- Normalize company_name (proper casing, remove legal suffixes like S.A., Ltda.)
- Fix stage if obviously wrong (e.g. "Fund" is not a valid stage — set to null)
- If the deal was funded via FIDC (Fundo de Investimento em Direitos Creditórios),
  "fundo de recebíveis", or "securitização", set stage = "FIDC" regardless of what
  the extractor set.
- Infer segment if null and context makes it clear
- Ensure investors is an array (not null)
- Keep amount_usd null if not explicitly stated (do not guess)

━━━ OUTPUT ━━━
Return a raw JSON array with one object per candidate (same order).
No markdown. No explanations outside the rejection_reason field.

[{
  "company_name": string,
  "amount_usd": number | null,
  "deal_date": "YYYY-MM-DD",
  "stage": ${STAGE_ENUM},
  "investors": string[],
  "segment": ${SEGMENT_ENUM},
  "country": "XX" | null,
  "source_url": string,
  "confidence": "high"|"medium"|"low",
  "approved": true | false,
  "rejection_reason": string | undefined
}]

━━━ CANDIDATES ━━━
${candidatesText}

━━━ EXISTING DEALS (last 60 days) ━━━
${existingText}`
}

async function reviewDeals(
  candidates: ExtractedDeal[],
  existingDeals: Pick<VCDeal, 'company_name' | 'deal_date' | 'stage'>[],
  today: string,
  apiKey?: string,
): Promise<{ reviewed: ReviewedDeal[]; error?: string }> {
  if (candidates.length === 0) return { reviewed: [] }
  const client = new Anthropic({ apiKey })
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: buildReviewerPrompt(candidates, existingDeals, today) }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    if (!text || text === '[]') return { reviewed: [] }
    return { reviewed: extractJsonArray(text) as ReviewedDeal[] }
  } catch (err) {
    return { reviewed: [], error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────────────

export async function scrapeVCDeals(
  userId: string,
  existingDeals: Pick<VCDeal, 'company_name' | 'deal_date' | 'stage'>[],
  apiKey?: string,
): Promise<{ deals: VCDealInsert[]; report: ScrapeReport }> {
  const today = new Date().toISOString().slice(0, 10)
  const cutoffMs = Date.now() - 48 * 60 * 60 * 1000

  const sourceResults = await Promise.allSettled(SOURCES.map(s => fetchSource(s)))

  const allArticles: Article[] = []
  const sources: SourceResult[] = []

  for (let i = 0; i < SOURCES.length; i++) {
    const r = sourceResults[i]
    if (r.status === 'fulfilled') {
      const { articles, error } = r.value
      allArticles.push(...articles)
      sources.push({
        name: SOURCES[i].name,
        status: error ? 'error' : articles.length === 0 ? 'empty' : 'ok',
        articlesFound: articles.length,
        error,
      })
    } else {
      sources.push({
        name: SOURCES[i].name,
        status: 'error',
        articlesFound: 0,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      })
    }
  }

  const totalArticles = allArticles.length
  const empty: ScrapeReport = {
    sources, totalArticles: 0, uniqueArticles: 0,
    articlesAfterKeywordFilter: 0, articlesAfterDateFilter: 0,
    dealsExtracted: 0, dealsAfterReview: 0, dealsAfterFilter: 0,
    reviewRejections: [], hardFilterRejections: [], dealRows: [],
  }

  if (totalArticles === 0) return { deals: [], report: empty }

  // 1. Deduplicate by title
  const seen = new Set<string>()
  const unique = allArticles.filter(a => {
    const key = a.title.toLowerCase().trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // 2. Keyword pre-filter
  const candidates = unique.filter(isFundingArticle)
  if (candidates.length === 0) {
    return { deals: [], report: { ...empty, totalArticles, uniqueArticles: unique.length } }
  }

  // 3. Enrich: fetch article body + extract pubDate from page
  const enriched = await enrichArticles(candidates)

  // 4. Date filter (after enrich so pubDate is populated)
  const dated = enriched.filter(a => isRecentArticle(a, cutoffMs))
  if (dated.length === 0) {
    return {
      deals: [],
      report: { ...empty, totalArticles, uniqueArticles: unique.length, articlesAfterKeywordFilter: candidates.length },
    }
  }

  // 5. Prompt 1 — extract deals from articles
  const { deals: extracted, error: aiError } = await extractDeals(dated, today, apiKey)

  if (extracted.length === 0) {
    return {
      deals: [],
      report: {
        ...empty,
        totalArticles, uniqueArticles: unique.length,
        articlesAfterKeywordFilter: candidates.length,
        articlesAfterDateFilter: dated.length,
        aiError,
      },
    }
  }

  // 6. Prompt 2 — review: validate date, dedup vs DB, enrich fields (incl. FIDC correction)
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const recentExisting = existingDeals.filter(
    d => !d.deal_date || d.deal_date >= sixtyDaysAgo
  )
  const { reviewed, error: reviewError } = await reviewDeals(extracted, recentExisting, today, apiKey)

  const approved = reviewed.filter(d => d.approved)
  const reviewRejections = reviewed
    .filter(d => !d.approved)
    .map(d => ({ company: d.company_name, reason: d.rejection_reason ?? 'unknown' }))

  // 7. Final hard filter: LATAM country + confidence
  const filtered = approved.filter(d =>
    d.company_name?.trim() &&
    d.confidence !== 'low' &&
    (d.country === null || LATAM_COUNTRIES.has(d.country.toUpperCase()))
  )

  const hardFilterRejections = approved
    .filter(d => !filtered.includes(d))
    .map(d => ({
      company: d.company_name,
      reason: d.confidence === 'low'
        ? 'low confidence'
        : `non-LATAM country: ${d.country}`,
    }))

  const deals: VCDealInsert[] = filtered.map(d => ({
    user_id:      userId,
    company_name: d.company_name.trim(),
    amount_usd:   d.amount_usd ?? null,
    deal_date:    d.deal_date ?? today,
    stage:        d.stage ?? null,
    investors:    d.investors ?? [],
    segment:      d.segment ?? null,
    country:      d.country ?? null,
    source_url:   d.source_url ?? null,
    source:       'scrape' as const,
  }))

  // Build unified deal rows for the report UI
  const dealRows: DealReviewRow[] = [
    ...filtered.map(d => ({
      company: d.company_name,
      stage: d.stage,
      country: d.country,
      confidence: d.confidence,
      outcome: 'approved' as const,
    })),
    ...hardFilterRejections.map(r => {
      const d = approved.find(a => a.company_name === r.company)
      return {
        company: r.company,
        stage: d?.stage ?? null,
        country: d?.country ?? null,
        confidence: d?.confidence ?? 'low',
        outcome: 'rejected_filter' as const,
        reason: r.reason,
      }
    }),
    ...reviewRejections.map(r => {
      const d = reviewed.find(a => a.company_name === r.company)
      return {
        company: r.company,
        stage: d?.stage ?? null,
        country: d?.country ?? null,
        confidence: d?.confidence ?? 'low',
        outcome: 'rejected_review' as const,
        reason: r.reason,
      }
    }),
  ]

  return {
    deals,
    report: {
      sources,
      totalArticles,
      uniqueArticles: unique.length,
      articlesAfterKeywordFilter: candidates.length,
      articlesAfterDateFilter: dated.length,
      dealsExtracted: extracted.length,
      dealsAfterReview: approved.length,
      dealsAfterFilter: filtered.length,
      reviewRejections,
      hardFilterRejections,
      dealRows,
      aiError,
      reviewError,
    },
  }
}
