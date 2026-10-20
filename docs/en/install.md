# Install your Open Brain

*Version française : [../install.md](../install.md).*

About one hour, twenty minutes of which are browser clicks. No code to write. If you use Claude Code or an equivalent tool, open this repository in it and ask "install my Open Brain": it walks through this guide for you.

Every step ends with a **Done when**. Do not move on until it is true.

## Before you start

**Accounts to create** (only you can do this):

- [Supabase](https://supabase.com): your database. The free plan is enough (see step 11 to keep it from pausing).
- [OpenRouter](https://openrouter.ai): gateway to the embedding and language models. Add $5 of credit, it lasts months.
- A paid ChatGPT plan if you want the ChatGPT plugin (Plus, Pro, Business…). Claude works with any account.

**Tools on the Mac**:

```bash
brew install supabase/tap/supabase node jq
```

**Credential tracker.** You will produce identifiers and keys reused at several steps. Note them as you go in a password manager:

| Value | Obtained at step |
|---|---|
| Supabase project ref (random string in the dashboard URL) | 1 |
| Database password | 1 |
| OpenRouter key | 2 |
| Brain key (`MCP_ACCESS_KEY`) | 5 |
| Graph owner UUID (`DEFAULT_USER_ID`) | 5 |
| `service_role` key (optional, for dated imports) | 5 |

The two URLs you will use everywhere, once the project ref is known:

- **Functions URL**: `https://PROJECT_REF.supabase.co/functions/v1`
- **MCP connection URL**: `https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=BRAIN_KEY`

## Step 1 — Supabase project

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**. Name: `open-brain`. Region: the closest to you. Generate a strong password and note it.
2. Wait one or two minutes. The **project ref** is the random part of the URL: `supabase.com/dashboard/project/THIS_PART`.
3. Nothing else to click: the `vector` extension is enabled by the first migration (verified on a fresh project).

**Done when**: project ref and password are noted, the project shows "Active".

## Step 2 — OpenRouter key

[openrouter.ai/keys](https://openrouter.ai/keys) → **Create key** → note it. Then **Credits** → add $5.

**Done when**: the key is noted and the balance is positive.

## Step 3 — Link the repository to the project

From the kit root:

```bash
supabase login                             # opens the browser
supabase link --project-ref PROJECT_REF    # asks for the database password
```

With an agent that cannot answer a prompt, add `-p 'PASSWORD'` to the `link` command.

**Done when**: `supabase projects list` shows a ● in front of your project.

## Step 4 — Database

```bash
supabase db push
```

Five migrations apply: the `thoughts` table with vector search and deduplication, its extended columns (type, importance, sensitivity), the status columns, the graph tables, and the advisors tables. `NOTICE … already exists, skipping` lines are normal: the migrations are written to be re-runnable.

**Done when**: in **Table Editor** you see `thoughts`, `graph_nodes`, `graph_edges`, `advisor_personas`. Running `supabase db push` again prints "Remote database is up to date".

## Step 5 — Secrets

Generate your brain key and the graph UUID:

```bash
openssl rand -hex 32          # → MCP_ACCESS_KEY
uuidgen | tr 'A-Z' 'a-z'      # → DEFAULT_USER_ID
```

Then:

```bash
cp supabase/secrets.env.example supabase/secrets.env
open -e supabase/secrets.env            # fill in the three values
supabase secrets set --env-file supabase/secrets.env
```

`supabase/secrets.env` is git-ignored. Never commit it.

The `service_role` key (Supabase → **Settings → API**) is not a function secret. Note it only if you will run dated imports (steps 9 and 10).

**Done when**: `supabase secrets list` shows `OPENROUTER_API_KEY`, `MCP_ACCESS_KEY`, `DEFAULT_USER_ID`.

## Step 6 — Deploy the four functions

```bash
supabase functions deploy open-brain-mcp open-brain-rest ob-graph-mcp open-brain-advisors --use-api
```

`--use-api` avoids needing Docker. `supabase/config.toml` pins `verify_jwt = false` for all four: this is required, the functions authenticate with your brain key, not with a Supabase token.

Verify, replacing the two values:

```bash
URL=https://PROJECT_REF.supabase.co/functions/v1
KEY=your_brain_key

curl -s "$URL/open-brain-rest/health" -H "x-brain-key: $KEY"
curl -s "$URL/ob-graph-mcp/health"
curl -s "$URL/open-brain-advisors/health"
curl -s -X POST "$URL/open-brain-mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "x-brain-key: $KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"thought_stats","arguments":{}}}'
```

**Done when**: the three `health` calls answer `ok` and the last command contains "Total thoughts: 0". A wrong key gives a 401 on `open-brain-rest`, `ob-graph-mcp` and `open-brain-advisors`, and on `open-brain-mcp` a 200 response containing "Unauthorized: missing or invalid authentication" (the MCP format). In both cases, compare the key with step 5.

The OpenRouter balance is only used at the first capture. If a capture returns "OpenRouter embeddings failed: 401 User not found", the OpenRouter key from step 5 is wrong or was not pushed with `supabase secrets set`.

## Step 7 — Connect your AI clients

Follow [connect-clients.md](connect-clients.md): Claude (web, desktop, mobile), ChatGPT, Claude Code, the graph and the advisors as additional connectors.

**Done when**: in Claude or ChatGPT, "how many thoughts does my Open Brain contain?" triggers the `thought_stats` tool and answers.

## Step 8 — Chrome extension

This is what captures ChatGPT and Claude.ai. It reads your **account** history through the two sites' APIs, not the page on screen: conversations held in the Mac and mobile apps are captured too, as long as Chrome is open and signed in to both sites.

1. `chrome://extensions` → **Developer mode** (top right) → **Load unpacked** → select the kit's `chrome-capture-extension/` folder.
2. Click the extension icon → ⚙️ **Settings**: *Open Brain REST API URL* = `https://PROJECT_REF.supabase.co/functions/v1`, *API Key* = your brain key → **Test connection** → **Save**.
3. Open [chatgpt.com](https://chatgpt.com) and [claude.ai](https://claude.ai) signed in, then in the popup: **Sync All** for each. The first sync imports every reachable conversation, a few seconds each. Leave the tab open.
4. Tick **Auto-sync every 15 min** for Claude and for ChatGPT. This is what makes capture continuous: from then on, every new or changed conversation enters the brain without any action, including those from the Mac and mobile apps.

What the sync reaches: on ChatGPT, active and archived conversations, including **Work** sessions (the final exchange, not the intermediate steps), but not conversations filed in a **Project** (API not reachable: move them out of the project, they are picked up at the next pass). On Claude, the default list; for the full history, see step 10.

After each kit update, reload the extension (↻ button in `chrome://extensions`).

**Done when**: the popup shows a number of synced conversations and `thought_stats` has increased.

## Step 9 — Claude Code scanner (only if you use Claude Code)

Captures every finished Claude Code session (idle for 2 h, at least 3 turns) every two hours, through launchd.

```bash
./bootstrap.sh      # creates ~/.open-brain/claude-code-capture/.env.local
open -e ~/.open-brain/claude-code-capture/.env.local   # SUPABASE_URL + MCP_ACCESS_KEY
./bootstrap.sh      # installs and verifies the launchd agent
```

To backfill past sessions with their real dates:

```bash
node ~/.open-brain/claude-code-capture/backfill-history.mjs                          # preview
SUPABASE_SERVICE_ROLE_KEY=... node ~/.open-brain/claude-code-capture/backfill-history.mjs --apply
```

If you work on several Macs, run `./bootstrap.sh` on each: deduplication by session id avoids duplicates.

**Done when**: `bootstrap.sh` prints "scanner ran successfully (exit 0)".

## Step 10 — Full history

- **Claude**: [claude.ai](https://claude.ai) → Settings → Privacy → **Export data**. You receive a zip by email. Unzip it, then:

  ```bash
  node ~/.open-brain/import/import-claude-export.mjs ~/Downloads/claude-export          # preview
  node ~/.open-brain/import/import-claude-export.mjs ~/Downloads/claude-export --apply  # import
  ```

  Each conversation keeps its original date. Re-running the script creates no duplicates.

- **ChatGPT**: the sync from step 8 already covers the whole history except Projects. For an official export (Settings → Data controls → Export), use OB1's [chatgpt-conversation-import](https://github.com/NateBJones-Projects/OB1/tree/main/recipes/chatgpt-conversation-import) recipe.

**Done when**: "what are my oldest conversations?" in Claude returns thoughts dated from the matching year.

## Step 11 — Keep-alive (free tier only)

Supabase pauses a free project after a week of inactivity. Follow [../../keepalive/README.md](../../keepalive/README.md): five minutes, a GitHub Action that pings the brain every day. The same private repository hosts the advisors' nightly job (step 12).

**Done when**: the Action's first run is green.

## Step 12 — Advisors: chief of staff, sparring partner, panel (optional)

Three roles served by your brain, usable from all your clients, that learn from your conversations every night. Follow [advisors.md](advisors.md): the function is already deployed by step 6; add the connector and copy the nightly workflow.

**Done when**: "list my personas" answers in Claude and the nightly job's first run is green.

Local variant for Claude Code, which also reads your git repositories: [../../chief-of-staff/README.md](../../chief-of-staff/README.md) (French prompts).

## End-to-end test

1. In Claude Desktop: "remember that I prefer meetings in the morning". The `capture_thought` tool must run.
2. In ChatGPT (or Claude Code): "what do you know about my meeting preferences?". The answer must cite the thought.

If both pass, your Open Brain is complete.

## Updating the kit

```bash
git pull upstream main
supabase db push
supabase functions deploy open-brain-mcp open-brain-rest ob-graph-mcp open-brain-advisors --use-api
./bootstrap.sh
```

Then reload the extension in `chrome://extensions`.

## Troubleshooting

- **401 everywhere, or "Unauthorized" in MCP answers**: the key entered on the client side differs from `MCP_ACCESS_KEY`, or a function was deployed with `verify_jwt = true`. Redeploy from the kit.
- **The CLI prints "A new version of Supabase CLI is available"**: a reminder, no effect on the installation. `brew upgrade supabase` whenever you want.
- **"Failed to create project …" when creating the project from the CLI**: Supabase-side error, sometimes region-related. Retry in another region or create the project from the dashboard.
- **The brain stops answering, DNS not found**: free-tier project paused. Dashboard → **Restore**, then set up step 11.
- **Extension: "Could not get access token"**: you are not signed in to chatgpt.com in this Chrome profile, or the site changed its internal API. See the service worker logs (`chrome://extensions` → Inspect views).
- **ChatGPT says the tool is unavailable**: the plugin was created but not installed, or did not reach the server. Check Supabase → Edge Functions → `open-brain-mcp` → Logs. Details in `upstream/docs/03-faq.md`.
- **"OpenRouter embeddings failed: 401 …"** (`User not found` or `Missing Authentication header`): the `OPENROUTER_API_KEY` value is wrong, or an example was pasted as is. Set the real key again with `supabase secrets set OPENROUTER_API_KEY=... --project-ref PROJECT_REF`. Thoughts captured while the key was wrong exist but have no embedding, so search cannot find them: run the same capture or import again after the fix, deduplication finds the row and adds the embedding.
- **"permission denied for table thoughts"**: the base migration was not fully applied. Run `supabase db push` again.
