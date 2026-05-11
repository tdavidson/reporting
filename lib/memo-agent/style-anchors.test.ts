import { describe, it, expect } from 'vitest'
import { getSynthesisConfidence } from './style-anchors'

describe('getSynthesisConfidence', () => {
  it('classifies thresholds per style_anchors.yaml minimum_useful_count', () => {
    expect(getSynthesisConfidence(0)).toBe('unavailable')
    expect(getSynthesisConfidence(1)).toBe('preliminary')
    expect(getSynthesisConfidence(2)).toBe('preliminary')
    expect(getSynthesisConfidence(3)).toBe('reliable')
    expect(getSynthesisConfidence(7)).toBe('reliable')
    expect(getSynthesisConfidence(8)).toBe('robust')
    expect(getSynthesisConfidence(40)).toBe('robust')
  })

  it('treats negative or NaN as unavailable', () => {
    expect(getSynthesisConfidence(-1)).toBe('unavailable')
    expect(getSynthesisConfidence(NaN)).toBe('unavailable')
  })
})
