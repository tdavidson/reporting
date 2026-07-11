#!/bin/sh
# Install reporting-cli — the MCP bridge/client for a self-hosted fund reporting
# platform. The CLI is a single zero-dependency Node script, so installing it is
# just: download the file, mark it executable, drop it on your PATH.
#
#   curl -fsSL https://raw.githubusercontent.com/tdavidson/reporting/main/cli/install.sh | sh
#
# Overrides (environment):
#   PREFIX             install prefix (default: $HOME/.local) -> $PREFIX/bin/reporting-cli
#   REPORTING_CLI_REF  git ref/tag to install from (default: main)
set -eu

REPO="tdavidson/reporting"
REF="${REPORTING_CLI_REF:-main}"
PREFIX="${PREFIX:-$HOME/.local}"
BIN_DIR="$PREFIX/bin"
DEST="$BIN_DIR/reporting-cli"
SRC="https://raw.githubusercontent.com/$REPO/$REF/cli/bin/reporting.mjs"

# Node 18+ is required (the CLI uses global fetch and modern ESM).
if ! command -v node >/dev/null 2>&1; then
  echo "reporting-cli needs Node.js 18+ on your PATH. Install Node, then re-run." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "reporting-cli needs Node.js 18+ (found $(node -v))." >&2
  exit 1
fi

echo "Downloading reporting-cli ($REF) -> $DEST"
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
  *) echo "Note: $BIN_DIR is not on your PATH. Add it, e.g.:"
     echo "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.profile && . ~/.profile" ;;
esac
echo "Next: reporting-cli auth login"
