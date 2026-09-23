import type { AppFetch } from '@/components/app-runtime'
import type { DemoAnswer, DemoAnswers, DemoScope, DemoSnapshot } from './types'

/**
 * The app's API, answered from the snapshot.
 *
 * Only the routes the palette and the Analyst call are here, with the response shapes those
 * components read (see the `getJson<...>` generics in components/command-palette.tsx and the
 * handler in components/analyst-conversation.tsx). Anything else is a 404, which every caller
 * already treats as "empty". Writes are refused with the message the real read-only demo uses.
 */
export function createDemoFetch(snapshot: DemoSnapshot, answers: DemoAnswers): AppFetch {
  const index = buildAnswerIndex(answers)

  return async (input, init) => {
    const url = new URL(input, 'https://demo.invalid')
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.pathname

    if (method !== 'GET' && !(method === 'POST' && path === '/api/analyst')) {
      return json({ error: 'This is a read-only demo. Changes are not allowed.' }, 403)
    }

    switch (path) {
      case '/api/companies':
        return json(snapshot.companies.map(c => ({ id: c.id, name: c.name, aliases: c.aliases })))
      case '/api/lps/investors':
        return json(snapshot.lps.map(lp => ({ id: lp.id, name: lp.name, lp_entities: [] })))
      case '/api/deals':
        return json(snapshot.deals.map(d => ({
          id: d.id, company_name: d.company_name, founder_name: d.founder_name, status: d.status,
        })))
      case '/api/accounting/vehicle-index':
        return json(snapshot.vehicles.map(v => ({ name: v.name, id: v.id, kind: v.kind })))
      case '/api/claude-models':
        // One entry so the picker has something to show; the "model" is the stored reply set.
        return json({ models: [{ id: DEMO_MODEL.id, name: DEMO_MODEL.name }] })
      case '/api/openai-models':
        return json({ models: [] })
      case '/api/analyst/conversations':
        return json({ conversations: [] })
      case '/api/analyst':
        return analyst(await readBody(init), init?.signal, index, answers)
      default:
        return json({ error: 'Not found' }, 404)
    }
  }
}

export const DEMO_MODEL = { id: 'demo-stored-replies', name: 'Stored replies (demo)', provider: 'anthropic' }

// ---------------------------------------------------------------------------
// The Analyst
// ---------------------------------------------------------------------------

interface AnalystBody {
  messages?: { role: string; content: string }[]
  companyId?: string
  conversationId?: string
}

async function analyst(
  body: AnalystBody,
  signal: AbortSignal | null | undefined,
  index: IndexedAnswer[],
  answers: DemoAnswers,
): Promise<Response> {
  const last = [...(body.messages ?? [])].reverse().find(m => m.role === 'user')
  if (!last) return json({ error: 'messages array is required' }, 400)

  const scope: DemoScope = body.companyId ? `company:${body.companyId}` : 'portfolio'
  const hit = matchAnswer(last.content, scope, index)
  const reply = hit?.answer.reply ?? answers.fallback

  // A real answer takes a moment; an instant one reads as canned even when it is right.
  await wait(Math.min(1800, 500 + reply.length * 2), signal)

  return json({
    reply,
    model: hit?.answer.model ?? { id: DEMO_MODEL.id, provider: DEMO_MODEL.provider },
    conversationId: body.conversationId ?? `demo-${Date.now().toString(36)}`,
    proposals: [],
    vehicle: null,
    scope: body.companyId ? { companyId: body.companyId } : { portfolio: true },
    toolCalls: [],
    stagedActions: [],
    blocks: [],
  })
}

interface IndexedAnswer { answer: DemoAnswer; phrasings: Set<string>[] }

function buildAnswerIndex(answers: DemoAnswers): IndexedAnswer[] {
  return answers.answers.map(answer => ({
    answer,
    phrasings: [answer.question, ...(answer.aliases ?? [])].map(tokens),
  }))
}

/**
 * The closest stored question to what was typed: token overlap (Jaccard) over the question and
 * its aliases, in the current scope first and the portfolio as a fallback from a company. Below
 * the threshold the caller gets the fallback text, which says what the product would do.
 */
export function matchAnswer(question: string, scope: DemoScope, index: IndexedAnswer[]): { answer: DemoAnswer; score: number } | null {
  const q = tokens(question)
  if (q.size === 0) return null
  let best: { answer: DemoAnswer; score: number } | null = null
  for (const entry of index) {
    const inScope = entry.answer.scope === scope
    const fallbackScope = scope !== 'portfolio' && entry.answer.scope === 'portfolio'
    if (!inScope && !fallbackScope) continue
    for (const p of entry.phrasings) {
      let score = jaccard(q, p)
      if (!inScope) score *= 0.85
      if (!best || score > best.score) best = { answer: entry.answer, score }
    }
  }
  return best && best.score >= 0.2 ? best : null
}

const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'with', 'our', 'we', 'i', 'my', 'me', 'do', 'does', 'did', 'what', 'whats', 'which', 'who', 'how', 'this', 'that', 'it', 'its', 'be', 'at', 'as', 'by', 'from', 'have', 'has', 'should', 'can', 'could', 'would', 'please', 'tell', 'about', 'give', 'show', 'any', 'across', 'last', 'year', 'company', 'companies'])

export function tokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue
    // Light stemming: plural and past-tense endings, so "grew" ≠ "grow" is left alone but
    // "gains"/"gain" and "runways"/"runway" meet.
    out.add(raw.replace(/(ies)$/, 'y').replace(/(s|ed|ing)$/, ''))
  }
  return out
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function readBody(init?: RequestInit): Promise<AnalystBody> {
  if (!init?.body || typeof init.body !== 'string') return {}
  try {
    return JSON.parse(init.body) as AnalystBody
  } catch {
    return {}
  }
}

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
  })
}
