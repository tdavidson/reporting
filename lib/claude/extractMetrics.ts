import { AnthropicProvider } from '@/lib/ai/anthropic'
import type { ContentBlock } from '@/lib/ai/types'

const DEFAULT_MODEL = 'claude-sonnet-4-5'

export interface MetricDef {
  id: string
  name: string
  slug: string
  description: string | null
  unit: string | null
  value_type: 'number' | 'currency' | 'percentage' | 'text'
}

export interface ImageInput {
  data: string   // base64
  mediaType: string // e.g. 'image/jpeg'
}

export interface ReportingPeriod {
  label: string
  year: number
  quarter: number | null
  month: number | null
  confidence: 'high' | 'medium' | 'low'
}

export interface ExtractedMetric {
  metric_id: string
  value: number | string
  confidence: 'high' | 'medium' | 'low'
  notes: string
}

export interface UnextractedMetric {
  metric_id: string
  reason: string
}

export interface ExtractMetricsResult {
  reporting_period: ReportingPeriod
  metrics: ExtractedMetric[]
  unextracted_metrics: UnextractedMetric[]
}

export async function extractMetrics(
  companyName: string,
  combinedText: string,
  metrics: MetricDef[],
  pdfBase64s: string[],
  images: ImageInput[],
  claudeApiKey: string,
  model: string = DEFAULT_MODEL
): Promise<ExtractMetricsResult> {
  const provider = new AnthropicProvider(claudeApiKey)
  const { system, userContent } = buildMessage(companyName, combinedText, metrics, pdfBase64s, images)

  const raw = await callWithRetry(provider, system, userContent, model)
  return raw
}

// ---------------------------------------------------------------------------
// Message construction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  `You are a financial data extraction assistant for a venture capital fund. ` +
  `Extract specific metrics from a portfolio company report. ` +
  `Rules:\n` +
  `- Return JSON only.\n` +
  `- Be conservative. Mark uncertain values as low confidence rather than guessing.\n` +
  `- Do not infer or calculate. Only extract values explicitly stated.\n` +
  `- If a metric appears multiple times, extract the most recent value.`

const STRICT_SUFFIX =
  `\n\nIMPORTANT: Your previous response could not be parsed as JSON. ` +
  `Return ONLY the raw JSON object. No markdown, no code blocks, no explanation, ` +
  `no text before or after the JSON.`

function buildMessage(
  companyName: string,
  combinedText: string,
  metrics: MetricDef[],
  pdfBase64s: string[],
  images: ImageInput[]
): { system: string; userContent: ContentBlock[] } {
  const metricList = metrics.map(m => ({
    id: m.id,
    name: m.name,
    slug: m.slug,
    description: m.description,
    unit: m.unit,
    value_type: m.value_type,
  }))

  const textPrompt = `Company: ${companyName}

Report content:
---
${combinedText}
---

Extract these metrics:
${JSON.stringify(metricList, null, 2)}

Return:
{
  "reporting_period": {
    "label": "Q3 2024",
    "year": 2024,
    "quarter": 3,
    "month": null,
    "confidence": "high|medium|low"
  },
  "metrics": [
    {
      "metric_id": "<uuid>",
      "value": "<number or string>",
      "confidence": "high|medium|low",
      "notes": "<where found, any caveats>"
    }
  ],
  "unextracted_metrics": [
    { "metric_id": "<uuid>", "reason": "<why not found>" }
  ]
}`

  // Build a mixed content array: text first, then PDFs, then images.
  // Claude reads all blocks before responding.
  const content: ContentBlock[] = [
    { type: 'text', text: textPrompt },
  ]

  for (const pdf of pdfBase64s) {
    content.push({ type: 'document', mediaType: 'application/pdf', data: pdf })
  }

  for (const img of images) {
    content.push({ type: 'image', mediaType: img.mediaType, data: img.data })
  }

  return { system: SYSTEM_PROMPT, userContent: content }
}

// ---------------------------------------------------------------------------
// Call + retry
// ---------------------------------------------------------------------------

async function callWithRetry(
  provider: AnthropicProvider,
  system: string,
  userContent: ContentBlock[],
  model: string
): Promise<ExtractMetricsResult> {
  const first = await call(provider, system, userContent, model)
  const parsed = tryParse(first)
  if (parsed) return parsed

  // Append strict instruction to the text block on retry
  const strictContent = appendStrictSuffix(userContent)
  const second = await call(provider, system, strictContent, model)
  const reparsed = tryParse(second)
  if (reparsed) return reparsed

  throw new Error(
    `extractMetrics: Claude returned non-JSON after retry. Last response: ${second.slice(0, 200)}`
  )
}

async function call(
  provider: AnthropicProvider,
  system: string,
  userContent: ContentBlock[],
  model: string
): Promise<string> {
  return provider.createMessage({
    model,
    maxTokens: 2048,
    system,
    content: userContent,
  })
}

// Appends the strict suffix to the first text block in the content array
function appendStrictSuffix(content: ContentBlock[]): ContentBlock[] {
  return content.map((block, i) => {
    if (i === 0 && block.type === 'text') {
      return { ...block, text: block.text + STRICT_SUFFIX }
    }
    return block
  })
}

function tryParse(raw: string): ExtractMetricsResult | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned)
    if (!parsed.reporting_period || !Array.isArray(parsed.metrics)) return null
    return parsed as ExtractMetricsResult
  } catch {
    return null
  }
}
