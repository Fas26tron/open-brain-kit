#!/usr/bin/env node
/**
 * Open Brain — Claude Code SessionEnd capture (MCP variant)
 *
 * Fires on Claude Code SessionEnd. Reads the real .jsonl transcript, extracts
 * the human/assistant turns, and captures the session as ONE raw thought via
 * the deployed `open-brain-mcp` Edge Function (tool: capture_thought).
 *
 * This is the v1 "capture everything raw" layer. It does NOT extract decisions
 * or atomise — that is the Conversation Curator's later job. Long sessions are
 * truncated (head+tail) to stay under the embedding token limit.
 *
 * All errors are caught and swallowed — must never block Claude Code shutdown.
 *
 * Config (env or PROJECT_ROOT/.env.local):
 *   SUPABASE_URL     e.g. https://<ref>.supabase.co
 *   MCP_ACCESS_KEY   the x-brain-key for the Edge Function
 * PROJECT_ROOT is OB_PROJECT_ROOT (where .env.local / logs / data live).
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "node:url";

// ── Configuration ───────────────────────────────────────────────────────────
const HARD_TIMEOUT_MS = 25000;
const MIN_USER_TURNS = 3;
const RETRY_MAX_ATTEMPTS = 5;
const RETRY_BATCH_SIZE = 3;
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 12000;
const PER_TURN_CHARS = 4000;     // cap a single turn so one dump can't dominate
const MAX_CONTENT_CHARS = 20000; // ~5k tokens, safely under the 8191 embed limit

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.OB_PROJECT_ROOT
  ? path.resolve(process.env.OB_PROJECT_ROOT)
  : SCRIPT_DIR;
const ENV_PATH = path.join(PROJECT_ROOT, ".env.local");
const LOG_DIR = path.join(PROJECT_ROOT, "logs");
const LOG_PATH = path.join(LOG_DIR, "ambient-capture.log");
const RETRY_QUEUE_DIR = path.join(PROJECT_ROOT, "data", "capture-retry-queue");
const RETRY_DEAD_DIR = path.join(RETRY_QUEUE_DIR, "dead");

// ── Hard timeout — guarantee exit ───────────────────────────────────────────
setTimeout(() => { appendLog("unknown", "unknown", 0, "hard_timeout_25s"); process.exit(0); }, HARD_TIMEOUT_MS);

// ── Env loading ─────────────────────────────────────────────────────────────
function loadEnv(envPath) {
  try {
    const vars = {};
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
      if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return vars;
  } catch { return {}; }
}

// ── Logging ─────────────────────────────────────────────────────────────────
function appendLog(sessionId, projectName, turns, disposition) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_PATH,
      `${new Date().toISOString()} session=${sessionId} project=${projectName} turns=${turns} disposition=${disposition}\n`);
  } catch { /* non-fatal */ }
}

// ── Transcript parsing (real Claude Code .jsonl) ─────────────────────────────
function extractText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && typeof p === "object" && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n")
      .trim();
  }
  return "";
}

function isNoiseHumanText(t) {
  // Skip slash-command echoes, tool-result-only turns, and system reminders that
  // are injected as "user" messages but aren't things the human actually typed.
  if (!t) return true;
  if (t.startsWith("<command-") || t.startsWith("<local-command")) return true;
  if (t.startsWith("[Request interrupted")) return true;
  if (t.startsWith("Caveat:") && t.length < 400) return true;
  return false;
}

function parseTranscript(transcriptPath) {
  const raw = fs.readFileSync(transcriptPath, "utf8");
  let sessionId = "unknown", title = "", cwd = "", gitBranch = "", createdAt = "";
  const turns = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let o; try { o = JSON.parse(s); } catch { continue; }
    if (o.isSidechain === true) continue; // skip subagent side conversations
    if (o.sessionId && sessionId === "unknown") sessionId = o.sessionId;
    if (o.cwd && !cwd) cwd = o.cwd;
    if (o.gitBranch && !gitBranch) gitBranch = o.gitBranch;
    if (o.timestamp && !createdAt) createdAt = o.timestamp;
    if (o.type === "ai-title" && o.aiTitle) title = o.aiTitle;
    const m = o.message;
    if (!m || typeof m !== "object") continue;
    if (o.type === "user" && m.role === "user") {
      const t = extractText(m.content);
      if (!isNoiseHumanText(t)) turns.push({ role: "human", content: t });
    } else if (o.type === "assistant" && m.role === "assistant") {
      const t = extractText(m.content);
      if (t) turns.push({ role: "assistant", content: t });
    }
  }
  const userTurns = turns.filter((t) => t.role === "human").length;
  return { sessionId, title, cwd, gitBranch, createdAt, turns, userTurns };
}

