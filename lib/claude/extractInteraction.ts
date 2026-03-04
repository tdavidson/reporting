import { AnthropicProvider } from '@/lib/ai/anthropic'
import { logAIUsage } from '@/lib/ai/usage'

const DEFAULT_MODEL = 'claude-sonnet-4-5'

export interface InteractionExtraction {
  summary: string
  is_intro: boolean
  intro_contacts: Array<{
    name: string
    email?: string
    context: string
  }>
  topics: string[]
}

export interface ExtractInteractionLogParams {
  admin: { from: (table: string) => any }
  fundId: string
}

export async function extractInteraction(
  subject: string,
  bodyText: string,
  senderName: string,
  claudeApiKey: string,
  model: string = DEFAULT_MODEL,
  logParams?: ExtractInteractionLogParams
): Promise<InteractionExtraction> {
  const provider = new AnthropicProvider(claudeApiKey)
  const prompt = buildPrompt(subject, bodyText, senderName)

  const raw = await callWithRetry(provider, prompt, model, logParams)
  return raw
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildPrompt(subject: string, bodyText: string, senderName: string): string {
  return `Email subject: ${subject}
Sender: ${senderName}
Email body (first 1000 characters): ${bodyText.slice(0, 1000)}

Return a JSON object with:
- "summary": 1-3 sentence summary of this email
- "is_intro": true if this email introduces two or more parties to each other
- "intro_contacts": array of people being introduced, each with "name", optional "email", and "context" (role/company/reason)
- "topics": array of key topics discussed (e.g. "fundraising", "hiring", "product", "partnership")`
}

const SYSTEM_PROMPT =
  `You are analyzing an email sent by a venture capital GP. ` +
  `Summarize the conversation and identify if this email contains an introduction between parties. ` +
  `Extract names and context of anyone being introduced. ` +
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
  model: string,
  logParams?: ExtractInteractionLogParams
): Promise<InteractionExtraction> {
  const first = await call(provider, prompt, model, logParams)
  const parsed = tryParse(first)
  if (parsed) return parsed

  const second = await call(provider, prompt + STRICT_SUFFIX, model, logParams)
  const reparsed = tryParse(second)
  if (reparsed) return reparsed

  throw new Error(
    `extractInteraction: Claude returned non-JSON after retry. Last response: ${second.slice(0, 200)}`
  )
}

async function call(
  provider: AnthropicProvider,
  userPrompt: string,
  model: string,
  logParams?: ExtractInteractionLogParams
): Promise<string> {
  const { text, usage } = await provider.createMessage({
    model,
    maxTokens: 1024,
    system: SYSTEM_PROMPT,
    content: userPrompt,
  })

  if (logParams) {
    logAIUsage(logParams.admin, {
      fundId: logParams.fundId,
      provider: 'anthropic',
      model,
      feature: 'extract_interaction',
      usage,
    })
  }

  return text
}

function tryParse(raw: string): InteractionExtraction | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned)
    if (typeof parsed.summary !== 'string') return null
    return {
      summary: parsed.summary,
      is_intro: !!parsed.is_intro,
      intro_contacts: Array.isArray(parsed.intro_contacts) ? parsed.intro_contacts : [],
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
    }
  } catch {
    return null
  }
}
