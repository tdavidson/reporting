# reporting-cli

Connect AI agents — Claude Desktop, Claude Code, Cursor, or any
[MCP](https://modelcontextprotocol.io) client — to a self-hosted deployment of
the fund reporting platform, authenticated with a fund API key. Built for agents
first; also works as a plain command-line client for scripts.

The platform exposes an MCP server over Streamable HTTP at `POST /api/mcp`. Most
MCP clients launch a local command and speak MCP over stdio, so `reporting-cli
mcp` bridges stdio to the remote HTTP endpoint. It's a thin, stateless proxy —
the server owns the tools, the auth, and the on/off switch — so it keeps working
as the platform's tool surface grows.

The CLI is a single zero-dependency Node script (Node 18+). It is **not published
to npm**; install it from this repo.

## Prerequisites

1. An admin enables the MCP server for your fund: **Settings → Agent access →
   Enable MCP server**. Until then, `/api/mcp` rejects every request.
2. You create a fund API key on that same screen. Copy it — it's shown once.
   Keys act as you: any member's key can read; write tools require an admin's key
   and an admin-enabled write capability.

## Install

Every deployment serves its own installer and its own copy of the CLI, so this
works against any instance (including your own fork) with nothing hardcoded:

```bash
curl -fsSL https://YOUR-DEPLOYMENT/install.sh | sh
```

Installs to `~/.local/bin/reporting-cli` (override with `PREFIX=/usr/local`).
Prefer to inspect first? The installer just downloads
`https://YOUR-DEPLOYMENT/cli/reporting.mjs`, `chmod +x`, and drops it on your
PATH — you can do that by hand. (`YOUR-DEPLOYMENT` is wherever the platform is
hosted, e.g. `https://portfolio.acme.com`.)

## Authenticate

```bash
reporting-cli auth login          # prompts for URL + key, validates, stores them
reporting-cli auth login --url https://your-domain --key lk_...   # non-interactive
echo "lk_..." | reporting-cli auth login --url https://your-domain --with-token
reporting-cli auth status         # show the stored credential and check it
reporting-cli auth logout         # remove it
```

Credentials are stored in `~/.config/reporting-cli/config.json` (mode 0600). You
can also skip login and pass `REPORTING_URL` / `REPORTING_API_KEY` in the
environment — handy for CI or an agent's process env.

## Use as an MCP server

After `auth login`, point any MCP client at the `mcp` subcommand. For Claude
Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "reporting": {
      "command": "reporting-cli",
      "args": ["mcp"]
    }
  }
}
```

If you'd rather not rely on the stored config, pass the credential in `env`
instead:

```json
{
  "mcpServers": {
    "reporting": {
      "command": "reporting-cli",
      "args": ["mcp"],
      "env": { "REPORTING_URL": "https://your-domain", "REPORTING_API_KEY": "lk_..." }
    }
  }
}
```

Restart the client and your fund's tools appear.

## Use from the shell

```bash
reporting-cli tools                              # list available tools
reporting-cli call list_companies '{"limit":10}' # invoke a tool
```

## Commands

| Command | Description |
| --- | --- |
| `auth login` | Validate a fund API key and store it (interactive, `--url`/`--key`, or `--with-token`). |
| `auth status` | Show the stored credential and check it against the server. |
| `auth logout` | Remove the stored credential. |
| `mcp` | Run the stdio↔HTTP MCP bridge (for MCP clients). |
| `tools` | List the tools your API key can see. |
| `call <tool> [jsonArgs]` | Invoke one tool with a JSON argument object. |

## Security

- Your key is a bearer credential — treat it like a password. Revoke it anytime
  in Settings; revocation and any change to your fund role take effect on the
  next call.
- The CLI stores nothing beyond the config file you create, and sends requests
  only to the URL you configure.

Apache-2.0, part of the fund reporting platform.
