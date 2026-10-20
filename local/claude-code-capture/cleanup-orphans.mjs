/* cleanup-orphans.mjs — one-shot: find Claude Code session nodes captured BEFORE
 * the Supabase service key was configured (no session_id in metadata). Those are
 * "orphans": the re-capture upsert can't find them, so they must be removed once,
 * then their scanner-state entries cleared so the next scan re-captures them fresh
 * (dated + session_id + fingerprint).
 *
 *   node cleanup-orphans.mjs            # DRY RUN — list only, deletes nothing
 *   node cleanup-orphans.mjs --apply    # delete orphan nodes + reset their state
 */
import fs from "fs";
import path from "path";
import os from "os";

const APPLY = process.argv.includes("--apply");
const ROOT = path.join(os.homedir(), ".open-brain", "claude-code-capture");
const STATE_PATH = path.join(ROOT, "logs", "scanner-state.json");

function loadEnv(p) {
  try {
    const v = {};
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
      if (m) v[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return v;
  } catch { return {}; }
}
const env = loadEnv(path.join(ROOT, ".env.local"));
const SUPABASE_URL = (env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || null;
const REST = `${SUPABASE_URL}/rest/v1/thoughts`;

if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local"); process.exit(1); }
const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

const isClaudeCode = (row) => typeof row.content === "string" && row.content.startsWith("[Claude Code session]");
const sessionIdOf = (row) => (row.metadata && (row.metadata.session_id || null));

(async () => {
  // Find ALL Claude Code session nodes by their header text, regardless of age
  // (recent rows are dominated by a chatgpt_import batch).
  const url = `${REST}?select=id,created_at,content_fingerprint,metadata,content&content=ilike.*Claude%20Code%20session*&order=created_at.desc&limit=500`;
  const r = await fetch(url, { headers: H });
  if (!r.ok) { console.error(`GET failed: http_${r.status}`); process.exit(1); }
  const cc = await r.json();
  const orphans = cc.filter((row) => !sessionIdOf(row));

  console.log(`Claude Code nodes (recent 80): ${cc.length} | orphans (no session_id): ${orphans.length}\n`);
  for (const row of cc) {
    const sid = sessionIdOf(row);
    const title = (row.content.split("\n")[0] || "").slice(0, 50);
    console.log(`  ${sid ? "keep " : "ORPHAN"} ${String(row.created_at).slice(0, 19)}  ${row.id}  sid=${sid ? sid.slice(0, 8) : "—"}  ${title}`);
  }

  // SAFETY: these "orphans" are legitimate historical Claude Code captures that
  // simply predate the session_id tag — NOT junk. We never mass-delete them.
  // Surgical resync only: pass --session <sid> to (a) delete THAT session's stale
  // node (matched by its scanner-state date) and (b) clear its state entry so the
  // next scan re-captures it fresh (dated + session_id + fp).
  const sIdx = process.argv.indexOf("--session");
  const TARGET = sIdx >= 0 ? process.argv[sIdx + 1] : null;

  if (!APPLY || !TARGET) {
    console.log(`\nLIST ONLY. Nothing deleted.`);
    console.log(`These orphans are historical captures — do NOT bulk-delete.`);
    console.log(`To resync ONE session cleanly: node cleanup-orphans.mjs --apply --session <session_id>`);
    return;
  }

  // find the target session's stale node by matching its state date to created_at
  let st; try { st = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { st = { sessions: {} }; }
  const rec = st.sessions?.[TARGET];
  if (!rec) { console.log(`\nSession ${TARGET} not in scanner-state — nothing to reset.`); return; }
  const day = String(rec.date || "").slice(0, 19);
  const match = cc.filter((row) => String(row.created_at).slice(0, 19) === day && !sessionIdOf(row));
  console.log(`\nTarget session ${TARGET.slice(0, 8)} | state date ${day} | matching stale node(s): ${match.length}`);
  for (const row of match) {
    const d = await fetch(`${REST}?id=eq.${row.id}`, { method: "DELETE", headers: { ...H, Prefer: "return=minimal" } });
    console.log(d.ok ? `  deleted ${row.id}` : `  FAILED ${row.id} http_${d.status}`);
  }
  delete st.sessions[TARGET];
  fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));
  console.log(`Cleared state entry for ${TARGET}. Next scan (once idle >= 120min) will re-capture it fresh.`);
})();
