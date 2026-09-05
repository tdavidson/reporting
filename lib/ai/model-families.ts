import type { AIEffort } from './types'

/**
 * Model ids from both providers encode a family and a version, but in different shapes:
 * `claude-opus-4-8`, `claude-fable-5-1`, `claude-3-5-sonnet-20241022`, `gpt-4.1-mini`,
 * `gpt-4o-2024-08-06`, `o4-mini`. This module reads the family and version out of an id so the
 * picker can offer one model per family and the providers can tell which models take an effort
 * setting. Pure, no SDK imports — it runs in the browser too.
 */

export interface ParsedModel {
  /** e.g. `opus`, `sonnet`, `gpt`, `gpt-mini`, `o`, `o-mini` */
  family: string
  /** e.g. `[4, 8]` for opus-4-8, `[4, 1]` for gpt-4.1, `[]` when the id carries no version */
  version: number[]
}

/** Trailing date stamps (`-20241022`, `-2024-08-06`, `-1106`) that name a snapshot, not a model. */
const DATE_SUFFIX = /-(\d{4}-\d{2}-\d{2}|\d{8}|\d{4})$/
const VERSION_TOKEN = /^\d+(\.\d+)*o?$/
const O_SERIES_TOKEN = /^o\d+$/

export function parseModelId(id: string): ParsedModel {
  const bare = id.toLowerCase().replace(/^claude-/, '').replace(DATE_SUFFIX, '')
  const family: string[] = []
  const version: number[] = []
  for (const token of bare.split('-')) {
    if (!token) continue
    if (O_SERIES_TOKEN.test(token)) {
      family.push('o')
      version.push(Number(token.slice(1)))
    } else if (VERSION_TOKEN.test(token)) {
      version.push(...token.replace(/o$/, '').split('.').map(Number))
    } else {
      family.push(token)
    }
  }
  return { family: family.join('-') || bare, version }
}

/** Lexicographic, missing places count as zero: `[5]` equals `[5, 0]`, `[5, 1]` beats `[5]`. */
export function compareVersions(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * One model per family (per provider): the highest version, and on a tie the one listed first —
 * providers list newest-first, so a tie goes to the most recently released. Output keeps the
 * input's order for the models that survive.
 */
export function latestPerFamily<T extends { id: string; provider?: string }>(models: T[]): T[] {
  const best = new Map<string, { model: T; version: number[] }>()
  for (const model of models) {
    const { family, version } = parseModelId(model.id)
    const key = `${model.provider ?? ''}:${family}`
    const current = best.get(key)
    if (!current || compareVersions(version, current.version) > 0) {
      best.set(key, { model, version })
    }
  }
  const keep = new Set(Array.from(best.values(), entry => entry.model))
  return models.filter(model => keep.has(model))
}

/**
 * Whether a model accepts an effort setting. Anthropic: `output_config.effort` arrived with
 * Opus 4.5 and Sonnet 4.6, and every Fable model has it; Haiku never has. OpenAI:
 * `reasoning_effort` is a reasoning-model parameter (o-series and gpt-5), and the chat models
 * before it reject the field outright.
 */
export function supportsEffort(provider: string, modelId: string): boolean {
  const { family, version } = parseModelId(modelId)
  if (provider === 'anthropic') {
    if (family === 'fable' || family === 'mythos') return true
    if (family === 'opus') return compareVersions(version, [4, 5]) >= 0
    if (family === 'sonnet') return compareVersions(version, [4, 6]) >= 0
    return false
  }
  if (provider === 'openai') {
    return family === 'o' || family.startsWith('o-') || (family.startsWith('gpt') && compareVersions(version, [5]) >= 0)
  }
  return false
}

/**
 * The effort a provider will actually accept for a model, or undefined to send nothing. OpenAI's
 * scale stops at `high`, so `max` steps down rather than erroring.
 */
export function effortForModel(provider: string, modelId: string, effort: AIEffort | undefined): AIEffort | undefined {
  if (!effort || !supportsEffort(provider, modelId)) return undefined
  if (provider === 'openai' && effort === 'max') return 'high'
  return effort
}
