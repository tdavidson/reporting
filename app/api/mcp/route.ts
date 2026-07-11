import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveFundFromApiKey, getMcpConfig, authorizeMcpTool } from '@/lib/mcp/auth'
import { buildToolset, type McpTool, type McpToolContext } from '@/lib/mcp/tools'
import type { ResolvedKey } from '@/lib/mcp/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The platform's single MCP server, over Streamable HTTP in stateless JSON mode.
// One endpoint, one fund API key (Bearer token) — exposes the whole tool surface
// (portfolio + ledger) so any MCP client or the bundled CLI can drive a fund's
// data. Read-only unless an admin has opted specific write categories in.
// Implements initialize, ping, tools/list, tools/call.

const PROTOCOL_VERSION = '2024-11-05'
const SERVER_INFO = { name: 'reporting', version: '0.1.0' }

interface RpcRequest { jsonrpc: string; id?: string | number | null; method: string; params?: any }

function ok(id: any, result: any) {
  return { jsonrpc: '2.0', id, result }
}
function err(id: any, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function handle(
  rpc: RpcRequest,
  ctx: McpToolContext,
  auth: ResolvedKey,
  tools: McpTool[],
  config: Awaited<ReturnType<typeof getMcpConfig>>
): Promise<any | null> {
  switch (rpc.method) {
    case 'initialize':
      return ok(rpc.id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO })
    case 'ping':
      return ok(rpc.id, {})
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null // notification — no response
    case 'tools/list':
      // Advertise only the tools this key can actually call (admin-only reads and
      // ungranted write categories are hidden), so the surface never lies.
      return ok(rpc.id, {
        tools: tools
          .filter((t) => authorizeMcpTool(t, auth, config) === null)
          .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      })
    case 'tools/call': {
      const name = rpc.params?.name
      const tool = tools.find((t) => t.name === name)
      if (!tool) return err(rpc.id, -32602, `Unknown tool: ${name}`)
      const denied = authorizeMcpTool(tool, auth, config)
      if (denied) return ok(rpc.id, { content: [{ type: 'text', text: denied }], isError: true })
      try {
        const result = await tool.handler(ctx, rpc.params?.arguments ?? {})
        return ok(rpc.id, { content: [{ type: 'text', text: JSON.stringify(result) }] })
      } catch (e) {
        return ok(rpc.id, { content: [{ type: 'text', text: (e as Error).message }], isError: true })
      }
    }
    default:
      return err(rpc.id, -32601, `Method not found: ${rpc.method}`)
  }
}

export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const auth = await resolveFundFromApiKey(admin, req)
  if (!auth) {
    return NextResponse.json(err(null, -32001, 'Unauthorized — provide a valid fund API key as a Bearer token'), { status: 401 })
  }

  const config = await getMcpConfig(admin, auth.fundId)
  if (!config.enabled) {
    return NextResponse.json(
      err(null, -32002, 'The MCP server is turned off for this fund. An admin can enable it in Settings.'),
      { status: 403 }
    )
  }

  const tools = buildToolset(config)
  const ctx: McpToolContext = { admin, fundId: auth.fundId, userId: auth.userId, role: auth.role }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json(err(null, -32700, 'Parse error'), { status: 400 })

  // Support JSON-RPC batches.
  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map((r) => handle(r, ctx, auth, tools, config)))).filter(Boolean)
    return responses.length ? NextResponse.json(responses) : new NextResponse(null, { status: 202 })
  }

  const response = await handle(body, ctx, auth, tools, config)
  if (response === null) return new NextResponse(null, { status: 202 })
  return NextResponse.json(response)
}

export function GET() {
  // Streamable-HTTP SSE stream is not implemented; this server is stateless JSON.
  return NextResponse.json(
    { error: 'Use POST with JSON-RPC. This MCP server runs in stateless JSON mode.' },
    { status: 405 }
  )
}
