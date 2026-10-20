#!/usr/bin/env bash
#
# bootstrap.sh — install the LOCAL part of the Open Brain kit on this Mac:
#   • the Claude Code session scanner (~/.open-brain/claude-code-capture)
#   • its launchd agent (runs every 2 h, and shortly after login)
#   • the import scripts (~/.open-brain/import)
#
# Idempotent: re-run it after pulling kit updates. It never touches your
# Supabase project — that part is `supabase db push` / `functions deploy`
# (see docs/install.md).
#
# Prerequisites: Node.js 20+ on PATH (e.g. `brew install node`).
#
set -euo pipefail
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAP="$HOME/.open-brain/claude-code-capture"
IMP="$HOME/.open-brain/import"
LABEL="com.openbrain.claude-code-scanner"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"

say()  { printf "\n\033[1;34m▶ %s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
die()  { printf "\n  \033[31m✗ %s\033[0m\n" "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "This installer targets macOS (launchd). On another OS, run scan-sessions.mjs from your own scheduler."

# --- 1. node ------------------------------------------------------------------
say "Node.js"
NODE="$(command -v node || true)"
[ -n "$NODE" ] && [ -x "$NODE" ] || die "node not found. Install it (https://nodejs.org or: brew install node) and re-run."
ok "node: $NODE ($("$NODE" -v))"

# --- 2. scripts ---------------------------------------------------------------
say "Scanner scripts → $CAP"
mkdir -p "$CAP/logs" "$IMP"
cp "$KIT"/local/claude-code-capture/*.mjs "$CAP/"
cp "$KIT"/local/import/*.mjs "$IMP/"
ok "scripts installed (scanner: $CAP, import: $IMP)"

# --- 3. config ----------------------------------------------------------------
say "Config ($CAP/.env.local)"
if [ ! -f "$CAP/.env.local" ]; then
  cp "$KIT/local/claude-code-capture/.env.example" "$CAP/.env.local"
  chmod 600 "$CAP/.env.local"
  warn "created from the example — open it and fill in SUPABASE_URL and MCP_ACCESS_KEY:"
  warn "    open -e \"$CAP/.env.local\""
  warn "then re-run ./bootstrap.sh"
  exit 0
fi
if grep -qE "YOUR_PROJECT_REF|replace-with-your-brain-key" "$CAP/.env.local"; then
  die "$CAP/.env.local still contains placeholder values. Fill in SUPABASE_URL and MCP_ACCESS_KEY, then re-run."
fi
ok "config present"

# --- 4. launchd agent ---------------------------------------------------------
say "launchd agent ($LABEL, every 2 h)"
sed -e "s|__HOME__|$HOME|g" -e "s|__NODE__|$NODE|g" \
    "$KIT/local/claude-code-capture/com.openbrain.claude-code-scanner.plist.template" > "$PLIST_DST"
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load   "$PLIST_DST" || die "launchctl load failed for $PLIST_DST"
ok "agent loaded"

# --- 5. real check: launchctl load succeeds even when node/.env are wrong -----
say "Verification (forced run)"
launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || true
sleep 6
RC="$(launchctl list | awk -v l="$LABEL" '$3 == l { print $2 }')"
case "${RC:-absent}" in
  0)      ok "scanner ran successfully (exit 0)" ;;
  absent) warn "agent not visible in launchctl list — check manually with: launchctl list | grep openbrain" ;;
  78)     die "exit 78 (EX_CONFIG): scanner cannot start. Bad node path or .env.local. Logs: $CAP/logs/" ;;
  *)      die "scanner exited with $RC. Logs: $CAP/logs/launchd.err.log" ;;
esac

say "Done."
cat <<EOF

The scanner now captures every finished Claude Code session (idle ≥ 2 h, ≥ 3 human turns)
into your Open Brain, every 2 hours and after each login.

Useful commands:
  node $CAP/scan-sessions.mjs                 # dry run: what would be captured
  node $CAP/backfill-history.mjs              # dry run: past sessions (see header for --apply)
  node $IMP/import-claude-export.mjs <folder>  # import a Claude.ai data export
  tail -f $CAP/logs/scanner.log
EOF
