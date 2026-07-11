// Auth for the platform-wide MCP server. The fund API-key primitives are already
// generic (a key belongs to a fund member and acts as that member); they live in
// lib/accounting/api-keys.ts for historical reasons — the ledger shipped the
// first agent surface. Re-export them here so platform MCP code imports from a
// neutral, domain-agnostic path, and add the things unique to the platform
// endpoint: the admin on/off gate and the write opt-in.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FeatureVisibilityMap } from '@/lib/types/features'

export {
  generateApiKey,
  hashApiKey,
  bearerToken,
  resolveFundFromApiKey,
  authorizeToolUse,
} from '@/lib/accounting/api-keys'
export type { GeneratedKey, ResolvedKey } from '@/lib/accounting/api-keys'

export interface McpConfig {
  /** Master switch — false means the MCP endpoint is closed for this fund. */
  enabled: boolean
  /** Per-category write opt-ins, e.g. { notes: true, ledger: true }. */
  writeScopes: Record<string, boolean>
  /** Whether the ledger/accounting tool set should be exposed for this fund. */
  accountingEnabled: boolean
}

/**
 * Resolve a fund's MCP posture from fund_settings. The endpoint calls this AFTER
 * resolving the API key, so an invalid key still 401s and never learns whether
 * MCP is enabled. Off by default: a fresh deployment exposes no agent surface
 * until an admin flips `mcp_enabled` in Settings.
 */
export async function getMcpConfig(admin: SupabaseClient, fundId: string): Promise<McpConfig> {
  const { data } = await admin
    .from('fund_settings')
    .select('mcp_enabled, mcp_write_scopes, feature_visibility')
    .eq('fund_id', fundId)
    .maybeSingle()
  const row = (data ?? {}) as {
    mcp_enabled?: boolean
    mcp_write_scopes?: Record<string, boolean> | null
    feature_visibility?: Partial<FeatureVisibilityMap> | null
  }
  return {
    enabled: !!row.mcp_enabled,
    writeScopes: (row.mcp_write_scopes ?? {}) as Record<string, boolean>,
    // Matches how the app itself decides accounting is on (settings page gates
    // the ledger UI on feature_visibility.accounting !== 'off').
    accountingEnabled: row.feature_visibility?.accounting !== 'off',
  }
}

/**
 * Central authorization for one MCP tool call. Returns null if allowed, or a
 * human-readable reason string if denied. Enforces, in order:
 *   - admin-only READ tools require an admin key;
 *   - WRITE tools require: the fund enabled this tool's write category, the key
 *     owner is currently an admin, and the key carries the write scope.
 * This is the single choke point both tools/list (to filter) and tools/call
 * (to reject) run through, so the advertised surface always matches the callable
 * one.
 */
export function authorizeMcpTool(
  tool: { scope: 'read' | 'write'; admin?: boolean; writeCategory?: string },
  auth: { role: string; scopes: string[] },
  config: McpConfig
): string | null {
  if (tool.scope === 'read') {
    if (tool.admin && auth.role !== 'admin') return 'This tool requires an admin key.'
    return null
  }
  // write
  const category = tool.writeCategory ?? 'general'
  if (!config.writeScopes[category]) return `Writing "${category}" over MCP is turned off for this fund.`
  if (auth.role !== 'admin') return 'This key belongs to a non-admin; writing requires an admin.'
  if (!auth.scopes.includes('write')) return 'This key is read-only.'
  return null
}