function escapeDelims(text) {
  return text
    .replace(/<thought_content>/gi, "<thought_content_escaped>")
    .replace(/<\/thought_content>/gi, "</thought_content_escaped>");
}

function clip(s, n) { return s.length > n ? s.slice(0, n) + " …[clipped]" : s; }

function formatTranscript(parsed, projectName) {
  const header = [
    `[Claude Code session] ${parsed.title || projectName}`,
    `Source: claude_code | Project: ${projectName}` + (parsed.gitBranch ? ` | Branch: ${parsed.gitBranch}` : ""),
    `Date: ${parsed.createdAt || new Date().toISOString()} | Human turns: ${parsed.userTurns}`,
    "---",
  ].join("\n");

  const body = parsed.turns
    .filter((t) => t.content.trim())
    .map((t) => `[${t.role}]\n${clip(escapeDelims(t.content), PER_TURN_CHARS)}`)
    .join("\n\n");

  let content = `${header}\n\n<thought_content>\n${body}\n</thought_content>`;
  // Truncate head+tail to stay under the embedding limit while keeping the
  // opening framing and the (usually decision-rich) ending.
  if (content.length > MAX_CONTENT_CHARS) {
    const head = content.slice(0, Math.floor(MAX_CONTENT_CHARS * 0.6));
    const tail = content.slice(-Math.floor(MAX_CONTENT_CHARS * 0.4));
    content = `${head}\n\n…[middle of session truncated for v1 capture]…\n\n${tail}`;
  }
  return content;
}

function buildImportKey(sessionId, text) {
  return `cc:${sessionId}:${crypto.createHash("sha256").update(text).digest("hex").slice(0, 8)}`;
}

// ── MCP capture call ─────────────────────────────────────────────────────────
async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

function parseMcpBody(text) {
  // StreamableHTTP returns SSE frames: a line beginning "data:" holds the JSON-RPC payload.
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (s.startsWith("data:")) {
      try { return JSON.parse(s.slice(5).trim()); } catch { /* keep scanning */ }
    }
  }
  try { return JSON.parse(text); } catch { return null; }
}

// Returns { ok, retryable, detail }
async function captureViaMcp(mcpUrl, key, content) {
  let res;
  try {
    res = await fetchWithTimeout(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "x-brain-key": key,
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "capture_thought", arguments: { content } },
      }),
    });
  } catch (err) {
    const isAbort = err?.name === "AbortError";
    return { ok: false, retryable: true, detail: isAbort ? `timeout_${FETCH_TIMEOUT_MS}ms` : `fetch:${err.message}` };
  }

  if (res.status !== 200) {
    return { ok: false, retryable: res.status >= 500 || res.status === 429, detail: `http_${res.status}` };
  }
  const body = parseMcpBody(await res.text().catch(() => ""));
  if (!body) return { ok: false, retryable: true, detail: "unparseable_body" };
  if (body.error) {
    // JSON-RPC transport error (e.g. unauthorized) — auth is permanent.
    const code = body.error.code;
    return { ok: false, retryable: code !== -32001, detail: `rpc_error_${code}` };
  }
  if (body.result?.isError) {
    // Tool-level failure (e.g. embedding too long, OpenRouter hiccup).
    const txt = (body.result.content?.[0]?.text || "tool_error").slice(0, 120);
    const transient = /timeout|temporarily|rate|503|502|overloaded/i.test(txt);
    return { ok: false, retryable: transient, detail: `tool:${txt}` };
  }
  const ok = (body.result?.content?.[0]?.text || "").slice(0, 120) || "captured";
  return { ok: true, retryable: false, detail: ok };
}

