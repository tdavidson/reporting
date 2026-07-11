import { describe, it, expect } from 'vitest'
import { authorizeMcpTool, type McpConfig } from './auth'
import { PLATFORM_TOOL_MANIFEST, MCP_WRITE_CATEGORIES } from './tools-manifest'
import { PLATFORM_TOOLS, buildToolset } from './tools'

const config = (over: Partial<McpConfig> = {}): McpConfig => ({
  enabled: true,
  writeScopes: {},
  accountingEnabled: false,
  ...over,
})
const auth = (role: string, scopes: string[]) => ({ role, scopes })

describe('authorizeMcpTool — read gating', () => {
  it('allows any member to use plain read tools', () => {
    const t = { scope: 'read' as const }
    expect(authorizeMcpTool(t, auth('viewer', ['read']), config())).toBeNull()
    expect(authorizeMcpTool(t, auth('member', ['read']), config())).toBeNull()
    expect(authorizeMcpTool(t, auth('admin', ['read', 'write']), config())).toBeNull()
  })

  it('restricts admin-only read tools to admins', () => {
    const t = { scope: 'read' as const, admin: true }
    expect(authorizeMcpTool(t, auth('member', ['read']), config())).toMatch(/admin/i)
    expect(authorizeMcpTool(t, auth('admin', ['read']), config())).toBeNull()
  })
})

describe('authorizeMcpTool — write gating', () => {
  const t = { scope: 'write' as const, writeCategory: 'notes' }

  it('blocks writes when the category is not enabled', () => {
    expect(authorizeMcpTool(t, auth('admin', ['read', 'write']), config())).toMatch(/turned off/i)
  })

  it('blocks non-admins even when the category is enabled', () => {
    const c = config({ writeScopes: { notes: true } })
    expect(authorizeMcpTool(t, auth('member', ['read', 'write']), c)).toMatch(/admin/i)
  })

  it('blocks an admin whose key is read-only', () => {
    const c = config({ writeScopes: { notes: true } })
    expect(authorizeMcpTool(t, auth('admin', ['read']), c)).toMatch(/read-only/i)
  })

  it('allows an admin write-scoped key when the category is enabled', () => {
    const c = config({ writeScopes: { notes: true } })
    expect(authorizeMcpTool(t, auth('admin', ['read', 'write']), c)).toBeNull()
  })

  it('keeps categories independent (enabling notes does not enable ledger)', () => {
    const c = config({ writeScopes: { notes: true } })
    const ledger = { scope: 'write' as const, writeCategory: 'ledger' }
    expect(authorizeMcpTool(ledger, auth('admin', ['read', 'write']), c)).toMatch(/turned off/i)
  })
})

describe('platform tool manifest', () => {
  it('every tool has a unique snake_case name, description, scope, and object schema', () => {
    const names = new Set<string>()
    for (const t of PLATFORM_TOOL_MANIFEST) {
      expect(t.name).toMatch(/^[a-z_]+$/)
      expect(names.has(t.name)).toBe(false)
      names.add(t.name)
      expect(t.description.length).toBeGreaterThan(10)
      expect(['read', 'write']).toContain(t.scope)
      expect(t.inputSchema.type).toBe('object')
    }
  })

  it('every write tool declares a category that exists in MCP_WRITE_CATEGORIES', () => {
    const known = new Set(MCP_WRITE_CATEGORIES.map(c => c.key))
    for (const t of PLATFORM_TOOL_MANIFEST) {
      if (t.scope === 'write') {
        expect(t.writeCategory).toBeTruthy()
        expect(known.has(t.writeCategory!)).toBe(true)
      }
    }
  })

  it('read tools never carry a write category', () => {
    for (const t of PLATFORM_TOOL_MANIFEST) {
      if (t.scope === 'read') expect(t.writeCategory).toBeUndefined()
    }
  })
})

describe('registry assembly', () => {
  it('binds a handler to every manifest tool', () => {
    expect(PLATFORM_TOOLS.length).toBe(PLATFORM_TOOL_MANIFEST.length)
    for (const t of PLATFORM_TOOLS) expect(typeof t.handler).toBe('function')
  })

  it('exposes ledger tools only when accounting is enabled', () => {
    const withoutLedger = buildToolset(config({ accountingEnabled: false }))
    const withLedger = buildToolset(config({ accountingEnabled: true }))
    expect(withoutLedger.every(t => t.section === 'platform')).toBe(true)
    expect(withLedger.some(t => t.section === 'ledger')).toBe(true)
    expect(withLedger.length).toBeGreaterThan(withoutLedger.length)
  })

  it('tags folded-in ledger write tools with the ledger category', () => {
    const tools = buildToolset(config({ accountingEnabled: true }))
    for (const t of tools) {
      if (t.section === 'ledger' && t.scope === 'write') expect(t.writeCategory).toBe('ledger')
    }
  })
})
