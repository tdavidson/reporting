import { describe, it, expect } from 'vitest'
import { buildCategorizePrompt, parseCategorizations } from './categorize-ai'
import type { Account } from './types'

const accounts: Account[] = [
  { id: 'a', fundId: 'f', code: '5100', name: 'Partnership expenses', type: 'expense' },
  { id: 'b', fundId: 'f', code: '3100', name: 'LP Capital', type: 'equity' },
]

describe('buildCategorizePrompt', () => {
  it('lists the chart and passes transactions as JSON', () => {
    const { system, content } = buildCategorizePrompt(accounts, [{ id: 't1', date: '2026-06-01', amount: -1200, description: 'Audit' }])
    expect(system).toContain('5100  Partnership expenses  (expense)')
    expect(JSON.parse(content)[0]).toMatchObject({ id: 't1', amount: -1200 })
  })
})

describe('parseCategorizations', () => {
  it('parses a JSON array', () => {
    const out = parseCategorizations('[{"id":"t1","accountCode":"5100","sourceType":"partnership_expense"}]')
    expect(out).toEqual([{ id: 't1', accountCode: '5100', sourceType: 'partnership_expense' }])
  })

  it('tolerates fences and prose', () => {
    const out = parseCategorizations('Here:\n```json\n[{"id":"t2","accountCode":"3100","sourceType":"capital_call"}]\n```')
    expect(out[0].id).toBe('t2')
  })

  it('drops entries missing id or accountCode, defaults sourceType', () => {
    const out = parseCategorizations('[{"id":"t3","accountCode":"5100"},{"accountCode":"x"},{"id":"t4"}]')
    expect(out).toEqual([{ id: 't3', accountCode: '5100', sourceType: 'manual' }])
  })

  it('throws when there is no array', () => {
    expect(() => parseCategorizations('nope')).toThrow()
  })
})
