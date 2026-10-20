#!/usr/bin/env node
/**
 * Open Brain — Claude Code session SCANNER (scheduled, incremental)
 *
 * Reliable replacement for the SessionEnd hook. Periodically scans completed
 * Claude Code transcripts and captures each session EXACTLY ONCE:
 *   - only sessions idle for >= IDLE_MINUTES (i.e. finished, never mid-flight)
 *   - deduped by session_id via a local state file
 *   - >= MIN_USER_TURNS human turns
 *   - real session date carried in the thought's content header
 *
 * Capture goes through the MCP `capture_thought` tool (server-side embedding +
 * metadata), so the recurring job needs only the brain key — NOT the master
 * service-role key. If SUPABASE_SERVICE_ROLE_KEY is present in env (e.g. a
 * one-off manual run), it ALSO patches created_at to the real session date and
 * tags provenance metadata; otherwise created_at = now (fine: sessions are
 * captured the same day they finish).
 *
 * Config (PROJECT_ROOT/.env.local or env): SUPABASE_URL, MCP_ACCESS_KEY
 * Optional env: SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scan-sessions.mjs                # dry run (plan only)
 *   node scan-sessions.mjs --apply        # capture new finished sessions
 *   node scan-sessions.mjs --apply --filter my-project
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";

const APPLY = process.argv.includes("--apply");
const fIdx = process.argv.indexOf("--filter");
const FILTER = fIdx >= 0 ? process.argv[fIdx + 1].toLowerCase() : null;

const ROOT = path.join(os.homedir(), ".open-brain", "claude-code-capture");
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const STATE_PATH = path.join(ROOT, "logs", "scanner-state.json");
const LOG_PATH = path.join(ROOT, "logs", "scanner.log");
const BACKFILL_LOG = path.join(ROOT, "logs", "backfill-processed.log");

const MIN_USER_TURNS = 3;
const IDLE_MINUTES = 120;           // a session is "finished" once idle this long
const PER_TURN_CHARS = 4000;
const MAX_CONTENT_CHARS = 24000;

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
// Lu depuis .env.local ET process.env, comme SUPABASE_URL/MCP_ACCESS_KEY ci-dessus.
// Sous launchd l'agent n'hérite d'aucune variable du shell : se limiter à
// process.env rendait le datage exact impossible en capture automatique, et
// toutes les sessions atterrissaient avec created_at = now().
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
const MCP_URL = `${SUPABASE_URL}/functions/v1/open-brain-mcp`;
const REST = `${SUPABASE_URL}/rest/v1/thoughts`;

function log(line) {
  try { fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true }); fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`); } catch {}
}

// ── state (session_id -> record) ──
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
  catch {
    // First run: seed from the backfill log so already-injected sessions are skipped.
    const seeded = { sessions: {} };
    try {
      for (const ln of fs.readFileSync(BACKFILL_LOG, "utf8").split("\n")) {
        const m = ln.match(/session=([0-9a-f-]{36})/i);
        if (m) seeded.sessions[m[1]] = { seeded_from_backfill: true };
      }
    } catch {}
    return seeded;
  }
}
function saveState(s) {
  try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); } catch {}
}

// ── parsing / formatting (same rules as backfill & hook) ──
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
    if (o.type === "user" && m.role === "user") { const t = extractText(m.content); if (!isNoiseHuman(t)) turns.push({ role: "human", content: t }); }
    else if (o.type === "assistant" && m.role === "assistant") { const t = extractText(m.content); if (t) turns.push({ role: "assistant", content: t }); }
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
  if (content.length > MAX_CONTENT_CHARS) content = content.slice(0, Math.floor(MAX_CONTENT_CHARS * 0.6)) + "\n\n…[middle truncated for v1 capture]…\n\n" + content.slice(-Math.floor(MAX_CONTENT_CHARS * 0.4));
  return content;
}
function fingerprint(content) { return crypto.createHash("sha256").update(content.replace(/\s+/g, " ").trim().toLowerCase(), "utf8").digest("hex"); }

async function captureViaMcp(content) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "x-brain-key": BRAIN_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "capture_thought", arguments: { content } } }),
  });
  if (res.status !== 200) return { ok: false, detail: `http_${res.status}` };
  const text = await res.text();
  let body = null;
  for (const l of text.split("\n")) { const s = l.trim(); if (s.startsWith("data:")) { try { body = JSON.parse(s.slice(5).trim()); break; } catch {} } }
  if (!body) { try { body = JSON.parse(text); } catch {} }
  if (!body || body.error) return { ok: false, detail: `rpc_${body?.error?.code ?? "none"}` };
  if (body.result?.isError) return { ok: false, detail: (body.result.content?.[0]?.text || "tool_error").slice(0, 80) };
  return { ok: true, detail: (body.result?.content?.[0]?.text || "captured").slice(0, 80) };
}
async function patchDate(fp, isoDate, meta) {
  if (!SERVICE_KEY) return { ok: true, detail: "skipped(no_service_key)" };
  const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
  const g = await fetch(`${REST}?content_fingerprint=eq.${fp}&select=id,metadata`, { headers: h });
  const rows = await g.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return { ok: false, detail: "row_not_found" };
  const merged = { ...(rows[0].metadata || {}), ...meta };
  const p = await fetch(`${REST}?content_fingerprint=eq.${fp}`, { method: "PATCH", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify({ created_at: isoDate, metadata: merged }) });
  return { ok: p.ok, detail: p.ok ? "dated" : `patch_http_${p.status}` };
}
// Remove a previously-captured node (by its old content fingerprint) so that a
// re-capture of a grown session upserts instead of creating a duplicate.
async function deleteByFingerprint(oldFp) {
  if (!SERVICE_KEY || !oldFp) return { ok: false, detail: "no_key_or_fp" };
  const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: "return=minimal" };
  const r = await fetch(`${REST}?content_fingerprint=eq.${oldFp}`, { method: "DELETE", headers: h });
  return { ok: r.ok, detail: r.ok ? "old_deleted" : `del_http_${r.status}` };
}

// ── scan ──
function scan(state) {
  const now = Date.now();
  const candidates = [];
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR); } catch {}
  for (const d of dirs) {
    if (FILTER && !d.toLowerCase().includes(FILTER)) continue;
    const full = path.join(PROJECTS_DIR, d);
    let files = []; try { files = fs.readdirSync(full).filter((f) => f.endsWith(".jsonl")); } catch {}
    for (const f of files) {
      const sid = f.replace(/\.jsonl$/, "");
      const prev = state.sessions[sid];
      if (prev && prev.skipped) continue;                        // too_short / seeded → leave alone
      const fpath = path.join(full, f);
      let stat; try { stat = fs.statSync(fpath); } catch { continue; }
      const idleMin = (now - stat.mtimeMs) / 60000;
      if (idleMin < IDLE_MINUTES) {                              // still active → never touch it
        if (!prev) candidates.push({ sid, status: "active_skip", project: d.split("GitHub-").pop().split("Documents-").pop() });
        continue;
      }
      let p; try { p = parseTranscript(fpath); } catch { continue; }
      if (p.userTurns < MIN_USER_TURNS) { if (!prev) state.sessions[sid] = { skipped: "too_short" }; continue; }
      const project = d.split("GitHub-").pop().split("Documents-").pop();
      if (prev) {                                                // already captured — re-capture only if it grew
        const grew = p.userTurns > (prev.turns || 0);           // and only when we can delete the old node cleanly
        if (!grew || !SERVICE_KEY || !prev.fp) continue;
        candidates.push({ sid, p, project, ready: true, regrow: true, oldFp: prev.fp });
      } else {
        candidates.push({ sid, p, project, ready: true });
      }
    }
  }
  return candidates;
}

(async () => {
  if (!SUPABASE_URL || !BRAIN_KEY) { console.error("Missing SUPABASE_URL / MCP_ACCESS_KEY"); process.exit(1); }
  const state = loadState();
  const cands = scan(state);
  const ready = cands.filter((c) => c.ready);
  const active = cands.filter((c) => c.status === "active_skip");

  console.log(`Scanner — filter:${FILTER || "all"} | new finished sessions: ${ready.length} | active (skipped): ${active.length} | service_key:${SERVICE_KEY ? "yes(exact dates)" : "no(created_at=now)"}`);
  for (const c of ready) console.log(`  + ${(c.p.createdAt || "????").slice(0, 10)}  ${(c.p.title || c.project).slice(0, 46)}  [${c.project}]`);
  for (const c of active) console.log(`  ~ active, skipped: ${c.sid.slice(0, 8)} [${c.project}]`);

  if (!APPLY) { console.log(`\nDRY RUN. Re-run with --apply to capture.`); return; }

  let done = 0, fail = 0;
  for (const c of ready) {
    const content = formatTranscript(c.p, c.project);
    const fp = fingerprint(content);
    const cap = await captureViaMcp(content);
    if (!cap.ok) { console.log(`  ✗ ${(c.p.title || "").slice(0, 40)} — ${cap.detail}`); log(`fail session=${c.sid} ${cap.detail}`); fail++; continue; }
    // Re-capture of a grown session: drop the old node BEFORE patchDate stamps
    // session_id on the new one, so we only ever delete the stale copy.
    if (c.regrow) { const del = await deleteByFingerprint(c.oldFp); log(`regrow session=${c.sid} ${del.detail}`); }
    const meta = { source: "claude_code", source_date: c.p.createdAt, session_id: c.sid, project: c.project, claude_code_title: c.p.title };
    const patch = await patchDate(fp, c.p.createdAt, meta);
    state.sessions[c.sid] = { captured_at: new Date().toISOString(), date: c.p.createdAt, turns: c.p.userTurns, dated: patch.detail, fp };
    saveState(state);
    log(`captured session=${c.sid} project=${c.project} date=${c.p.createdAt} turns=${c.p.userTurns} dated=${patch.detail}${c.regrow ? " (regrow)" : ""}`);
    console.log(`  ${c.regrow ? "↻" : "✓"} ${(c.p.createdAt || "").slice(0, 10)}  ${(c.p.title || c.project).slice(0, 46)} (${patch.detail}, ${c.p.userTurns}t)`);
    done++;
  }
  saveState(state);
  console.log(`\nDone. captured: ${done} | failed: ${fail}`);
})();
