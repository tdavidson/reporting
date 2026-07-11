#!/usr/bin/env node
// reporting-cli — connect AI agents to a self-hosted fund reporting platform's
// MCP server. Built for agents first: `reporting-cli mcp` is a thin stdio<->HTTP
// bridge that any MCP client (Claude Desktop, Claude Code, Cursor) launches to
// reach the deployment's HTTP MCP endpoint. `tools` / `call` are there for quick
// scripting. It holds no state and applies no logic of its own — the server owns
// the tool surface, auth, and the mcp_enabled gate.
//
// A person authenticates once with `reporting-cli auth login` (validates the key
// and stores it); the agent then reuses the stored credential. Config resolution
// (first match wins), for both the URL and the key:
//   1. flags:   --url <u>   --key <k>
//   2. env:     REPORTING_URL          REPORTING_API_KEY
//   3. file:    ~/.config/reporting-cli/config.json  { "url": ..., "apiKey": ... }

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
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

function writeConfigFile(url, apiKey) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify({ url, apiKey }, null, 2) + '\n', { mode: 0o600 })
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
      'Not authenticated. Run `reporting-cli auth login`, or pass --url/--key,\n' +
      'or set REPORTING_URL / REPORTING_API_KEY.'
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
    throw new Error(json?.error?.message || json?.error || `HTTP ${res.status}`)
  }
  return json
}

/**
 * Check a credential against the server. Returns:
 *   { status, tools }  on 200 (key valid, MCP enabled)
 *   { status, error }  otherwise (401 = bad key; 403 = key valid but MCP off)
 */
async function probe(cfg) {
  let res
  try {
    res = await fetch(`${cfg.url}/api/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
  } catch (e) {
    return { status: 0, error: `Could not reach ${cfg.url} (${e.message})` }
  }
  let json = null
  try { json = await res.json() } catch { /* ignore */ }
  if (res.status === 200 && json?.result) return { status: 200, tools: json.result.tools?.length ?? 0 }
  return { status: res.status, error: json?.error?.message || json?.error || `HTTP ${res.status}` }
}

// ---- auth commands ------------------------------------------------------

async function cmdAuthLogin(flags, positional) {
  let url = flags.url ?? process.env.REPORTING_URL ?? readConfigFile().url ?? ''
  let key = flags.key ?? process.env.REPORTING_API_KEY ?? ''

  // `--with-token` reads the key from stdin (for CI / non-interactive setup).
  if (flags.withToken) key = (await readStdin()).trim()

  const interactive = process.stdin.isTTY && !flags.withToken
  if (!url) url = interactive ? await ask('Platform URL: ') : url
  if (!key) key = interactive ? await ask('Fund API key (lk_...): ') : key

  url = String(url).trim().replace(/\/+$/, '')
  key = String(key).trim()
  if (!url || !key) {
    fail('Need a platform URL and an API key. Pass --url/--key, pipe --with-token, or run interactively.')
  }

  const r = await probe({ url, apiKey: key })
  if (r.status === 401) fail(`That key was rejected by ${url}. Check the key and try again.`)
  writeConfigFile(url, key)
  if (r.status === 200) console.log(`Logged in to ${url}. ${r.tools} tool(s) available. Saved ${CONFIG_PATH}`)
  else if (r.status === 403) console.log(`Key saved for ${url}, but the MCP server is turned off — an admin can enable it in Settings. Saved ${CONFIG_PATH}`)
  else console.log(`Key saved for ${url} (server said: ${r.error}). Saved ${CONFIG_PATH}`)
}

async function cmdAuthStatus(flags) {
  const cfg = resolveConfig(flags)
  if (!cfg.url || !cfg.apiKey) {
    console.log('Not authenticated. Run `reporting-cli auth login`.')
    return
  }
  console.log(`URL:  ${cfg.url}`)
  console.log(`Key:  ${redact(cfg.apiKey)}`)
  const r = await probe(cfg)
  if (r.status === 200) console.log(`State: ok — ${r.tools} tool(s) available.`)
  else if (r.status === 401) console.log('State: key rejected (401). Re-run `auth login`.')
  else if (r.status === 403) console.log('State: key valid, but the MCP server is off for this fund.')
  else console.log(`State: ${r.error}`)
}

function cmdAuthLogout() {
  try {
    rmSync(CONFIG_PATH)
    console.log(`Removed ${CONFIG_PATH}`)
  } catch {
    console.log('Nothing to remove.')
  }
}

// ---- mcp / tools / call -------------------------------------------------

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
      continue // unrecoverable (no id) — drop, matching framed-transport parse handling
    }
    try {
      const response = await postRpc(cfg, message)
      if (response !== null) process.stdout.write(JSON.stringify(response) + '\n')
    } catch (e) {
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

async function cmdTools(cfg) {
  requireConfig(cfg)
  const result = await rpc(cfg, 'tools/list', {})
  const tools = result?.tools ?? []
  if (!tools.length) {
    console.log('No tools available (is the MCP server enabled for this fund?).')
    return
  }
  for (const t of tools) console.log(`${t.name}\n    ${t.description ?? ''}\n`)
  console.log(`${tools.length} tool(s).`)
}

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
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2))
  } catch {
    console.log(text)
  }
  if (result?.isError) process.exitCode = 1
}

// ---- helpers ------------------------------------------------------------

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a) }))
}

async function readStdin() {
  let data = ''
  for await (const chunk of process.stdin) data += chunk
  return data
}

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
    if (a === '--with-token') flags.withToken = true
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
  auth login              Validate a fund API key and store it (interactive,
                          or --url/--key, or --with-token to read the key from stdin)
  auth status             Show the stored credential and check it against the server
  auth logout             Remove the stored credential
  mcp                     Run the stdio<->HTTP MCP bridge (for MCP clients)
  tools                   List the tools your API key can see
  call <tool> [jsonArgs]  Invoke one tool, e.g. call list_companies '{"limit":10}'

OPTIONS
  --url <url>   Platform base URL     (or env REPORTING_URL)
  --key <key>   Fund API key (lk_...) (or env REPORTING_API_KEY)

MCP CLIENT SETUP (e.g. Claude Desktop) — after \`reporting-cli auth login\`:
  {
    "mcpServers": {
      "reporting": { "command": "reporting-cli", "args": ["mcp"] }
    }
  }

Create a key in the platform under Settings → Agent access (an admin enables the
MCP server there first).
`

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2))
  const command = positional[0] ?? 'help'
  if (flags.help || command === 'help') {
    console.log(HELP)
    return
  }
  // auth subcommands
  if (command === 'auth') {
    const sub = positional[1] ?? 'status'
    if (sub === 'login') return cmdAuthLogin(flags, positional.slice(2))
    if (sub === 'status') return cmdAuthStatus(flags)
    if (sub === 'logout') return cmdAuthLogout()
    fail(`Unknown auth subcommand: ${sub} (login | status | logout)`)
  }
  const cfg = resolveConfig(flags)
  switch (command) {
    case 'mcp':
      return cmdMcp(cfg)
    case 'tools':
      return cmdTools(cfg)
    case 'call':
      return cmdCall(cfg, positional.slice(1))
    default:
      fail(`Unknown command: ${command}\nRun \`reporting-cli help\` for usage.`)
  }
}

main().catch((e) => fail(String(e?.stack || e?.message || e)))
