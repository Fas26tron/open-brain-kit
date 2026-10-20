# Connect your AI clients

*Version française : [../connect-clients.md](../connect-clients.md).*

Your Open Brain exposes MCP servers. Any client that speaks MCP can query it (`search_thoughts`, `list_thoughts`, `thought_stats`) and write to it (`capture_thought`). The core also exposes `search` and `fetch`, the two tools ChatGPT requires.

Values to prepare:

- **MCP connection URL**: `https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=BRAIN_KEY`
- **Graph URL**: `https://PROJECT_REF.supabase.co/functions/v1/ob-graph-mcp?key=BRAIN_KEY`
- **Advisors URL**: `https://PROJECT_REF.supabase.co/functions/v1/open-brain-advisors?key=BRAIN_KEY`

The key is in the URL: paste these URLs only into the settings of your own clients. Where a client offers **request headers**, prefer the URL without `?key=` and a header `x-brain-key` with the key: it is stored encrypted and never displayed again. All functions accept both forms.

## Claude (web, desktop, mobile)

Connectors are attached to your Claude account. Add one once, it appears in claude.ai, Claude Desktop and the mobile app.

1. [claude.ai](https://claude.ai) → **Settings → Connectors** (or Claude Desktop → Settings → Connectors).
2. **Add custom connector**. Name: `Open Brain`. URL: your MCP connection URL (or the URL without the key plus an `x-brain-key` header). Authentication: **No connection** / none, the key does the job. **Add**.
3. In a new conversation, the **+** button → Connectors lets you enable Open Brain or not.
4. **Tool permissions** (open the connector from the list): set the read tools to "always allow" and keep "ask" for the write tools, otherwise Claude asks for confirmation at every call.

Do the same with the name `OB-Graph` and the graph URL if you want the graph tools, and with the name `Advisors` and the advisors URL (see [advisors.md](advisors.md)).

**Done when**: "how many thoughts does my Open Brain contain?" triggers `thought_stats`.

## ChatGPT

Paid plan required (Plus, Pro, Business…). Since summer 2026, MCP connectors are called **plugins** in ChatGPT and there is no developer mode to enable any more. A plugin is created once, on the web, then installed on the account: it is then available in the Mac app (verified in October 2026) and, depending on versions, on mobile.

1. [chatgpt.com](https://chatgpt.com) → avatar → **Settings → Plugins** → **Browse directory** → **+** or **Add custom MCP server**.
2. Name: `Open Brain Memory` (if "Open Brain" is reported as already existing, change the name, it does not matter). Description: `My personal memory: search and capture`. Server URL: your MCP connection URL, key included. Authentication: **No authentication**. Tick "I understand and want to continue", then **Create as a plugin**.
3. Back in **Plugins**, **Personal** tab, "Created by you" section: click the plugin's **+** to **install** it. It then appears under "Installed". A created but not installed plugin does nothing.
4. In a conversation, the **+** button of the input field: enable the plugin if ChatGPT does not offer it by itself. If the tool is not called spontaneously, name it: "use Open Brain Memory's search tool to…".

This part of ChatGPT changes often. If a tool is reported unavailable and the Supabase logs of `open-brain-mcp` show no request, recreate the plugin and open a new conversation.

**Done when**: the same question as above triggers `search` or `thought_stats`.

## Claude Code

One command, replacing the two values. `--scope user` makes the connector available in all your projects.

```bash
claude mcp add --transport http --scope user open-brain \
  https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp \
  --header "x-brain-key: BRAIN_KEY"
```

For the graph and the advisors:

```bash
claude mcp add --transport http --scope user ob-graph \
  "https://PROJECT_REF.supabase.co/functions/v1/ob-graph-mcp?key=BRAIN_KEY"
claude mcp add --transport http --scope user advisors \
  "https://PROJECT_REF.supabase.co/functions/v1/open-brain-advisors?key=BRAIN_KEY"
```

**Done when**: `claude mcp list` shows the servers connected, and in a session "what does my Open Brain know about this project?" answers.

## Codex, Cursor, VS Code, Windsurf

These clients accept either the MCP connection URL directly, or a local bridge (`supergateway` or `mcp-remote`). Ready-to-copy configurations are in `upstream/docs/01-getting-started.md`, sections 7.4 and 7.5.

## Daily use

- **Remember**: "remember that…", "note for later…" → `capture_thought`.
- **Recall**: "what did I decide about…", "remind me of the context of…" → `search_thoughts`.
- **Extend a question**: "taking into account what my Open Brain knows about X, …". Claude does it by itself; ChatGPT sometimes needs the tool named.

Automatic captures (Chrome extension, Claude Code scanner) arrive with `source_type` = `chatgpt_import`, `claude_import`, `claude_code_session`, which allows filtering by origin.
