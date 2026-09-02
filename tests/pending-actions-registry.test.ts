import { describe, it, expect } from 'vitest'
import { getWriteAction, WRITE_ACTIONS } from '@/lib/pending-actions/registry'

describe('write-action registry', () => {
  it('maps each action to its access domain', () => {
    expect(getWriteAction('update_company_metric')?.domain).toBe('portfolio')
    expect(getWriteAction('record_investment')?.domain).toBe('portfolio')
    expect(getWriteAction('issue_capital_call')?.domain).toBe('lp_capital')
    expect(getWriteAction('update_portfolio_construction')?.domain).toBe('accounting')
  })

  it('requires accounting write access to stage construction changes', () => {
    expect(getWriteAction('update_portfolio_construction')?.stageAccess).toBe('write')
  })

  it('carries the investments feature on record_investment', () => {
    expect(getWriteAction('record_investment')?.accessFeature).toBe('investments')
  })

  it('returns undefined for an unknown action', () => {
    expect(getWriteAction('nope')).toBeUndefined()
  })

  it('gives every action a preview and execute', () => {
    for (const action of Object.values(WRITE_ACTIONS)) {
      expect(typeof action.preview).toBe('function')
      expect(typeof action.execute).toBe('function')
      expect(action.inputSchema).toBeTypeOf('object')
    }
  })
})
