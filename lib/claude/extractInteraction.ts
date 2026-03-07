import type { AIProvider } from '@/lib/ai/types'
import { logAIUsage } from '@/lib/ai/usage'

export const INTERACTION_TAGS = ['intro', 'hiring', 'strategy', 'fundraising', 'product', 'partnership', 'legal', 'operations'] as const
export type InteractionTag = typeof INTERACTION_TAGS[number]

export interface InteractionExtraction {
  summary: string
  is_intro: boolean
  is_reporting: boolean
  tags: string[]
  intro_contacts: Array<{
    name: string
    email?: string
    context: string
  }>
}

export interface ExtractInteractionLogParams {
  admin: { from: (table: string) => any }
  fundId: string
}

export async function extractInteraction(
  subject: string,
  bodyText: string,
  senderName: string,
  provider: AIProvider,
  providerType: string,
  model: string,
  logParams?: ExtractInteractionLogParams
): Promise<InteractionExtraction> {
  const prompt = buildPrompt(subject, bodyText, senderName)

  const raw = await callWithRetry(provider, providerType, prompt, model, logParams)
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
- "is_reporting": true if this email is primarily a portfolio company report, metrics update, financial report, or KPI summary — i.e. reporting data rather than a conversation
- "tags": pick ALL applicable tags from this list: ["intro", "hiring", "strategy", "fundraising", "product", "partnership", "legal", "operations"]. If it's an intro email, include "intro". Can be empty if none apply.
- "intro_contacts": array of people being introduced, each with "name", optional "email", and "context" (role/company/reason)`
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
  provider: AIProvider,
  providerType: string,
  prompt: string,
  model: string,
  logParams?: ExtractInteractionLogParams
): Promise<InteractionExtraction> {
  const first = await call(provider, providerType, prompt, model, logParams)
  const parsed = tryParse(first)
  if (parsed) return parsed

  const second = await call(provider, providerType, prompt + STRICT_SUFFIX, model, logParams)
  const reparsed = tryParse(second)
  if (reparsed) return reparsed

  throw new Error(
    `extractInteraction: AI returned non-JSON after retry. Last response: ${second.slice(0, 200)}`
  )
}

async function call(
  provider: AIProvider,
  providerType: string,
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
      provider: providerType,
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
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((t: unknown): t is string => typeof t === 'string' && INTERACTION_TAGS.includes(t as InteractionTag))
      : []
    return {
      summary: parsed.summary,
      is_intro: !!parsed.is_intro,
      is_reporting: !!parsed.is_reporting,
      tags,
      intro_contacts: Array.isArray(parsed.intro_contacts) ? parsed.intro_contacts : [],
    }
  } catch {
    return null
  }
}
