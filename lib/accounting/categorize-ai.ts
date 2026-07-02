// AI categorization of staged bank transactions. The keyword categorizer in
// bank.ts is the deterministic first pass; this upgrades the uncertain rows by
// asking the model to map each transaction to a chart account + source type,
// given the fund's actual chart. Prompt and parser are pure and testable; the
// model call lives in the route.

import { DRAFT_SOURCE_TYPES } from './draft'
import type { Account } from './types'

export interface TxnToCategorize {
  id: string
  date: string
  amount: number
  description: string
}

export function buildCategorizePrompt(accounts: Account[], txns: TxnToCategorize[]): { system: string; content: string } {
  const chart = accounts.map(a => `${a.code}  ${a.name}  (${a.type})`).join('\n')
  const system = [
    'You are a fund accountant categorizing bank transactions. For EACH transaction, choose the',
    'single non-cash chart account it should book against, and a source type.',
    '',
    '- Use ONLY these accounts, by code:',
    chart,
    '- amount is signed: positive = money IN (deposit), negative = money OUT.',
    `- sourceType must be one of: ${DRAFT_SOURCE_TYPES.join(', ')}.`,
    '- Respond with STRICT JSON only — an array, no prose, no code fences:',
    '[{"id":"<txn id>","accountCode":"5100","sourceType":"partnership_expense"}]',
  ].join('\n')
  const content = JSON.stringify(txns.map(t => ({ id: t.id, date: t.date, amount: t.amount, description: t.description })))
  return { system, content }
}

export interface Categorization {
  id: string
  accountCode: string
  sourceType: string
}

/** Parse the model's JSON array of categorizations, tolerating fences/prose. */
export function parseCategorizations(text: string): Categorization[] {
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON array found in model response')
  const arr = JSON.parse(s.slice(start, end + 1))
  if (!Array.isArray(arr)) throw new Error('Expected a JSON array')
  return arr
    .filter((c: any) => c && c.id && c.accountCode)
    .map((c: any) => ({ id: String(c.id), accountCode: String(c.accountCode), sourceType: String(c.sourceType ?? 'manual') }))
}
