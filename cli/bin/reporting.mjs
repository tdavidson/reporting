#!/usr/bin/env node
// reporting-cli — connect any MCP client (Claude Desktop, Claude Code, Cursor)
// or your own scripts to a self-hosted fund reporting platform's MCP server.
//
// The platform speaks MCP over Streamable HTTP in stateless JSON mode at
// POST {url}/api/mcp, authenticated with a fund API key as a Bearer token.
// MCP clients, however, usually launch a local process and talk MCP over stdio.
// This CLI is that local process: `reporting-cli mcp` is a thin stdio<->HTTP
// bridge that forwards each JSON-RPC message to the remote endpoint. It holds no
// state and applies no logic of its own — the server owns the tool surface, auth,
// and the mcp_enabled gate — so it stays correct as the platform's tools evolve.
//
// It also exposes `tools` and `call` for quick shell/script use without an agent.
//
// Config resolution (first match wins), for both --url and the API key:
//   1. flags:   --url <u>   --key <k>
//   2. env:     REPORTING_URL          REPORTING_API_KEY
//   3. file:    ~/.config/reporting-cli/config.json  { "url": ..., "apiKey": ... }
// Save step 3 with:  reporting-cli config --url <u> --key <k>

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { createInterface } from 'node:readline'

const CONFIG_PATH = join(homedir(), '.config', 'reporting-cli', 'config.json')

// ---- config -------------------------------------------------------------

function readConfigFile() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return {}
  }
}

/** Resolve { url, apiKey } from flags > env > config file. */
function resolveConfig(flags) {
  const file = readConfigFile()
  const rawUrl = flags.url ?? process.env.REPORTING_URL ?? file.url ?? ''
  const url = rawUrl.replace(/\/+$/, '') // strip trailing slashes
  const apiKey = flags.key ?? process.env.REPORTING_API_KEY ?? file.apiKey ?? ''
  return { url, apiKey }
}

function requireConfig(cfg) {
  if (!cfg.url || !cfg.apiKey) {
    fail(
      'Missing platform URL or API key.\n' +
      'Pass --url and --key, set REPORTING_URL / REPORTING_API_KEY, or run:\n' +
      '  reporting-cli config --url https://your-platform.example.com --key lk_...'
    )
  }
  return cfg
}

// ---- HTTP transport -----------------------------------------------------

/**
 * POST a single JSON-RPC message (or batch) to the remote MCP endpoint.
 * Returns the parsed JSON response, or null for a 202 / empty body
 * (notifications), or throws on transport/HTTP error.
 */
async function postRpc(cfg, message) {
  const res = await fetch(`${cfg.url}/api/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(message),
  })
  if (res.status === 202) return null
  const text = await res.text()
  if (!text) return null
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 300)}`)
  }
  if (!res.ok && !json?.error && !Array.isArray(json)) {
    // Surface auth/gate failures (401 mcp disabled, etc.) as a JSON-RPC error.
    throw new Error(json?.error?.message || json?.error || `HTTP ${res.status}`)
  }
  return json
}

// ---- commands -----------------------------------------------------------

// `mcp` — stdio<->HTTP bridge. Reads newline-delimited JSON-RPC from stdin,
// forwards each to the platform, writes each response to stdout as one line.
async function cmdMcp(cfg) {
  requireConfig(cfg)
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let message
    try {
      message = JSON.parse(trimmed)
    } catch {
      // Not valid JSON — can't recover an id, so drop it (matches JSON-RPC
      // parse-error handling for framed transports).
      continue
    }
    try {
      const response = await postRpc(cfg, message)
      if (response !== null) process.stdout.write(JSON.stringify(response) + '\n')
    } catch (e) {
      // Reply with a JSON-RPC error for requests (those with an id) so the
      // client isn't left waiting; stay silent for notifications.
      const id = !Array.isArray(message) && message?.id != null ? message.id : null
      if (id !== null) {
        process.stdout.write(
          JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: String(e.message || e) } }) + '\n'
        )
      }
    }
  }
}

let rpcId = 0
async function rpc(cfg, method, params) {
  const response = await postRpc(cfg, { jsonrpc: '2.0', id: ++rpcId, method, params })
  if (response?.error) throw new Error(response.error.message || 'RPC error')
  return response?.result
}

