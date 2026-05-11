import { describe, it, expect } from 'vitest'
import { validateSchema } from './validate'

describe('validateSchema', () => {
  it('rejects unknown schema names', async () => {
    const r = await validateSchema('made_up' as any, 'foo: bar')
    expect(r.valid).toBe(false)
    expect(r.errors[0].message).toMatch(/unknown schema/i)
  })

  it('rejects empty instructions but accepts non-empty', async () => {
    const empty = await validateSchema('instructions', '   \n\n')
    expect(empty.valid).toBe(false)
    const ok = await validateSchema('instructions', '# Memo Agent — Operating manual\n\nDo the thing.')
    expect(ok.valid).toBe(true)
    expect((ok.parsed as any).content).toContain('Memo Agent')
  })

  it('reports YAML syntax errors with a line number', async () => {
    const broken = `dimensions:
  - id: market
    weight: [unclosed
  - id: team`
    const r = await validateSchema('rubric', broken)
    expect(r.valid).toBe(false)
    expect(r.errors[0].kind).toBe('syntax')
    expect(r.errors[0].line).toBeGreaterThan(0)
  })

  it('reports schema errors as kind=schema with a path', async () => {
    // Missing required scoring_scale → schema error
    const minimal = `meta:
  version: "0.1"
dimensions: []`
    const r = await validateSchema('rubric', minimal)
    expect(r.valid).toBe(false)
    expect(r.errors.some(e => e.kind === 'schema')).toBe(true)
  })

  it('parses the bundled default rubric without errors', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const yamlText = await fs.readFile(path.join(process.cwd(), 'lib/memo-agent/defaults/rubric.yaml'), 'utf8')
    const r = await validateSchema('rubric', yamlText)
    if (!r.valid) {
      // Surface errors so a default-vs-schema drift is visible in test output.
      console.error('default rubric.yaml validation errors:', r.errors)
    }
    expect(r.valid).toBe(true)
  })

  it('parses the bundled default qa_library without errors', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const yamlText = await fs.readFile(path.join(process.cwd(), 'lib/memo-agent/defaults/qa_library.yaml'), 'utf8')
    const r = await validateSchema('qa_library', yamlText)
    if (!r.valid) console.error('default qa_library.yaml validation errors:', r.errors)
    expect(r.valid).toBe(true)
  })
})
