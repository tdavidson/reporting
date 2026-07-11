import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Serves an origin-aware installer for reporting-cli, so every deployment (and
// every fork) hosts its own: `curl -fsSL https://your-domain/install.sh | sh`.
// The script downloads the CLI from THIS deployment (/cli/reporting.mjs), not
// from any upstream repo — nothing is hardcoded to a particular GitHub owner.

function originOf(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  return host ? `${proto}://${host}` : req.nextUrl.origin
}

export function GET(req: NextRequest) {
  const origin = originOf(req)
  // Only `${origin}` is interpolated by JS; shell `${...}` is escaped as `\${`.
  const script = `#!/bin/sh
# Install reporting-cli from ${origin}. The CLI is a single zero-dependency Node
# script (Node 18+): this downloads it, marks it executable, and puts it on PATH.
#   curl -fsSL ${origin}/install.sh | sh
# Override the install prefix with PREFIX=/usr/local (default: \${HOME}/.local).
set -eu

PREFIX="\${PREFIX:-$HOME/.local}"
BIN_DIR="$PREFIX/bin"
DEST="$BIN_DIR/reporting-cli"
SRC="${origin}/cli/reporting.mjs"

if ! command -v node >/dev/null 2>&1; then
  echo "reporting-cli needs Node.js 18+ on your PATH. Install Node, then re-run." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "reporting-cli needs Node.js 18+ (found $(node -v))." >&2
  exit 1
fi

echo "Downloading reporting-cli -> $DEST"
mkdir -p "$BIN_DIR"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$SRC" -o "$DEST"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$DEST" "$SRC"
else
  echo "Need curl or wget to download." >&2
  exit 1
fi
chmod +x "$DEST"

echo "Installed reporting-cli to $DEST"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Note: $BIN_DIR is not on your PATH — add it before using reporting-cli." ;;
esac
echo "Next: reporting-cli auth login --url ${origin} --key lk_..."
`

  return new NextResponse(script, {
    status: 200,
    headers: {
      'content-type': 'text/x-shellscript; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  })
}
