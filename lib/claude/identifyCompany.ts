import { AnthropicProvider } from '@/lib/ai/anthropic'

const DEFAULT_MODEL = 'claude-sonnet-4-5'

export interface CompanyRef {
  id: string
  name: string
  aliases: string[] | null
}

export interface IdentifyCompanyResult {
  company_id: string | null
  new_company_name: string | null
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
}

export async function identifyCompany(
  subject: string,
  bodyExcerpt: string,
  companies: CompanyRef[],
  claudeApiKey: string,
  model: string = DEFAULT_MODEL
): Promise<IdentifyCompanyResult> {
  const provider = new AnthropicProvider(claudeApiKey)
  const prompt = buildPrompt(subject, bodyExcerpt, companies)

  const raw = await callWithRetry(provider, prompt, model)
  return raw
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildPrompt(
  subject: string,
  bodyExcerpt: string,
  companies: CompanyRef[]
): string {
  const companyList = companies.map(c => ({
    id: c.id,
    name: c.name,
    aliases: c.aliases ?? [],
  }))

  return `Email subject: ${subject}
Email body (first 500 characters): ${bodyExcerpt.slice(0, 500)}

Known portfolio companies:
${JSON.stringify(companyList, null, 2)}

If identified: { "company_id": "<uuid>", "new_company_name": null, "confidence": "high|medium|low", "reasoning": "<one sentence>" }
If new company: { "company_id": null, "new_company_name": "<name>", "confidence": "high|medium|low", "reasoning": "<one sentence>" }
If unknown: { "company_id": null, "new_company_name": null, "confidence": "low", "reasoning": "<one sentence>" }`
}

const SYSTEM_PROMPT =
  `You are a portfolio reporting assistant for a venture capital fund. ` +
  `Your only job is to identify which portfolio company an inbound email refers to. ` +
  `Return JSON only. No prose.`

const STRICT_SUFFIX =
  `\n\nIMPORTANT: Your previous response could not be parsed as JSON. ` +
  `Return ONLY the raw JSON object. No markdown, no code blocks, no explanation, ` +
  `no text before or after the JSON.`

// ---------------------------------------------------------------------------
// Call + retry
// ---------------------------------------------------------------------------

async function callWithRetry(
  provider: AnthropicProvider,
  prompt: string,
  model: string
): Promise<IdentifyCompanyResult> {
  const first = await call(provider, prompt, model)
  const parsed = tryParse(first)
  if (parsed) return parsed

  // Retry with stricter instruction appended
  const second = await call(provider, prompt + STRICT_SUFFIX, model)
  const reparsed = tryParse(second)
  if (reparsed) return reparsed

  throw new Error(
    `identifyCompany: Claude returned non-JSON after retry. Last response: ${second.slice(0, 200)}`
  )
}

async function call(provider: AnthropicProvider, userPrompt: string, model: string): Promise<string> {
  return provider.createMessage({
    model,
    maxTokens: 256,
    system: SYSTEM_PROMPT,
    content: userPrompt,
  })
}

function tryParse(raw: string): IdentifyCompanyResult | null {
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned)
    if (typeof parsed.confidence !== 'string') return null
    return parsed as IdentifyCompanyResult
  } catch {
    return null
  }
}
