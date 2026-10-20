#!/usr/bin/env bash
#
# scripts/sync-upstream.sh — refresh upstream/ from NateBJones-Projects/OB1 and
# merge upstream changes (e.g. security patches) into the kit's working copies.
#
# How it works
#   upstream/            pristine copies of the OB1 paths the kit uses, never edited.
#   working copies       supabase/functions/*, chrome-capture-extension/, LICENSE.md.
#                        Some carry local patches (see UPSTREAM.md).
#   This script fetches the chosen OB1 ref, diffs it against upstream/, and for
#   each mapped file does a 3-way merge: base = old upstream, theirs = new
#   upstream, mine = the kit's working copy. Files without local patches are
#   simply replaced; patched files keep their patch; real conflicts are left
#   with <<<<<<< markers for you to resolve.
#   Migrations are NEVER rewritten (an applied migration must not change):
#   schema changes are only reported, so you can write a new migration.
#
# Usage
#   scripts/sync-upstream.sh            dry run: fetch and show what changed
#   scripts/sync-upstream.sh --apply    update upstream/ and merge into the kit
#   OB1_REF=<branch|tag|sha>  (default main)
#   OB1_REPO=<git url or local path>  (default https://github.com/NateBJones-Projects/OB1.git)
#
set -euo pipefail
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UP="$KIT/upstream"
REF="${OB1_REF:-main}"
REPO="${OB1_REPO:-https://github.com/NateBJones-Projects/OB1.git}"
APPLY=false; [ "${1:-}" = "--apply" ] && APPLY=true

# OB1 paths vendored into upstream/ (reference + merge base)
PATHS=(
  LICENSE.md
  server
  schemas/enhanced-thoughts
  schemas/workflow-status
  recipes/ob-graph
  integrations/chrome-capture-extension
  integrations/open-brain-rest
  docs/01-getting-started.md
  docs/03-faq.md
  docs/04-ai-assisted-setup.md
)
# upstream path : kit working copy  (merged)
MAP=(
  "LICENSE.md:LICENSE.md"
  "server/index.ts:supabase/functions/open-brain-mcp/index.ts"
  "server/deno.json:supabase/functions/open-brain-mcp/deno.json"
  "recipes/ob-graph/index.ts:supabase/functions/ob-graph-mcp/index.ts"
  "recipes/ob-graph/deno.json:supabase/functions/ob-graph-mcp/deno.json"
  "integrations/open-brain-rest/index.ts:supabase/functions/open-brain-rest/index.ts"
  "integrations/open-brain-rest/deno.json:supabase/functions/open-brain-rest/deno.json"
)
# upstream schema : migration already applied by users  (reported only)
MIGRATIONS=(
  "schemas/enhanced-thoughts/schema.sql:supabase/migrations/20260627140000_enhanced_thoughts.sql"
  "schemas/workflow-status/migration.sql:supabase/migrations/20260627140100_workflow_status.sql"
  "recipes/ob-graph/schema.sql:supabase/migrations/20260628190000_ob_graph.sql"
)
EXT_SRC="integrations/chrome-capture-extension"
EXT_DST="chrome-capture-extension"

OLD_SHA="$(grep -E '^Commit: ' "$KIT/UPSTREAM.md" | awk '{print $2}')"
[ -n "$OLD_SHA" ] || { echo "Cannot read 'Commit:' line from UPSTREAM.md"; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git init -q "$TMP/repo"
git -C "$TMP/repo" remote add origin "$REPO"
git -C "$TMP/repo" fetch -q --depth 1 origin "$REF"
NEW_SHA="$(git -C "$TMP/repo" rev-parse FETCH_HEAD)"
mkdir -p "$TMP/new"
git -C "$TMP/repo" archive FETCH_HEAD -- "${PATHS[@]}" | tar -x -C "$TMP/new"
find "$TMP/new" -name .DS_Store -delete

if [ "$NEW_SHA" = "$OLD_SHA" ]; then
  echo "upstream unchanged (${OLD_SHA:0:12}). Nothing to do."
  exit 0
fi
echo "upstream: ${OLD_SHA:0:12} -> ${NEW_SHA:0:12}"
echo
echo "Changed upstream files:"
diff -rq "$UP" "$TMP/new" | sed -e "s|$UP/||" -e "s|$TMP/new/||" -e 's/^/  /' || true
DIFF_FILE="$KIT/upstream-${OLD_SHA:0:7}..${NEW_SHA:0:7}.diff"
diff -ru "$UP" "$TMP/new" > "$DIFF_FILE" || true
echo
echo "Full diff written to: ${DIFF_FILE#$KIT/}"

if ! $APPLY; then
  echo
  echo "Dry run. Re-run with --apply to update upstream/ and merge into the kit."
  exit 0
fi

CONFLICTS=0
merge_one() { # $1 = upstream relative path, $2 = kit relative path
  local old="$UP/$1" new="$TMP/new/$1" mine="$KIT/$2"
  if [ ! -f "$new" ]; then
    [ -f "$old" ] && echo "  removed upstream: $1  (kit keeps $2 — delete it yourself if appropriate)"
    return
  fi
  if [ ! -f "$old" ]; then
    mkdir -p "$(dirname "$mine")"; cp "$new" "$mine"; echo "  added:   $2"; return
  fi
  cmp -s "$old" "$new" && return                       # unchanged upstream
  if [ ! -f "$mine" ] || cmp -s "$old" "$mine"; then   # no local patch
    mkdir -p "$(dirname "$mine")"; cp "$new" "$mine"; echo "  updated: $2"; return
  fi
  if git merge-file -L "kit (local patch)" -L "old upstream" -L "new upstream" "$mine" "$old" "$new"; then
    echo "  merged:  $2  (local patch kept)"
  else
    echo "  CONFLICT: $2  — resolve the <<<<<<< markers"
    CONFLICTS=$((CONFLICTS + 1))
  fi
}

echo
echo "Merging into kit working copies:"
for m in "${MAP[@]}"; do merge_one "${m%%:*}" "${m#*:}"; done
while IFS= read -r f; do
  rel="${f#$TMP/new/$EXT_SRC/}"
  merge_one "$EXT_SRC/$rel" "$EXT_DST/$rel"
done < <(find "$TMP/new/$EXT_SRC" -type f | sort)

for m in "${MIGRATIONS[@]}"; do
  if ! cmp -s "$UP/${m%%:*}" "$TMP/new/${m%%:*}"; then
    echo "  SCHEMA CHANGED upstream: ${m%%:*}"
    echo "           -> do NOT edit ${m#*:} (already applied on live brains);"
    echo "              write a NEW timestamped migration containing only the delta."
  fi
done

rm -rf "$UP"; mv "$TMP/new" "$UP"
sed -i.bak -e "s/^Commit: .*/Commit: $NEW_SHA/" -e "s/^Synced: .*/Synced: $(date +%F)/" "$KIT/UPSTREAM.md" && rm -f "$KIT/UPSTREAM.md.bak"

echo
if [ "$CONFLICTS" -gt 0 ]; then
  echo "Done with $CONFLICTS conflict(s). Resolve them, then run the checks in docs/install.md (deno check, smoke tests)."
  exit 2
fi
echo "Done. Review 'git diff', run the checks, then commit (and redeploy the functions that changed)."
