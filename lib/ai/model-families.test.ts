import { describe, it, expect } from 'vitest'
import { parseModelId, latestPerFamily, supportsEffort, effortForModel } from './model-families'

describe('parseModelId', () => {
  it('reads Anthropic families and versions', () => {
    expect(parseModelId('claude-opus-4-8')).toEqual({ family: 'opus', version: [4, 8] })
    expect(parseModelId('claude-fable-5-1')).toEqual({ family: 'fable', version: [5, 1] })
    expect(parseModelId('claude-haiku-4-5-20251001')).toEqual({ family: 'haiku', version: [4, 5] })
    expect(parseModelId('claude-3-5-sonnet-20241022')).toEqual({ family: 'sonnet', version: [3, 5] })
  })

  it('reads OpenAI families and versions', () => {
    expect(parseModelId('gpt-4o')).toEqual({ family: 'gpt', version: [4] })
    expect(parseModelId('gpt-4.1-mini')).toEqual({ family: 'gpt-mini', version: [4, 1] })
    expect(parseModelId('gpt-4o-2024-08-06')).toEqual({ family: 'gpt', version: [4] })
    expect(parseModelId('gpt-5')).toEqual({ family: 'gpt', version: [5] })
    expect(parseModelId('o4-mini')).toEqual({ family: 'o-mini', version: [4] })
    expect(parseModelId('o3')).toEqual({ family: 'o', version: [3] })
  })
})

describe('latestPerFamily', () => {
  const models = [
    { id: 'claude-fable-5-1', provider: 'anthropic' },
    { id: 'claude-opus-5', provider: 'anthropic' },
    { id: 'claude-sonnet-5', provider: 'anthropic' },
    { id: 'claude-fable-5', provider: 'anthropic' },
    { id: 'claude-opus-4-8', provider: 'anthropic' },
    { id: 'claude-sonnet-4-6', provider: 'anthropic' },
    { id: 'claude-haiku-4-5-20251001', provider: 'anthropic' },
    { id: 'claude-3-5-sonnet-20241022', provider: 'anthropic' },
  ]

  it('keeps the highest version of each family, in the original order', () => {
    expect(latestPerFamily(models).map(m => m.id)).toEqual([
      'claude-fable-5-1',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5-20251001',
    ])
  })

  it('breaks version ties in favour of the model listed first', () => {
    const tie = [
      { id: 'gpt-4o', provider: 'openai' },
      { id: 'gpt-4o-2024-08-06', provider: 'openai' },
      { id: 'gpt-4o-mini', provider: 'openai' },
    ]
    expect(latestPerFamily(tie).map(m => m.id)).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })

  it('does not merge families across providers', () => {
    const mixed = [
      { id: 'o3', provider: 'openai' },
      { id: 'claude-opus-5', provider: 'anthropic' },
      { id: 'gpt-5', provider: 'openai' },
      { id: 'gpt-4.1', provider: 'openai' },
    ]
    expect(latestPerFamily(mixed).map(m => m.id)).toEqual(['o3', 'claude-opus-5', 'gpt-5'])
  })
})

describe('supportsEffort', () => {
  it('follows the Anthropic effort rollout', () => {
    expect(supportsEffort('anthropic', 'claude-fable-5-1')).toBe(true)
    expect(supportsEffort('anthropic', 'claude-opus-5')).toBe(true)
    expect(supportsEffort('anthropic', 'claude-opus-4-5-20251101')).toBe(true)
    expect(supportsEffort('anthropic', 'claude-sonnet-4-6')).toBe(true)
    expect(supportsEffort('anthropic', 'claude-sonnet-4-5')).toBe(false)
    expect(supportsEffort('anthropic', 'claude-haiku-4-5-20251001')).toBe(false)
    expect(supportsEffort('anthropic', 'claude-3-5-sonnet-20241022')).toBe(false)
  })

  it('limits OpenAI to reasoning models', () => {
    expect(supportsEffort('openai', 'o3')).toBe(true)
    expect(supportsEffort('openai', 'o4-mini')).toBe(true)
    expect(supportsEffort('openai', 'gpt-5-mini')).toBe(true)
    expect(supportsEffort('openai', 'gpt-4.1')).toBe(false)
    expect(supportsEffort('openai', 'gpt-4o')).toBe(false)
  })
})

describe('effortForModel', () => {
  it('drops effort for models that reject it and caps OpenAI at high', () => {
    expect(effortForModel('anthropic', 'claude-haiku-4-5-20251001', 'high')).toBeUndefined()
    expect(effortForModel('anthropic', 'claude-opus-5', 'max')).toBe('max')
    expect(effortForModel('openai', 'o3', 'max')).toBe('high')
    expect(effortForModel('openai', 'o3', 'low')).toBe('low')
    expect(effortForModel('anthropic', 'claude-opus-5', undefined)).toBeUndefined()
  })
})
