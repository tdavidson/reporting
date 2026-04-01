import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { Regulation } from '@/lib/regulacoes/types'

// Cache in-memory por processo (persiste entre requests no mesmo worker)
let cache: { data: Regulation[]; ts: number } | null = null
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 // 24h

const SYSTEM_PROMPT = `Você é um especialista em regulação do mercado financeiro brasileiro.
Retorne APENAS um array JSON válido (sem markdown, sem explicações) com objetos do tipo Regulation.
Todos os campos são obrigatórios. Datas no formato ISO YYYY-MM-DD.
officialUrl deve apontar para cvm.gov.br ou bcb.gov.br.
Os campos why nos impacts devem ser específicos, pragmáticos e verdadeiros para o mercado financeiro brasileiro.
`

const USER_PROMPT = `Gere o array JSON com EXATAMENTE estas 28 regulações reais do mercado financeiro brasileiro (2014-2025), em ordem cronológica:

icvm-555-2014 | Instrução CVM 555 | CVM | 2014-12-17
icvm-558-2015 | Instrução CVM 558 | CVM | 2015-03-26
icvm-578-2016 | Instrução CVM 578 | CVM | 2016-08-30
icvm-579-2016 | Instrução CVM 579 | CVM | 2016-08-31
res-bcb-4557-2017 | Resolução BCB 4.557 | BCB | 2017-02-23
icvm-588-2017 | Instrução CVM 588 | CVM | 2017-07-13
res-cmn-4656-2018 | Resolução CMN 4.656 | CMN | 2018-04-26
lgpd-13709-2018 | Lei Geral de Proteção de Dados | OTHER | 2018-08-14
icvm-592-2018 | Instrução CVM 592 | CVM | 2018-09-17
circular-bcb-3978-2020 | Circular BCB 3.978 | BCB | 2020-01-23
res-bcb-1-2020 | Resolução BCB 1 (PIX) | BCB | 2020-10-29
res-bcb-32-2020 | Open Banking Fase 1 | BCB | 2020-10-29
res-cvm-13-2020 | Resolução CVM 13 | CVM | 2020-11-24
res-bcb-80-2021 | Open Finance Fase 2 | BCB | 2021-02-25
res-cvm-30-2021 | Resolução CVM 30 | CVM | 2021-05-11
res-cvm-60-2021 | Resolução CVM 60 | CVM | 2021-12-23
res-bcb-195-2022 | Open Finance Fase 3 | BCB | 2022-04-07
res-cvm-160-2022 | Resolução CVM 160 | CVM | 2022-06-23
lei-14478-2022 | Marco Legal das Criptomoedas | OTHER | 2022-12-21
res-cvm-175-2022 | Resolução CVM 175 | CVM | 2022-12-23
res-bcb-277-2022 | Embedded Finance / BaaS | BCB | 2022-12-22
res-cvm-193-2023 | Resolução CVM 193 | CVM | 2023-06-09
res-bcb-354-2023 | Drex – Real Digital | BCB | 2023-09-21
res-cmn-5118-2023 | Resolução CMN 5.118 (ESG) | CMN | 2023-10-26
res-bcb-403-2024 | Open Finance Fase 4 | BCB | 2024-03-01
res-bcb-cripto-2024 | Regulação PSAVs | BCB | 2024-09-12
res-cvm-212-2024 | Resolução CVM 212 | CVM | 2024-11-07
res-cvm-222-2025 | Resolução CVM 222 | CVM | 2025-01-30

Para cada regulação, preencha todos os campos:
- id, name, shortName, issuer, date
- description: 1-2 frases resumindo
- fullContext: 3-5 frases de contexto completo
- whatChanged: o que mudou em relação ao regime anterior
- officialUrl: URL real em cvm.gov.br ou bcb.gov.br
- impacts.firstOrder: 3 entradas (quem cumpre diretamente)
- impacts.secondOrder: 3 entradas (afetados indiretamente)
- impacts.thirdOrder: 3 entradas (efeitos no ecossistema/startups)
- tags: array de 4-5 strings

Retorne SOMENTE o array JSON, sem nenhum texto antes ou depois.
`

export async function GET() {
  // Serve do cache se ainda válido
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.data)
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: USER_PROMPT }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    // Remove possível markdown wrapper
    const clean = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
    const data: Regulation[] = JSON.parse(clean)

    cache = { data, ts: Date.now() }
    return NextResponse.json(data)
  } catch (err) {
    console.error('[/api/regulacoes]', err)
    return NextResponse.json({ error: 'Falha ao gerar regulações' }, { status: 500 })
  }
}
