#!/usr/bin/env bash
# Inventory Claude Code conversations: date range, turn count, and the opening
# line of each — which is almost always the subject.
#
# The picker (`claude --resume`) lists sessions by UUID unless they were named,
# so a directory with a dozen conversations is unreadable. This prints what they
# are actually about.
#
#   ./tools/sessions.sh              # every project directory
#   ./tools/sessions.sh ~            # one directory, given as a real path
#   ./tools/sessions.sh --uuid ~     # same, with UUIDs for `claude --resume <uuid>`

set -euo pipefail

SHOW_UUID=0
[ "${1:-}" = "--uuid" ] && { SHOW_UUID=1; shift; }

command -v python3 >/dev/null || { echo "python3 required"; exit 1; }

if [ $# -ge 1 ]; then
  # Claude Code slugifies the project path: every non-alphanumeric byte -> '-'
  SLUG="$(printf '%s' "$(cd "$1" && pwd)" | sed 's/[^A-Za-z0-9]/-/g')"
  DIRS=("$HOME/.claude/projects/$SLUG")
  [ -d "${DIRS[0]}" ] || { echo "No conversations for $1"; echo "(looked for $SLUG)"; exit 0; }
else
  DIRS=("$HOME"/.claude/projects/*/)
fi

for d in "${DIRS[@]}"; do
  compgen -G "$d/*.jsonl" >/dev/null || continue
  SHOW_UUID=$SHOW_UUID python3 - "$d" <<'PY'
import json, os, pathlib, sys

d = pathlib.Path(sys.argv[1])
show_uuid = os.environ.get("SHOW_UUID") == "1"
rows, cwd = [], None

for f in sorted(d.glob("*.jsonl")):
    first = last = subj = None
    turns = 0
    for line in f.open(encoding="utf-8", errors="replace"):
        try:
            o = json.loads(line)
        except Exception:
            continue
        if o.get("timestamp"):
            first = first or o["timestamp"]
            last = o["timestamp"]
        cwd = cwd or o.get("cwd")
        if o.get("type") != "user":
            continue
        c = o.get("message", {}).get("content")
        if isinstance(c, str):
            t = c
        elif isinstance(c, list):
            t = " ".join(b.get("text", "") for b in c
                         if isinstance(b, dict) and b.get("type") == "text")
        else:
            t = ""
        t = t.strip()
        # Skip tool results and relayed cross-session messages: not what the
        # human actually typed, so a poor summary of the conversation.
        if not t or t.startswith("<") or "cross-session" in t[:40]:
            continue
        turns += 1
        if subj is None:
            subj = t.replace("\n", " ")
    rows.append((first or "", last or "", turns, subj or "(empty)", f.stem))

if not rows:
    sys.exit()

rows.sort(reverse=True)
print(f"\n{cwd or d.name}  —  {len(rows)} conversation(s)")
print(f"  resume with:  cd {cwd or '?'} && claude --resume")
print("  " + "-" * 96)
for fi, la, tn, su, uid in rows:
    span = fi[:10] if fi[:10] == la[:10] else f"{fi[:10]}→{la[:10]}"
    print(f"  {span:<23}{tn:>4} tours  {su[:58]}")
    if show_uuid:
        print(f"  {'':<23}{'':>4}        {uid}")
PY
done
