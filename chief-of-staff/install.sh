#!/usr/bin/env bash
#
# chief-of-staff/install.sh — met en place le chief of staff sur ce Mac.
#
#   ./install.sh                      espace de travail ~/chief-of-staff + hook SessionEnd
#   ./install.sh --workspace DIR      autre emplacement
#   ./install.sh --no-hook            sans le hook (si Claude Code n'est pas utilisé pour coder)
#
# Idempotent et prudent : config.md n'est jamais écrasé, settings.json est
# sauvegardé avant toute fusion, un hook SessionEnd existant est laissé tel quel.
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS="$HOME/chief-of-staff"
HOOK=1
while [ $# -gt 0 ]; do
  case "$1" in
    --workspace) WS="$2"; shift 2 ;;
    --no-hook)   HOOK=0; shift ;;
    *) echo "option inconnue: $1"; exit 2 ;;
  esac
done
STAMP="$(date +%Y%m%d-%H%M%S)"

say()  { printf "\n\033[1;34m▶ %s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
die()  { printf "\n  \033[31m✗ %s\033[0m\n" "$1" >&2; exit 1; }

command -v jq >/dev/null || die "jq est requis (brew install jq)"

# --- 1. espace de travail ----------------------------------------------------
say "Espace de travail : $WS"
mkdir -p "$WS/prompts" "$WS/tools" "$WS/state"
cp "$HERE/CLAUDE.md.template" "$WS/CLAUDE.md"
cp "$HERE"/prompts/*.md "$WS/prompts/"
cp "$HERE/tools/sessions.sh" "$WS/tools/" && chmod +x "$WS/tools/sessions.sh"
ok "CLAUDE.md, prompts/, tools/ installés"
if [ -f "$WS/config.md" ]; then
  ok "config.md existant conservé"
else
  cp "$HERE/config.example.md" "$WS/config.md"
  warn "config.md créé depuis l'exemple : à remplir avant la première session"
fi
[ -f "$WS/state/last-sync.json" ] || echo '{"last_sync": null, "projects": {}, "graph_index_node": null}' > "$WS/state/last-sync.json"
ok "state/last-sync.json prêt"

# --- 2. hook SessionEnd -------------------------------------------------------
if [ "$HOOK" = "1" ]; then
  say "Hook SessionEnd (Claude Code)"
  SETTINGS="$HOME/.claude/settings.json"
  mkdir -p "$HOME/.claude/chief-of-staff"
  [ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
  jq empty "$SETTINGS" 2>/dev/null || die "$SETTINGS n'est pas un JSON valide : à corriger d'abord (un fichier cassé désactive tous les réglages)"
  cp "$SETTINGS" "$SETTINGS.backup-$STAMP"
  if jq -e '.hooks.SessionEnd' "$SETTINGS" >/dev/null 2>&1; then
    warn "un hook SessionEnd existe déjà : laissé tel quel (comparer à la main avec hooks/session-end.json)"
  else
    jq --slurpfile h "$HERE/hooks/session-end.json" \
       '.hooks = ((.hooks // {}) + {SessionEnd: $h[0].hooks.SessionEnd})' \
       "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
    ok "hook fusionné ; hooks présents : $(jq -r '.hooks | keys | join(", ")' "$SETTINGS")"
  fi
  touch "$HOME/.claude/chief-of-staff/pending-sync.jsonl"
  ok "file d'attente : ~/.claude/chief-of-staff/pending-sync.jsonl"
  printf '%s' '{"session_id":"t","cwd":"/tmp/x","transcript_path":"/tmp/x.jsonl","reason":"test"}' \
    | jq -c '{ts: (now|todate), cwd: (.cwd // ""), project: ((.cwd // "") | split("/") | last), session_id: (.session_id // ""), transcript: (.transcript_path // ""), reason: (.reason // "")}' >/dev/null \
    && ok "commande du hook vérifiée"
else
  say "Hook SessionEnd : ignoré (--no-hook)"
fi

say "Terminé."
cat <<EOF

Prochaines étapes :
  1. Remplir $WS/config.md (projets, langue, hors périmètre).
  2. Vérifier que le connecteur Open Brain est branché dans Claude Code :  claude mcp list
  3. Lancer :  cd "$WS" && claude -n "chief of staff"
     puis dire « démarre » : le chief of staff lit la config, arme la synchro horaire et se présente.
  4. Chaque reprise de session : dire « démarre » à nouveau (le cron meurt avec la session).
EOF