// ── Retry queue ───────────────────────────────────────────────────────────────
function ensureRetryDirs() { fs.mkdirSync(RETRY_QUEUE_DIR, { recursive: true }); fs.mkdirSync(RETRY_DEAD_DIR, { recursive: true }); }

function saveToRetryQueue(content, sessionId, detail) {
  try {
    ensureRetryDirs();
    const safe = (sessionId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
    fs.writeFileSync(path.join(RETRY_QUEUE_DIR, `${Date.now()}-${safe}.json`),
      JSON.stringify({ content, session_id: sessionId, failed_at: new Date().toISOString(), error: String(detail), attempt_count: 1 }, null, 2));
  } catch (e) { console.error(`[retry-queue] ${e.message}`); }
}

async function processRetryQueue(mcpUrl, key) {
  let files;
  try { ensureRetryDirs(); files = fs.readdirSync(RETRY_QUEUE_DIR).filter((f) => f.endsWith(".json")); }
  catch { return; }
  if (!files.length) return;
  files.sort();
  for (const file of files.slice(0, RETRY_BATCH_SIZE)) {
    const fp = path.join(RETRY_QUEUE_DIR, file);
    let entry; try { entry = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { fs.renameSync(fp, path.join(RETRY_DEAD_DIR, file)); continue; }
    const r = await captureViaMcp(mcpUrl, key, entry.content);
    if (r.ok) { fs.unlinkSync(fp); continue; }
    entry.attempt_count = (entry.attempt_count || 1) + 1;
    entry.error = r.detail;
    if (!r.retryable || entry.attempt_count >= RETRY_MAX_ATTEMPTS) {
      fs.writeFileSync(fp, JSON.stringify(entry, null, 2));
      fs.renameSync(fp, path.join(RETRY_DEAD_DIR, file));
    } else {
      fs.writeFileSync(fp, JSON.stringify(entry, null, 2));
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  let input;
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (err) { appendLog("unknown", "unknown", 0, `error:stdin:${err.message}`); process.exit(0); }

  const { transcript_path, session_id, cwd, reason } = input;
  const projectName = cwd ? path.basename(cwd) : "unknown";

  if (reason === "clear" || reason === "resume") { appendLog(session_id || "unknown", projectName, 0, `skipped:reason_${reason}`); process.exit(0); }
  if (!transcript_path || !fs.existsSync(transcript_path)) { appendLog(session_id || "unknown", projectName, 0, "skipped:no_transcript"); process.exit(0); }

  let parsed;
  try { parsed = parseTranscript(transcript_path); }
  catch (err) { appendLog(session_id || "unknown", projectName, 0, `error:parse:${err.message}`); process.exit(0); }

  if (parsed.userTurns < MIN_USER_TURNS) { appendLog(parsed.sessionId, projectName, parsed.userTurns, "skipped:too_short"); process.exit(0); }

  const content = formatTranscript(parsed, projectName);

  const env = loadEnv(ENV_PATH);
  const supabaseUrl = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = env.MCP_ACCESS_KEY || process.env.MCP_ACCESS_KEY;
  if (!supabaseUrl || !key) { appendLog(parsed.sessionId, projectName, parsed.userTurns, "error:missing_env"); process.exit(0); }
  const mcpUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/open-brain-mcp`;

  await processRetryQueue(mcpUrl, key);

  const r = await captureViaMcp(mcpUrl, key, content);
  if (r.ok) {
    appendLog(parsed.sessionId, projectName, parsed.userTurns, `captured:${r.detail}`);
  } else if (r.retryable) {
    appendLog(parsed.sessionId, projectName, parsed.userTurns, `error:${r.detail}:queued`);
    saveToRetryQueue(content, parsed.sessionId, r.detail);
  } else {
    appendLog(parsed.sessionId, projectName, parsed.userTurns, `error:${r.detail}:permanent`);
  }
  process.exit(0);
}

main().catch((err) => { appendLog("unknown", "unknown", 0, `error:main:${err.message}`); process.exit(0); });
