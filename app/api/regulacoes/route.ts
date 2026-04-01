import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { Regulation } from '@/lib/regulacoes/types'

let cache: { data: Regulation[]; ts: number } | null = null
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 // 24h

const SYSTEM_PROMPT = `You are an expert on Brazilian Central Bank (BACEN/BCB) regulation.
Return ONLY a valid JSON array — no markdown, no explanations, no wrapper.
All fields are required. Dates in ISO format YYYY-MM-DD.
officialUrl must point to bcb.gov.br.
impacts.why fields must be specific and accurate for the Brazilian market.
All issuer fields must be "BCB".
Each regulation must have 2-4 tags chosen EXCLUSIVELY from this list: "Crypto", "Payments", "Banking", "Open Finance", "AML", "Credit", "Capital Markets", "ESG", "Data & Privacy", "FX".
`

const USER_PROMPT = `Generate a JSON array with exactly 12 real BCB (Banco Central do Brasil) regulations (2017-2025), in chronological order:

res-bcb-4557-2017 | Resolução BCB 4.557 | BCB | 2017-02-23
circular-bcb-3978-2020 | Circular BCB 3.978 (AML) | BCB | 2020-01-23
res-bcb-1-2020 | Resolução BCB 1 (PIX) | BCB | 2020-10-29
res-bcb-32-2020 | Open Banking Fase 1 | BCB | 2020-10-29
res-bcb-80-2021 | Open Finance Fase 2 | BCB | 2021-02-25
res-bcb-195-2022 | Open Finance Fase 3 | BCB | 2022-04-07
res-bcb-277-2022 | Embedded Finance / BaaS | BCB | 2022-12-22
res-bcb-354-2023 | Drex – Real Digital | BCB | 2023-09-21
res-cmn-5118-2023 | Resolução CMN 5.118 (ESG) | BCB | 2023-10-26
res-bcb-403-2024 | Open Finance Fase 4 | BCB | 2024-03-01
res-bcb-cripto-2024 | Regulação PSAVs | BCB | 2024-09-12
res-bcb-novo-2025 | Resolução BCB mais recente de 2025 | BCB | 2025-01-01

For each, populate all fields:
- id, name, shortName, issuer (always "BCB"), date
- description: 1-2 sentences
- fullContext: 2-3 sentences
- whatChanged: one sentence on what changed vs prior regime
- officialUrl: real URL at bcb.gov.br
- impacts.firstOrder: 2 entries { sectorOrType, why }
- impacts.secondOrder: 2 entries { sectorOrType, why }
- impacts.thirdOrder: 2 entries { sectorOrType, why }
- tags: 2-4 strings chosen ONLY from: "Crypto", "Payments", "Banking", "Open Finance", "AML", "Credit", "Capital Markets", "ESG", "Data & Privacy", "FX"

Return ONLY the JSON array.
`

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.data)
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
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
