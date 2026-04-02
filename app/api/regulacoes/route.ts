import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { Regulation } from '@/lib/regulacoes/types'

export const revalidate = 86400 // 24h — Next.js data cache, survives cold starts

const SYSTEM_PROMPT = `You are an expert on Brazilian Central Bank (BACEN/BCB) regulation.
Return ONLY a valid JSON array. No markdown, no code fences, no explanations.
All fields required. Dates: YYYY-MM-DD. issuer always "BCB".
officialUrl must be a real bcb.gov.br URL.
tags: 2-3 strings only from: "Crypto","Payments","Banking","Open Finance","AML","Credit","ESG","FX".
Be concise: description max 1 sentence, fullContext max 2 sentences, whatChanged max 1 sentence, why max 1 sentence.
`

const USER_PROMPT = `Return a JSON array of exactly 8 BCB regulations:

1. id:"res-bcb-1-2020" name:"Resolução BCB 1 (PIX)" date:"2020-10-29"
2. id:"res-bcb-32-2020" name:"Open Banking Fase 1" date:"2020-10-29"
3. id:"res-bcb-80-2021" name:"Open Finance Fase 2" date:"2021-02-25"
4. id:"res-bcb-195-2022" name:"Open Finance Fase 3" date:"2022-04-07"
5. id:"res-bcb-277-2022" name:"Embedded Finance / BaaS" date:"2022-12-22"
6. id:"res-bcb-354-2023" name:"Drex – Real Digital" date:"2023-09-21"
7. id:"res-bcb-403-2024" name:"Open Finance Fase 4" date:"2024-03-01"
8. id:"res-bcb-cripto-2024" name:"Regulação PSAVs" date:"2024-09-12"

Each object must have: id, name, shortName, issuer("BCB"), date, description, fullContext, whatChanged, officialUrl, tags, impacts.
impacts must have firstOrder, secondOrder, thirdOrder — each an array of 2 objects with sectorOrType and why.
Return ONLY the JSON array.
`

async function fetchFromAI(): Promise<Regulation[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 6000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: USER_PROMPT }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''
  const clean = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

  try {
    return JSON.parse(clean)
  } catch {
    const lastBracket = clean.lastIndexOf('},')
    const fixed = clean.slice(0, lastBracket + 1) + ']'
    return JSON.parse(fixed)
  }
}

export async function GET() {
  try {
    const data = await fetchFromAI()
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 's-maxage=86400, stale-while-revalidate=3600' },
    })
  } catch (err) {
    console.error('[/api/regulacoes]', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
