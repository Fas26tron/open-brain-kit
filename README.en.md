# Open Brain Kit

*Version française : [README.md](README.md). English guides: [docs/en/](docs/en/).*

A personal AI memory, installed in about an hour, that:

- **builds itself from your ChatGPT and Claude history** (account sync plus import of the official exports);
- **keeps listening** to your ChatGPT, Claude.ai and Claude Code conversations, whether they happen in Chrome, in the Mac apps or on mobile;
- **extends the context of your questions** from every Claude and ChatGPT interface, through an MCP connector, with an optional knowledge-graph layer;
- **gives you advisors** served by the brain itself, usable from any client: a chief of staff that tracks your projects, a sparring partner that knows you, and a panel of personas you define. They learn from your conversations every night.

Everything runs in **your** Supabase project (Postgres + pgvector, four Edge Functions). Nothing goes through a third-party server. Keys stay on your machine and in Supabase secrets.

The kit is built on [Open Brain](https://github.com/NateBJones-Projects/OB1) by Nate B. Jones. It assembles the useful bricks, adds continuous capture, the import scripts and the advisors layer, and keeps an update link to the source (see [UPSTREAM.md](UPSTREAM.md)).

## Quick start

1. Fork this repository on your GitHub account, then clone your fork.
2. Keep this repository as the `upstream` remote to receive updates: `git remote add upstream <URL of this repository>`.
3. Open the folder in Claude Code (or Cursor, Codex…) and type: **"install my Open Brain"**. The agent follows [docs/en/install.md](docs/en/install.md) step by step, runs the commands and verifies each checkpoint. You keep the browser clicks and the sign-ups.
4. Without an agent: follow [docs/en/install.md](docs/en/install.md) yourself.

What you provide: a [Supabase](https://supabase.com) account (free tier), an [OpenRouter](https://openrouter.ai) account with a few dollars of credit, Chrome, and your ChatGPT (paid plan for the connector) and Claude accounts.

## What the repository contains

| Folder | Role |
|---|---|
| `supabase/` | migrations (complete, idempotent schema) and four Edge Functions: `open-brain-mcp` (MCP core), `open-brain-rest` (REST API for the extension and the imports), `ob-graph-mcp` (graph), `open-brain-advisors` (chief of staff, sparring partner, persona panel, see [docs/en/advisors.md](docs/en/advisors.md)) |
| `chrome-capture-extension/` | Chrome extension: on-demand capture and full sync of your ChatGPT and Claude accounts |
| `local/claude-code-capture/` | Claude Code session scanner (launchd, every 2 h) |
| `local/import/` | date-preserving import of a Claude.ai export |
| `chief-of-staff/` | the local, Claude Code version of the chief of staff: also reads your git repos and sessions, versions everything in a repo (French prompts) |
| `keepalive/` | GitHub Actions: anti-pause for the Supabase free tier, and nightly distillation for the advisors |
| `bootstrap.sh` | installs the local part (scanner, scripts, config) on a Mac |
| `docs/` | French guides; English in [docs/en/](docs/en/): [install](docs/en/install.md), [connect-clients](docs/en/connect-clients.md), [advisors](docs/en/advisors.md), [rules](docs/en/rules.md) (definition rules for domains, personas, chief of staff, sparring partner, retention) |
| `upstream/` | pristine copies of the original OB1 files, merge base for updates |
| `scripts/sync-upstream.sh` | fetches OB1 changes (security fixes…) and merges them into the kit |

## Updates

- **Kit user**: `git pull upstream main`, then `supabase db push`, `supabase functions deploy`, reload the extension and re-run `./bootstrap.sh`. Details at the end of [docs/en/install.md](docs/en/install.md).
- **Kit maintainer**: `scripts/sync-upstream.sh`, then `--apply` to integrate OB1 changes. See [UPSTREAM.md](UPSTREAM.md).

## What is deliberately not here

The kit contains no data and no code specific to any business. Your brain, your keys and your conversations live in your Supabase project and on your machine. A business-specific layer belongs in a second, private repository that depends on this one.

## License

FSL-1.1-MIT, like OB1 (see [LICENSE.md](LICENSE.md)): free internal and personal use, no competing derivative product.
