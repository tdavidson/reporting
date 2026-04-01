import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { Regulation } from '@/lib/regulacoes/types'

let cache: { data: Regulation[]; ts: number } | null = null
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 // 24h

const SYSTEM_PROMPT = `You are an expert on Brazilian financial market regulation.
Return ONLY a valid JSON array — no markdown, no explanations, no wrapper.
All fields are required. Dates in ISO format YYYY-MM-DD.
officialUrl must point to cvm.gov.br or bcb.gov.br.
impacts.why fields must be specific and accurate for the Brazilian market.
`

const USER_PROMPT = `Generate a JSON array with exactly 12 real Brazilian financial market regulations (2017-2025), in chronological order:

icvm-588-2017 | Instrução CVM 588 | CVM | 2017-07-13
res-cmn-4656-2018 | Resolução CMN 4.656 | CMN | 2018-04-26
lgpd-13709-2018 | Lei Geral de Proteção de Dados | OTHER | 2018-08-14
circular-bcb-3978-2020 | Circular BCB 3.978 | BCB | 2020-01-23
res-bcb-1-2020 | Resolução BCB 1 (PIX) | BCB | 2020-10-29
res-bcb-32-2020 | Open Banking Fase 1 | BCB | 2020-10-29
res-bcb-80-2021 | Open Finance Fase 2 | BCB | 2021-02-25
res-cvm-160-2022 | Resolução CVM 160 | CVM | 2022-06-23
lei-14478-2022 | Marco Legal das Criptomoedas | OTHER | 2022-12-21
res-bcb-354-2023 | Drex – Real Digital | BCB | 2023-09-21
res-bcb-403-2024 | Open Finance Fase 4 | BCB | 2024-03-01
res-cvm-222-2025 | Resolução CVM 222 | CVM | 2025-01-30

For each, populate all fields:
- id, name, shortName, issuer, date
- description: 1-2 sentences
- fullContext: 2-3 sentences
- whatChanged: one sentence on what changed vs prior regime
- officialUrl: real URL at cvm.gov.br or bcb.gov.br
- impacts.firstOrder: 2 entries (direct compliance)
- impacts.secondOrder: 2 entries (indirectly affected)
- impacts.thirdOrder: 2 entries (ecosystem / startup implications)
- tags: 3-4 strings

Return ONLY the JSON array.
`

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.data)
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const message = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: USER_PROMPT }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    const clean = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
    const data: Regulation[] = JSON.parse(clean)

    cache = { data, ts: Date.now() }
    return NextResponse.json(data)
  } catch (err) {
    console.error('[/api/regulacoes]', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
