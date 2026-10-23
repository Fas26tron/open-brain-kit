# Upstream: NateBJones-Projects/OB1

Repository: https://github.com/NateBJones-Projects/OB1
Commit: 238df6cefd307745d1fe49d10b96797903bf25ac
Synced: 2026-10-20

The `upstream/` folder holds **pristine copies** of the OB1 paths this kit is built from. They are never edited: they are the reference and the merge base for `scripts/sync-upstream.sh`. The files the kit actually deploys live in the working copies listed below.

## What is vendored and where it is used

| OB1 path | Used as | Kit working copy | Local patches |
|---|---|---|---|
| `server/` | core MCP server (6 tools: capture, search, list, stats + `search`/`fetch` for ChatGPT) | `supabase/functions/open-brain-mcp/` | none |
| `integrations/open-brain-rest/` | REST gateway used by the Chrome extension and the import scripts | `supabase/functions/open-brain-rest/` | yes, see below |
| `recipes/ob-graph/` | knowledge-graph MCP server + schema | `supabase/functions/ob-graph-mcp/`, `supabase/migrations/20260628190000_ob_graph.sql` | none |
| `schemas/enhanced-thoughts/` | extra columns on `thoughts` (type, importance, sensitivity…) | `supabase/migrations/20260627140000_enhanced_thoughts.sql` | none |
| `schemas/workflow-status/` | status columns on `thoughts` | `supabase/migrations/20260627140100_workflow_status.sql` | none |
| `integrations/chrome-capture-extension/` | Chrome capture extension | `chrome-capture-extension/` | yes, see below |
| `docs/01-getting-started.md` (Step 2 SQL) | base schema | `supabase/migrations/20260101000000_base_thoughts.sql` (assembled, idempotent) | n/a |
| `docs/01-getting-started.md`, `docs/03-faq.md`, `docs/04-ai-assisted-setup.md` | reference only (troubleshooting, client setup details) | — | — |
| `LICENSE.md` | license (FSL-1.1-MIT) | `LICENSE.md` | none |

## Local patches (what differs from upstream, and why)

**`supabase/functions/open-brain-rest/index.ts`** (2 hunks)

1. `getEmbedding`: the embedding model caps at ~8191 *tokens*, not characters, and OpenRouter can return HTTP 200 with an error body on overflow. The function now halves the input and retries until it gets a valid vector, so token-dense conversations (code, JSON) no longer fail with a generic 500.
2. `POST /ingest`: replaces the previous versions of a synced conversation (by `conversation_id`, or by its title/date header for older rows) instead of adding a copy each time it grows, carrying over hand-set domains and sensitivity; honours `source_type` from the client (was hard-coded to `dashboard_ingest`), applies `source_date` to `created_at` so imported conversations keep their real date, and returns the real error message instead of a bare 500.

**`chrome-capture-extension/`** (3 files: `lib/sync-chatgpt.js`, `lib/sync-claude.js`, `background/service-worker.js`)

1. ChatGPT sync fetches **archived** conversations too (second pass with `is_archived=true`, merged and deduplicated by id). The default endpoint only returns the active list.
2. Both syncs send `sourceDate` (the conversation's real creation time) and the service worker forwards it as `source_date` to `/ingest`, so history keeps its chronology instead of being dated "today".

These patches are candidates for upstream pull requests. If they are merged upstream, the next sync will make the working copies identical to upstream again.

## Updating from upstream

```bash
scripts/sync-upstream.sh            # dry run: what changed since the recorded commit
scripts/sync-upstream.sh --apply    # update upstream/, 3-way merge into working copies
```

After `--apply`:

1. Resolve any `<<<<<<<` conflict markers the script reported.
2. Run the checks: `deno check` on each function, `bash -n bootstrap.sh`, `node --check` on the scripts.
3. If the script reported **SCHEMA CHANGED**, write a *new* migration with the delta. Never edit a migration that users have already applied.
4. Redeploy what changed (`supabase functions deploy …`, reload the extension), then commit. Users pick it up with `git pull upstream main`.
