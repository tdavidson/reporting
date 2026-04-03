import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Anthropic from '@anthropic-ai/sdk'
import type { Regulation } from '@/lib/regulacoes/types'

const SYSTEM_PROMPT = `You are an expert on Brazilian financial regulation (BCB, CVM, CMN).
Return ONLY a valid JSON array — no markdown, no code fences, no explanations.
All fields are required. Dates must be YYYY-MM-DD.
issuer must be one of: "BCB", "CVM", "CMN", "OTHER".
officialUrl must be a real, verifiable URL from bcb.gov.br, cvm.gov.br, or similar.
tags: 2-3 strings only from: "Crypto","Payments","Banking","Open Finance","AML","Credit","Capital Markets","ESG","Data & Privacy","FX".
Be concise: description max 1 sentence, fullContext max 2 sentences, whatChanged max 1 sentence, each impact.why max 1 sentence.`

function buildPrompt(year: number): string {
  return `Return a JSON array of the most important Brazilian financial regulations published in ${year}.
Include regulations from BCB, CVM, and CMN. Focus on regulations that significantly impacted fintechs, payments, open finance, crypto, capital markets, or AML compliance.
Aim for 6–12 regulations. Only include regulations you are confident about — do not hallucinate.

Each object must have:
  id: string (slug, e.g. "res-bcb-1-2020")
  name: string (full official name)
  shortName: string (common name, max 4 words)
  issuer: "BCB" | "CVM" | "CMN" | "OTHER"
  date: "YYYY-MM-DD"
  description: string (1 sentence)
  fullContext: string (2 sentences max)
  whatChanged: string (1 sentence)
  officialUrl: string
  tags: string[] (2-3 items)
  impacts: {
    firstOrder:  [ { sectorOrType: string, why: string }, ... ] (2 entries)
    secondOrder: [ { sectorOrType: string, why: string }, ... ] (2 entries)
    thirdOrder:  [ { sectorOrType: string, why: string }, ... ] (2 entries)
  }

Return ONLY the JSON array.`
}

function fromRow(row: Record<string, unknown>): Regulation {
  return {
    id:          row.id as string,
    name:        row.name as string,
    shortName:   row.short_name as string,
    issuer:      row.issuer as Regulation['issuer'],
    date:        (row.date as string).slice(0, 10),
    description: row.description as string,
    fullContext:  row.full_context as string,
    whatChanged: row.what_changed as string,
    officialUrl: row.official_url as string,
    tags:        (row.tags as string[]) ?? [],
    impacts:     row.impacts as Regulation['impacts'],
  }
}

export async function POST(req: Request) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { year } = await req.json() as { year: number }
    if (!year || year < 2010 || year > 2030) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5-20251001',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildPrompt(year) }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    const clean = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
    const parsed: Regulation[] = JSON.parse(clean)

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return NextResponse.json({ inserted: 0, skipped: 0 })
    }

    const db = createAdminClient() as any // eslint-disable-line
    const rows = parsed.map(r => ({
      id:           r.id,
      name:         r.name,
      short_name:   r.shortName,
      issuer:       r.issuer,
      date:         r.date,
      description:  r.description,
      full_context: r.fullContext ?? '',
      what_changed: r.whatChanged ?? '',
      official_url: r.officialUrl ?? '',
      tags:         r.tags ?? [],
      impacts:      r.impacts,
    }))

    const { data, error } = await db
      .from('regulations')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
      .select('id')

    if (error) throw error

    const inserted = data?.length ?? 0
    const skipped  = parsed.length - inserted
    return NextResponse.json({ inserted, skipped, regulations: parsed.map(r => r.id) })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/regulacoes/fetch-year]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
