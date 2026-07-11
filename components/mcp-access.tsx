'use client'

import { useEffect, useState } from 'react'
import { Loader2, Copy, Check, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { PLATFORM_TOOL_MANIFEST, MCP_WRITE_CATEGORIES } from '@/lib/mcp/tools-manifest'
import { AGENT_TOOL_MANIFEST } from '@/lib/accounting/agent-tools-manifest'

interface Key { id: string; name: string; key_prefix: string; scopes: string; last_used_at: string | null; revoked_at: string | null; created_at: string }

/**
 * Agent access (MCP + CLI). One authenticated endpoint (`/api/mcp`) exposes the
 * fund's tools to any MCP client or the bundled CLI. Off by default; an admin
 * turns the server on and opts specific write categories in. Keys are per-user
 * and act as their owner.
 */
export function McpAccess({
  isAdmin,
  mcpEnabled,
  writeScopes,
  accountingEnabled,
}: {
  isAdmin: boolean
  mcpEnabled: boolean
  writeScopes: Record<string, boolean>
  accountingEnabled: boolean
}) {
  const [enabled, setEnabled] = useState(mcpEnabled)
  const [scopes, setScopes] = useState<Record<string, boolean>>(writeScopes ?? {})
  const [savingToggle, setSavingToggle] = useState(false)

  const [keys, setKeys] = useState<Key[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [origin, setOrigin] = useState('')
  const [showTools, setShowTools] = useState(false)

  useEffect(() => { setOrigin(window.location.origin); load() }, [])
  const mcpUrl = origin ? `${origin}/api/mcp` : ''

  function load() {
    setLoading(true)
    fetch('/api/settings/api-keys').then(r => (r.ok ? r.json() : [])).then(d => setKeys(Array.isArray(d) ? d : [])).finally(() => setLoading(false))
  }

  async function patch(body: Record<string, unknown>) {
    setSavingToggle(true)
    await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setSavingToggle(false)
  }

  async function toggleServer(checked: boolean) {
    setEnabled(checked)
    await patch({ mcpEnabled: checked })
  }

  async function toggleScope(key: string, checked: boolean) {
    const next = { ...scopes, [key]: checked }
    setScopes(next)
    await patch({ mcpWriteScopes: next })
  }

  async function create() {
    if (!name.trim()) return
    setCreating(true); setNewToken(null)
    const res = await fetch('/api/settings/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, readOnly }) })
    const data = await res.json()
    if (res.ok) { setNewToken(data.token); setName(''); load() }
    setCreating(false)
  }

  async function revoke(id: string) {
    await fetch(`/api/settings/api-keys?id=${id}`, { method: 'DELETE' })
    load()
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(null), 1500)
  }

  const active = keys.filter(k => !k.revoked_at)
  const categories = MCP_WRITE_CATEGORIES.filter(c => !c.accountingOnly || accountingEnabled)
  const tools = [
    ...PLATFORM_TOOL_MANIFEST.map(t => ({ name: t.name, description: t.description, scope: t.scope, admin: !!t.admin })),
    ...(accountingEnabled ? AGENT_TOOL_MANIFEST.map(t => ({ name: t.name, description: t.description, scope: t.scope, admin: false })) : []),
  ]

  const cliSnippet = `{
  "mcpServers": {
    "reporting": {
      "command": "reporting-cli",
      "args": ["mcp"]
    }
  }
}`

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        Expose this fund&rsquo;s data to your own AI agents over{' '}
        <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer" className="underline underline-offset-2">MCP</a>{' '}
        — from Claude Desktop, Claude Code, Cursor, or the bundled command-line tool — authenticated with a fund API key.
        The server is <strong>read-only</strong> until an admin turns on specific write capabilities below.
      </p>

      {/* Server on/off (admin) */}
      <div className="flex items-center gap-3">
        <Switch checked={enabled} onCheckedChange={toggleServer} disabled={!isAdmin || savingToggle} />
        <Label className="text-sm font-normal">Enable the MCP server for this fund</Label>
        {savingToggle && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </div>
      {!isAdmin && <p className="text-[11px] text-muted-foreground -mt-2">Only an admin can turn the server on or change write access.</p>}

      {enabled && (
        <>
          {/* Write capabilities (admin) */}
          <div className="space-y-2">
            <p className="text-xs font-medium">Write access {isAdmin ? '' : '(admin-controlled)'}</p>
            <p className="text-[11px] text-muted-foreground">
              Each capability is off by default. When on, an admin&rsquo;s write-scoped key may perform that action over MCP — useful for driving your data with your own agent or the CLI.
            </p>
            <div className="space-y-1.5">
              {categories.map(c => (
                <div key={c.key} className="flex items-center gap-3">
                  <Switch checked={!!scopes[c.key]} onCheckedChange={v => toggleScope(c.key, v)} disabled={!isAdmin || savingToggle} />
                  <span className="text-sm">{c.label}</span>
                  <span className="text-[11px] text-muted-foreground">{c.description}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Endpoint */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground w-12 shrink-0 text-xs">MCP</span>
            <code className="flex-1 bg-muted rounded px-2 py-1 text-xs font-mono truncate">{mcpUrl || '…'}</code>
            <button onClick={() => copy(mcpUrl, 'mcp')} className="text-muted-foreground hover:text-foreground">{copied === 'mcp' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}</button>
          </div>

          {/* Keys */}
          {newToken && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="text-amber-700 dark:text-amber-400 mb-1">Copy this token now — it won&rsquo;t be shown again.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-background rounded px-2 py-1 text-xs font-mono truncate">{newToken}</code>
                <button onClick={() => copy(newToken, 'token')} className="text-muted-foreground hover:text-foreground">{copied === 'token' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}</button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium">Your API keys</p>
            <p className="text-[11px] text-muted-foreground">
              Keys act as you: {isAdmin ? 'as an admin, a write-scoped key can use enabled write tools; read tools always work.' : 'your keys can use read tools; writing requires an admin.'}
            </p>
            <div className="flex items-center gap-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Key name (e.g. Claude agent)" className="border rounded px-2 py-1.5 text-sm flex-1 bg-transparent" />
              {isAdmin && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={readOnly} onChange={e => setReadOnly(e.target.checked)} />read-only</label>
              )}
              <Button size="sm" onClick={create} disabled={creating || !name.trim()}>{creating && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Create key</Button>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
            ) : active.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active keys.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {active.map(k => (
                    <tr key={k.id} className="border-t">
                      <td className="py-1.5">{k.name}</td>
                      <td className="py-1.5 font-mono text-xs text-muted-foreground">{k.key_prefix}…</td>
                      <td className="py-1.5 text-xs text-muted-foreground">{k.scopes}</td>
                      <td className="py-1.5 text-xs text-muted-foreground">{k.last_used_at ? 'used' : 'unused'}</td>
                      <td className="py-1.5 text-right"><button onClick={() => revoke(k.id)} className="text-muted-foreground hover:text-red-600" title="Revoke"><Trash2 className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* CLI setup */}
          <div className="space-y-2">
            <p className="text-xs font-medium">Connect a client (e.g. Claude Desktop)</p>
            <p className="text-[11px] text-muted-foreground">
              Install the CLI, then log in once with a key:
            </p>
            <pre className="bg-muted rounded p-3 text-[11px] font-mono overflow-x-auto">{`curl -fsSL ${origin || 'https://your-domain'}/install.sh | sh
reporting-cli auth login --url ${origin || 'https://your-domain'} --key lk_…`}</pre>
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">Then point your MCP client at it:</p>
              <button onClick={() => copy(cliSnippet, 'cli')} className="text-muted-foreground hover:text-foreground text-xs flex items-center gap-1">{copied === 'cli' ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}copy</button>
            </div>
            <pre className="bg-muted rounded p-3 text-[11px] font-mono overflow-x-auto">{cliSnippet}</pre>
          </div>

          {/* Tools */}
          <button onClick={() => setShowTools(v => !v)} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
            {showTools ? 'Hide' : 'Show'} available tools ({tools.length})
          </button>
          {showTools && (
            <div className="space-y-1.5">
              {tools.map(t => (
                <div key={t.name} className="text-sm flex gap-2">
                  <code className="text-xs bg-muted rounded px-1.5 py-0.5 font-mono shrink-0">{t.name}</code>
                  <span className={`text-[10px] uppercase tracking-wider px-1 py-0.5 rounded self-center shrink-0 ${t.scope === 'write' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-muted text-muted-foreground'}`}>{t.scope}{t.admin ? ' · admin' : ''}</span>
                  <span className="text-muted-foreground text-xs self-center">{t.description}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
