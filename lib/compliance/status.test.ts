import { describe, it, expect } from 'vitest'
import { resolveStatus } from './status'

describe('resolveStatus (the compliance page rule)', () => {
  it('completed beats everything', () => {
    expect(resolveStatus({ completed: true, dismissed: true, applies: 'no' }, 'applies')).toBe('completed')
  })
  it('dismissed → not_applicable', () => {
    expect(resolveStatus({ dismissed: true, applies: 'yes' }, 'applies')).toBe('not_applicable')
  })
  it('explicit applies wins over the questionnaire', () => {
    expect(resolveStatus({ applies: 'yes' }, 'not_applicable')).toBe('applies')
    expect(resolveStatus({ applies: 'no' }, 'applies')).toBe('not_applicable')
  })
  it('falls back to the questionnaire, then needs_review', () => {
    expect(resolveStatus({ applies: 'unsure' }, 'applies')).toBe('applies')
    expect(resolveStatus(undefined, undefined)).toBe('needs_review')
  })
})
