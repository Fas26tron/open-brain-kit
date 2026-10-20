#!/usr/bin/env node
/**
 * Open Brain — import a Claude.ai data export (date-preserving)
 *
 * The Chrome extension's "Sync All" only sees the conversations claude.ai lists
 * by default (recent, non-archived, outside projects). For the FULL history,
 * request the official export (claude.ai → Settings → Privacy → Export data),
 * unzip it, and point this script at the folder (or at conversations.json).
 *
 * Each conversation becomes ONE thought, formatted exactly like the extension's
 * sync (title + "Conversation created at" header + USER/ASSISTANT turns), sent
 * to the open-brain-rest `/ingest` endpoint with `source_date` so the thought
 * keeps the conversation's real date. The server deduplicates by content
 * fingerprint, and a local state file skips conversations already imported.
 *
 * Config (~/.open-brain/claude-code-capture/.env.local or env):
 *   SUPABASE_URL, MCP_ACCESS_KEY
 *
 * Usage:
 *   node import-claude-export.mjs <export-folder-or-conversations.json>            # dry run
 *   node import-claude-export.mjs <export-folder-or-conversations.json> --apply    # import
 *   ... --since 2025-01-01      # only conversations created on/after that date
 *   ... --min-messages 2        # skip conversations shorter than this (default 2)
 *
 * Long imports: ~3 s per conversation (server-side embedding). Run in a
 * terminal you can leave open; the state file makes re-runs resume where they stopped.
 */

import fs from "fs";
import path from "path";
import os from "os";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const target = args.find((a) => !a.startsWith("--"));
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SINCE = opt("--since", null);
const MIN_MESSAGES = Number(opt("--min-messages", "2"));

const MAX_CONTENT_CHARS = 24000;   // same cap as the Claude Code scanner
const SOURCE_TYPE = "claude_import"; // same source_type as the extension's Claude sync
const ROOT = path.join(os.homedir(), ".open-brain", "claude-code-capture");
const STATE_PATH = path.join(os.homedir(), ".open-brain", "import", "claude-export-state.json");

if (!target) {
  console.error("Usage: node import-claude-export.mjs <export-folder-or-conversations.json> [--apply] [--since YYYY-MM-DD]");
  process.exit(2);
}

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
const BRAIN_KEY = env.MCP_ACCESS_KEY || process.env.MCP_ACCESS_KEY || "";
if (!SUPABASE_URL || !BRAIN_KEY) {
  console.error(`Missing SUPABASE_URL / MCP_ACCESS_KEY (looked in ${path.join(ROOT, ".env.local")} and env).`);
  process.exit(2);
}
const INGEST_URL = `${SUPABASE_URL}/functions/v1/open-brain-rest/ingest`;

// ── load export ──
const jsonPath = fs.statSync(target).isDirectory() ? path.join(target, "conversations.json") : target;
const conversations = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
if (!Array.isArray(conversations)) {
  console.error(`${jsonPath} does not contain a conversations array.`);
  process.exit(2);
}

// ── state ──
let state = { imported: {} };
try { state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { /* first run */ }
function saveState() {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ── formatting (mirrors chrome-capture-extension/lib/sync-claude.js formatForIngest) ──
function messageText(msg) {
  if (typeof msg.text === "string" && msg.text.trim()) return msg.text;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c) => c && c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

function formatConversation(conv) {
  const name = conv.name || "(untitled)";
  const createdAt = conv.created_at || "";
  const lines = [`Conversation title: ${name}`, `Conversation created at: ${createdAt}`, ""];
  const messages = (conv.chat_messages || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  let count = 0;
  for (const msg of messages) {
    const text = messageText(msg).trim();
    if (!text) continue;
    const role = msg.sender === "human" ? "USER" : "ASSISTANT";
    lines.push(`${role}: ${text}`, "");
    count++;
  }
  let full = lines.join("\n").trim();
  if (full.length > MAX_CONTENT_CHARS) {
    // keep head + tail so both the opening question and the conclusion survive
    const head = full.slice(0, MAX_CONTENT_CHARS - 4000);
    const tail = full.slice(-3800);
    full = `${head}\n\n[... truncated ...]\n\n${tail}`;
  }
  return { text: full, messageCount: count, name, createdAt };
}

// ── plan ──
const plan = [];
let skippedState = 0, skippedShort = 0, skippedDate = 0;
for (const conv of conversations) {
  const uuid = conv.uuid || "";
  if (uuid && state.imported[uuid]) { skippedState++; continue; }
  if (SINCE && conv.created_at && conv.created_at.slice(0, 10) < SINCE) { skippedDate++; continue; }
  const f = formatConversation(conv);
  if (f.messageCount < MIN_MESSAGES) { skippedShort++; continue; }
  plan.push({ uuid, ...f });
}
plan.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

console.log(`Claude export: ${conversations.length} conversations | to import: ${plan.length} | already imported: ${skippedState} | too short: ${skippedShort} | before --since: ${skippedDate}`);
for (const p of plan.slice(0, 15)) console.log(`  ${String(p.createdAt).slice(0, 10)}  ${p.name.slice(0, 70)}  (${p.messageCount} msgs)`);
if (plan.length > 15) console.log(`  ... and ${plan.length - 15} more`);
if (!APPLY) { console.log("\nDry run. Add --apply to import."); process.exit(0); }

// ── import ──
let ok = 0, failed = 0;
for (const [i, p] of plan.entries()) {
  const payload = {
    text: p.text,
    source_type: SOURCE_TYPE,
    source_date: p.createdAt || undefined,
    source_label: "claude:export",
    source_metadata: {
      conversation_id: p.uuid,
      conversation_title: p.name,
      import: "claude_export",
    },
  };
  try {
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-brain-key": BRAIN_KEY },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
    const parsed = JSON.parse(body);
    if (p.uuid) state.imported[p.uuid] = { thought_id: parsed.thought_id || null, at: new Date().toISOString() };
    saveState();
    ok++;
    console.log(`[${i + 1}/${plan.length}] ok   ${String(p.createdAt).slice(0, 10)}  ${p.name.slice(0, 60)}`);
  } catch (err) {
    failed++;
    console.log(`[${i + 1}/${plan.length}] FAIL ${p.name.slice(0, 60)} — ${err.message}`);
  }
}
console.log(`\nDone. imported: ${ok} | failed: ${failed} | state: ${STATE_PATH}`);
