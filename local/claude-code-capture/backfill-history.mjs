#!/usr/bin/env node
/**
 * Open Brain — Claude Code history BACKFILL (date-preserving)
 *
 * Scans past Claude Code .jsonl transcripts, captures each session (>=3 human
 * turns) as one raw thought via the MCP `capture_thought` tool (server-side
 * embedding + metadata), then OVERRIDES `created_at` to the real session date
 * and tags provenance metadata via the PostgREST service-role API.
 *
 * Why two steps: capture_thought generates the embedding for us but stamps
 * created_at = now(); a naive backfill would date all history "today" and
 * break recency. So we patch the row (matched by content_fingerprint) to the
 * original session timestamp.
 *
 * Config (PROJECT_ROOT/.env.local or env):
 *   SUPABASE_URL, MCP_ACCESS_KEY      (capture path)
 *   SUPABASE_SERVICE_ROLE_KEY (env)   (date/metadata patch — pass inline)
 *
 * Usage:
 *   node backfill-history.mjs                 # dry run (plan only)
 *   SUPABASE_SERVICE_ROLE_KEY=... node backfill-history.mjs --apply
 *   ... --filter my-project                   # optional: project folder name substring
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";

const APPLY = process.argv.includes("--apply");
const fIdx = process.argv.indexOf("--filter");
const FILTER = fIdx >= 0 ? process.argv[fIdx + 1].toLowerCase() : "";

const ROOT = path.join(os.homedir(), ".open-brain", "claude-code-capture");
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const PROCESSED_LOG = path.join(ROOT, "logs", "backfill-processed.log");

const MIN_USER_TURNS = 3;
const PER_TURN_CHARS = 4000;
const MAX_CONTENT_CHARS = 24000; // ~6k tokens, under the 8191 embedding limit

// ── env ──
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
const SUPABASE_URL = (env.SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
const BRAIN_KEY = env.MCP_ACCESS_KEY || process.env.MCP_ACCESS_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MCP_URL = `${SUPABASE_URL}/functions/v1/open-brain-mcp`;
const REST = `${SUPABASE_URL}/rest/v1/thoughts`;

// ── transcript parsing (same rules as the live hook) ──
function extractText(c) {
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) return c.filter((p) => p && p.type === "text" && typeof p.text === "string").map((p) => p.text).join("\n").trim();
  return "";
}
function isNoiseHuman(t) {
  if (!t) return true;
  if (t.startsWith("<command-") || t.startsWith("<local-command")) return true;
  if (t.startsWith("[Request interrupted")) return true;
  if (t.startsWith("Caveat:") && t.length < 400) return true;
  return false;
}
function parseTranscript(fp) {
  const raw = fs.readFileSync(fp, "utf8");
  let sessionId = "unknown", title = "", cwd = "", gitBranch = "", createdAt = "";
  const turns = [];
  for (const line of raw.split("\n")) {
    const s = line.trim(); if (!s) continue;
    let o; try { o = JSON.parse(s); } catch { continue; }
    if (o.isSidechain === true) continue;
    if (o.sessionId && sessionId === "unknown") sessionId = o.sessionId;
    if (o.cwd && !cwd) cwd = o.cwd;
    if (o.gitBranch && !gitBranch) gitBranch = o.gitBranch;
    if (o.timestamp && !createdAt) createdAt = o.timestamp;
    if (o.type === "ai-title" && o.aiTitle) title = o.aiTitle;
    const m = o.message; if (!m || typeof m !== "object") continue;
    if (o.type === "user" && m.role === "user") {
      const t = extractText(m.content); if (!isNoiseHuman(t)) turns.push({ role: "human", content: t });
    } else if (o.type === "assistant" && m.role === "assistant") {
      const t = extractText(m.content); if (t) turns.push({ role: "assistant", content: t });
    }
  }
  return { sessionId, title, cwd, gitBranch, createdAt, turns, userTurns: turns.filter((t) => t.role === "human").length };
}
function clip(s, n) { return s.length > n ? s.slice(0, n) + " …[clipped]" : s; }
function escapeDelims(t) { return t.replace(/<thought_content>/gi, "<thought_content_escaped>").replace(/<\/thought_content>/gi, "</thought_content_escaped>"); }
function formatTranscript(p, project) {
  const header = [
    `[Claude Code session] ${p.title || project}`,
    `Source: claude_code | Project: ${project}` + (p.gitBranch ? ` | Branch: ${p.gitBranch}` : ""),
    `Date: ${p.createdAt} | Human turns: ${p.userTurns}`,
    "---",
  ].join("\n");
  const body = p.turns.filter((t) => t.content.trim()).map((t) => `[${t.role}]\n${clip(escapeDelims(t.content), PER_TURN_CHARS)}`).join("\n\n");
  let content = `${header}\n\n<thought_content>\n${body}\n</thought_content>`;
  if (content.length > MAX_CONTENT_CHARS) {
    content = content.slice(0, Math.floor(MAX_CONTENT_CHARS * 0.6)) + "\n\n…[middle truncated for v1 capture]…\n\n" + content.slice(-Math.floor(MAX_CONTENT_CHARS * 0.4));
  }
  return content;
}
// matches upsert_thought: sha256(lower(trim(collapse_ws(content))))
function fingerprint(content) {
  return crypto.createHash("sha256").update(content.replace(/\s+/g, " ").trim().toLowerCase(), "utf8").digest("hex");
}

// ── MCP capture ──
async function captureViaMcp(content) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "x-brain-key": BRAIN_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "capture_thought", arguments: { content } } }),
  });
  if (res.status !== 200) return { ok: false, detail: `http_${res.status}` };
  const text = await res.text();
  let body = null;
  for (const line of text.split("\n")) { const s = line.trim(); if (s.startsWith("data:")) { try { body = JSON.parse(s.slice(5).trim()); break; } catch {} } }
  if (!body) { try { body = JSON.parse(text); } catch {} }
  if (!body || body.error) return { ok: false, detail: `rpc_${body?.error?.code ?? "none"}` };
  if (body.result?.isError) return { ok: false, detail: (body.result.content?.[0]?.text || "tool_error").slice(0, 100) };
  return { ok: true, detail: (body.result?.content?.[0]?.text || "captured").slice(0, 100) };
}

// ── service-role patch: set real created_at + provenance metadata ──
async function patchDate(fp, isoDate, meta) {
  const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
  const g = await fetch(`${REST}?content_fingerprint=eq.${fp}&select=id,metadata`, { headers: h });
  const rows = await g.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return { ok: false, detail: "row_not_found" };
  const merged = { ...(rows[0].metadata || {}), ...meta };
  const p = await fetch(`${REST}?content_fingerprint=eq.${fp}`, {
    method: "PATCH", headers: { ...h, Prefer: "return=minimal" },
    body: JSON.stringify({ created_at: isoDate, metadata: merged }),
  });
  return { ok: p.ok, detail: p.ok ? rows[0].id : `patch_http_${p.status}` };
}

// ── main ──
function scan() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR).filter((d) => d.toLowerCase().includes(FILTER)); } catch {}
  for (const d of dirs) {
    const full = path.join(PROJECTS_DIR, d);
    let files = []; try { files = fs.readdirSync(full).filter((f) => f.endsWith(".jsonl")); } catch {}
    for (const f of files) {
      const fp = path.join(full, f);
      let p; try { p = parseTranscript(fp); } catch { continue; }
      if (p.userTurns < MIN_USER_TURNS) continue;
      out.push({ p, project: d.split("GitHub-").pop(), file: f });
    }
  }
  out.sort((a, b) => (a.p.createdAt || "").localeCompare(b.p.createdAt || ""));
  return out;
}

(async () => {
  if (!SUPABASE_URL || !BRAIN_KEY) { console.error("Missing SUPABASE_URL / MCP_ACCESS_KEY in .env.local"); process.exit(1); }
  const sessions = scan();
  console.log(`Filter: "${FILTER}"  |  sessions to backfill (>=${MIN_USER_TURNS} turns): ${sessions.length}\n`);
  console.log(`${"date".padEnd(11)}${"turns".padStart(5)}  title`);
  for (const s of sessions) console.log(`${(s.p.createdAt || "????").slice(0, 10).padEnd(11)}${String(s.p.userTurns).padStart(5)}  ${(s.p.title || s.project).slice(0, 50)}`);

  if (!APPLY) { console.log(`\nDRY RUN. Re-run with --apply (and SUPABASE_SERVICE_ROLE_KEY set) to inject with preserved dates.`); return; }
  if (!SERVICE_KEY) { console.error("\n--apply requires SUPABASE_SERVICE_ROLE_KEY in env (for the date patch)."); process.exit(1); }

  fs.mkdirSync(path.dirname(PROCESSED_LOG), { recursive: true });
  console.log("\nApplying…\n");
  let done = 0, fail = 0;
  for (const s of sessions) {
    const content = formatTranscript(s.p, s.project);
    const fp = fingerprint(content);
    const cap = await captureViaMcp(content);
    if (!cap.ok) { console.log(`  ✗ ${s.p.createdAt.slice(0,10)} ${(s.p.title||"").slice(0,40)} — capture failed: ${cap.detail}`); fail++; continue; }
    const meta = { source: "claude_code_backfill", source_date: s.p.createdAt, session_id: s.p.sessionId, project: s.project, claude_code_title: s.p.title };
    const patch = await patchDate(fp, s.p.createdAt, meta);
    const line = `${new Date().toISOString()} date=${s.p.createdAt} session=${s.p.sessionId} project=${s.project} capture=${cap.ok} patch=${patch.ok} id=${patch.detail}`;
    fs.appendFileSync(PROCESSED_LOG, line + "\n");
    if (patch.ok) { console.log(`  ✓ ${s.p.createdAt.slice(0,10)}  ${(s.p.title||s.project).slice(0,46)}`); done++; }
    else { console.log(`  ⚠ ${s.p.createdAt.slice(0,10)}  ${(s.p.title||"").slice(0,40)} — captured but date-patch failed: ${patch.detail}`); fail++; }
  }
  console.log(`\nDone. injected+dated: ${done} | issues: ${fail}`);
})();
