# Keep-alive (Supabase free tier only)

Supabase pauses a **free-tier** project after about 7 days without activity. A paused brain answers nothing until you restore it from the dashboard, and your Chrome extension and scanner silently fail in the meantime.

This GitHub Action pings your brain once a day with a real database query (the `thought_stats` MCP tool), so the project is never idle. It also commits a heartbeat file so GitHub never disables the scheduled workflow for repository inactivity (60-day rule).

Skip this entirely if you are on the Supabase Pro plan.

## Setup (5 minutes)

1. Create a **private** GitHub repository, e.g. `openbrain-keepalive`.
2. Copy `keepalive.yml` from this folder to `.github/workflows/keepalive.yml` in that repository, add an empty `last-ping.txt`, commit and push.
3. In the repository: **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `OB_MCP_URL` = `https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp`
   - `OB_BRAIN_KEY` = your `MCP_ACCESS_KEY`
4. **Settings → Actions → General → Workflow permissions**: select *Read and write permissions* (needed to push the heartbeat commit).
5. **Actions** tab → *Open Brain keep-alive* → **Run workflow**. A green run proves the chain works.

Done when: the run is green and `last-ping.txt` shows today's timestamp.

If you ever rotate your brain key, update `OB_BRAIN_KEY` here too. A failing run emails you, which doubles as an early warning that the brain is down.
