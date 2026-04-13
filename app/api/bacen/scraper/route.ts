import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Anthropic from '@anthropic-ai/sdk'
import type { Regulation } from '@/lib/regulacoes/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const RELEVANT_TAGS = [
  'Fintechs', 'Banking', 'Crypto', 'Payments', 'Open Finance',
  'AML', 'Credit', 'Capital Markets', 'Data & Privacy', 'FX',
] as const

const BACEN_FEEDS = [
  'https://www.bcb.gov.br/api/feed/app/normativos/normativos?ano=',
  'https://www.bcb.gov.br/api/feed/app/demaisnormativos/atosecomunicados?ano=',
]

const SYSTEM_PROMPT = `You are an expert on Brazilian financial regulation (BCB, CVM, CMN).
Return ONLY a valid JSON array — no markdown, no code fences, no explanations.
All fields are required. Dates must be YYYY-MM-DD.
issuer must be one of: "BCB", "CVM", "CMN", "OTHER".
officialUrl must be a real, verifiable URL from bcb.gov.br or similar.
tags: 2-3 strings only from: "Crypto","Payments","Banking","Open Finance","AML","Credit","Capital Markets","Data & Privacy","FX","Fintechs".
Be concise: description max 1 sentence, fullContext max 2 sentences, whatChanged max 1 sentence, each impact.why max 1 sentence.
If a norm is NOT relevant to fintechs, banking, crypto, payments, open finance, AML, credit, capital markets, data & privacy, or FX — exclude it entirely.`

// ─── Types ────────────────────────────────────────────────────────────────────

interface FeedEntry {
  id: string
  title: string
  link: string
  content: string
  updated: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseAtomFeed(xml: string): FeedEntry[] {
  const entries: FeedEntry[] = []
  const entryRegex = /<entry>([\/\s\S]*?)<\/entry>/g
  let match
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1]
    const id = (/<id>(.*?)<\/id>/.exec(block) ?? [])[1] ?? ''
    const title = (/<title[^>]*>(.*?)<\/title>/.exec(block) ?? [])[1] ?? ''
    const link = (/<link[^>]*href="([^"]+)"/.exec(block) ?? [])[1] ?? ''
    const content = (/<content[^>]*>([\/\s\S]*?)<\/content>/.exec(block) ?? [])[1] ?? ''
    const updated = (/<updated>(.*?)<\/updated>/.exec(block) ?? [])[1] ?? ''
    entries.push({
      id: id.trim(),
      title: title.replace(/<[^>]+>/g, '').trim(),
      link: link.trim(),
      content: content.replace(/<[^>]+>/g, '').trim(),
      updated: updated.trim(),
    })
  }
  return entries
}

async function fetchFeedEntries(year: number): Promise<FeedEntry[]> {
  const all: FeedEntry[] = []
  for (const base of BACEN_FEEDS) {
    try {
      const res = await fetch(`${base}${year}`, {
        headers: { 'Accept': 'application/atom+xml,application/xml,text/xml,*/*' },
        next: { revalidate: 0 },
      })
      if (!res.ok) continue
      const xml = await res.text()
      all.push(...parseAtomFeed(xml))
    } catch {
      // skip failed feed
    }
  }
  return all
}

function buildFilterPrompt(entries: FeedEntry[]): string {
  const list = entries
    .map((e, i) => `[${i + 1}] ID: ${e.id}\nTitle: ${e.title}\nDate: ${e.updated.slice(0, 10)}\nURL: ${e.link}\nSummary: ${e.content.slice(0, 300)}`)
    .join('\n\n')

  return `Below are ${entries.length} BACEN regulatory items published in ${new Date().getFullYear()}.
Filter and return ONLY those relevant to: Fintechs, Banking, Crypto, Payments, Open Finance, AML, Credit, Capital Markets, Data & Privacy, FX.

For each RELEVANT item, return a full regulation object with ALL fields:
- id: string (slug, e.g. "res-bcb-556-2026" — use the norm number from the title)
- name: string (full official name from title)
- shortName: string (common name, max 4 words)
- issuer: "BCB" | "CVM" | "CMN" | "OTHER"
- date: "YYYY-MM-DD"
- description: string (1 sentence describing what this norm does)
- fullContext: string (2 sentences max — why it matters)
- whatChanged: string (1 sentence — what specifically changed)
- officialUrl: string (use the URL provided)
- tags: string[] (2-3 from: "Crypto","Payments","Banking","Open Finance","AML","Credit","Capital Markets","Data & Privacy","FX","Fintechs")
- impacts: {
    firstOrder: [ { sectorOrType: string, why: string }, { sectorOrType: string, why: string } ]
    secondOrder: [ { sectorOrType: string, why: string }, { sectorOrType: string, why: string } ]
    thirdOrder: [ { sectorOrType: string, why: string }, { sectorOrType: string, why: string } ]
  }

Items to analyze:
${list}

Return ONLY the JSON array of relevant items. If none are relevant, return [].`
}

function slugify(title: string, id: string): string {
  const num = (/(\d+)/.exec(id) ?? [])[1] ?? id.slice(-6)
  const year = new Date().getFullYear()
  const prefix = title.toLowerCase().includes('resolucao') || title.toLowerCase().includes('resolu') ? 'res'
    : title.toLowerCase().includes('instrucao') || title.toLowerCase().includes('instru') ? 'in'
    : title.toLowerCase().includes('circular') ? 'circ'
    : title.toLowerCase().includes('comunicado') ? 'com'
    : 'norm'
  return `${prefix}-bcb-${num}-${year}`
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  // Validate cron secret
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const year = new Date().getFullYear()

  try {
    // 1. Fetch RSS feeds
    const entries = await fetchFeedEntries(year)
    if (entries.length === 0) {
      return NextResponse.json({ message: 'No entries found', inserted: 0, skipped: 0 })
    }

    // 2. AI filtering + enrichment via Claude
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildFilterPrompt(entries) }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    const clean = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

    let parsed: Regulation[] = []
    try {
      parsed = JSON.parse(clean)
    } catch {
      return NextResponse.json({ error: 'AI returned invalid JSON', raw: clean }, { status: 500 })
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return NextResponse.json({ message: 'No relevant regulations found', inserted: 0, skipped: 0, total: entries.length })
    }

    // 3. Upsert into Supabase (ignore duplicates)
    const db = createAdminClient() as any // eslint-disable-line
    const rows = parsed.map(r => ({
      id: r.id || slugify(r.name, r.id),
      name: r.name,
      short_name: r.shortName,
      issuer: r.issuer,
      date: r.date,
      description: r.description,
      full_context: r.fullContext ?? '',
      what_changed: r.whatChanged ?? '',
      official_url: r.officialUrl ?? '',
      tags: r.tags ?? [],
      impacts: r.impacts,
    }))

    const { data, error } = await db
      .from('regulations')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
      .select('id')

    if (error) throw error

    const inserted = data?.length ?? 0
    const skipped = parsed.length - inserted

    return NextResponse.json({
      success: true,
      year,
      total_fetched: entries.length,
      relevant: parsed.length,
      inserted,
      skipped,
      regulations: parsed.map(r => r.id),
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[GET /api/bacen/scraper]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