// `tools` — list the tools the connected key can see.
async function cmdTools(cfg) {
  requireConfig(cfg)
  const result = await rpc(cfg, 'tools/list', {})
  const tools = result?.tools ?? []
  if (!tools.length) {
    console.log('No tools available (is the MCP server enabled for this fund?).')
    return
  }
  for (const t of tools) {
    console.log(`${t.name}\n    ${t.description ?? ''}\n`)
  }
  console.log(`${tools.length} tool(s).`)
}

// `call <tool> [jsonArgs]` — invoke one tool and print its result.
async function cmdCall(cfg, argv) {
  requireConfig(cfg)
  const name = argv[0]
  if (!name) fail('Usage: reporting-cli call <tool> [\'{"json":"args"}\']')
  let args = {}
  if (argv[1]) {
    try {
      args = JSON.parse(argv[1])
    } catch {
      fail('Arguments must be a single JSON object, e.g. \'{"limit":10}\'')
    }
  }
  const result = await rpc(cfg, 'tools/call', { name, arguments: args })
  const content = result?.content ?? []
  const text = content.map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n')
  // Tool results are JSON strings; pretty-print when possible.
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2))
  } catch {
    console.log(text)
  }
  if (result?.isError) process.exitCode = 1
}

// `config` — save url/key to the config file, or --show the resolved config.
function cmdConfig(flags) {
  if (flags.show) {
    const cfg = resolveConfig(flags)
    console.log(JSON.stringify({ url: cfg.url || '(unset)', apiKey: cfg.apiKey ? redact(cfg.apiKey) : '(unset)' }, null, 2))
    return
  }
  const existing = readConfigFile()
  const url = (flags.url ?? existing.url ?? '').replace(/\/+$/, '')
  const apiKey = flags.key ?? existing.apiKey ?? ''
  if (!url || !apiKey) fail('Provide both --url and --key to save a config.')
  mkdirSync(dirname(CONFIG_PATH), { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify({ url, apiKey }, null, 2) + '\n', { mode: 0o600 })
  console.log(`Saved ${CONFIG_PATH}`)
}

// ---- helpers ------------------------------------------------------------

function redact(key) {
  return key.length <= 12 ? key : `${key.slice(0, 11)}…`
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--show') flags.show = true
    else if (a === '--url') flags.url = argv[++i]
    else if (a === '--key') flags.key = argv[++i]
    else if (a === '-h' || a === '--help') flags.help = true
    else positional.push(a)
  }
  return { flags, positional }
}

const HELP = `reporting-cli — MCP bridge and client for a self-hosted fund reporting platform

USAGE
  reporting-cli <command> [options]

COMMANDS
  mcp                     Run the stdio<->HTTP MCP bridge (for MCP clients)
  tools                   List the tools your API key can see
  call <tool> [jsonArgs]  Invoke one tool, e.g. call list_companies '{"limit":10}'
  config [--show]         Save --url/--key to ~/.config/reporting-cli/config.json

OPTIONS
  --url <url>   Platform base URL     (or env REPORTING_URL)
  --key <key>   Fund API key (lk_...) (or env REPORTING_API_KEY)

MCP CLIENT SETUP (e.g. Claude Desktop)
  {
    "mcpServers": {
      "reporting": {
        "command": "npx",
        "args": ["-y", "reporting-cli", "mcp"],
        "env": {
          "REPORTING_URL": "https://your-platform.example.com",
          "REPORTING_API_KEY": "lk_your_key_here"
        }
      }
    }
  }

Create a key in the platform under Settings, after an admin enables the MCP server.
`

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2))
  const command = positional[0] ?? 'help'
  if (flags.help || command === 'help') {
    console.log(HELP)
    return
  }
  const cfg = resolveConfig(flags)
  switch (command) {
    case 'mcp':
      return cmdMcp(cfg)
    case 'tools':
      return cmdTools(cfg)
    case 'call':
      return cmdCall(cfg, positional.slice(1))
    case 'config':
      return cmdConfig(flags)
    default:
      fail(`Unknown command: ${command}\nRun \`reporting-cli help\` for usage.`)
  }
}

main().catch((e) => fail(String(e?.stack || e?.message || e)))
