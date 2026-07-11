# reporting-cli

Connect your own AI agents — Claude Desktop, Claude Code, Cursor, or any
[MCP](https://modelcontextprotocol.io) client — to a self-hosted deployment of
the fund reporting platform, authenticated with a fund API key. Also works as a
plain command-line client for scripts.

The platform exposes an MCP server over Streamable HTTP at `POST /api/mcp`. Most
MCP clients, though, launch a local command and speak MCP over stdio. This CLI is
that local command: `reporting-cli mcp` bridges stdio to the remote HTTP
endpoint. It's a thin, stateless proxy — the server owns the tools, the auth, and
the on/off switch — so it keeps working as the platform's tool surface grows.

## Prerequisites

1. An admin enables the MCP server for your fund: **Settings → Agent access →
   Enable MCP server**. Until then, `/api/mcp` rejects every request.
2. You create a fund API key on that same screen. Copy it — it's shown once.
   Keys act as you: any member's key can read; write tools require an admin's key.

## Install

Requires Node.js 18+. Run without installing:

```bash
npx -y reporting-cli help
```

## Configure

Provide the platform URL and your API key by flag, environment, or a saved file
(checked in that order):

```bash
# Save once (writes ~/.config/reporting-cli/config.json, mode 0600)
npx reporting-cli config --url https://your-platform.example.com --key lk_your_key

# ...or per-invocation
REPORTING_URL=https://your-platform.example.com REPORTING_API_KEY=lk_... npx reporting-cli tools
```

## Use as an MCP server

Point any MCP client at the `mcp` subcommand. For Claude Desktop, add to
`claude_desktop_config.json`:

```json
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
```

Restart the client and your fund's tools appear.

## Use from the shell

```bash
reporting-cli tools                              # list available tools
reporting-cli call list_companies '{"limit":10}' # invoke a tool
reporting-cli config --show                       # show resolved config (key redacted)
```

## Commands

| Command | Description |
| --- | --- |
| `mcp` | Run the stdio↔HTTP MCP bridge (for MCP clients). |
| `tools` | List the tools your API key can see. |
| `call <tool> [jsonArgs]` | Invoke one tool with a JSON argument object. |
| `config [--show]` | Save `--url`/`--key`, or print the resolved config. |

## Security

- Your key is a bearer credential — treat it like a password. Revoke it anytime
  in Settings; revocation and any change to your fund role take effect on the
  next call.
- The CLI stores nothing beyond the optional config file you create, and sends
  requests only to the URL you configure.

Apache-2.0, part of the fund reporting platform.
