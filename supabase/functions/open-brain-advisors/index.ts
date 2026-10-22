/**
 * open-brain-advisors — domains, chief of staff, sparring partner and a panel
 * of personas, served from the brain itself so that every MCP client (Claude
 * web/desktop/mobile, ChatGPT, Claude Code) can define them, ask them and read
 * their answers. A nightly job classifies new thoughts into domains, distills
 * them into the sparring partner's profile and updates the chief of staff's
 * project state.
 *
 * Domains partition the memory ("Artinary & Arts Lab", "Personal life", …).
 *   - every thought carries the domains it belongs to (nightly classification,
 *     correctable); unclassified = the default domain
 *   - a persona is bound to ONE domain and only sees thoughts whose domains
 *     are ALL allowed (strict rule); plus its source / sensitivity filters
 *   - the chief of staff is global; each project belongs to a domain
 *   - the sparring partner is global and sees everything; a domain can frame
 *     an answer without blinding it
 *
 * MCP tools
 *   list_domains, set_domain, delete_domain, set_thought_domains, classify_domains
 *   list_personas, set_persona, delete_persona
 *   ask_persona, ask_panel, ask_sparring
 *   get_profile, set_profile, reset_cursor
 *   list_projects, set_projects, etat_des_lieux
 *   forget, run_nightly
 *
 * HTTP (for the scheduled job): POST /jobs/nightly  {kind?: "classify"|"sparring"|"chief_of_staff"}
 *
 * Auth: ?key= or x-access-key / x-brain-key header = MCP_ACCESS_KEY.
 * Secrets: OPENROUTER_API_KEY, MCP_ACCESS_KEY, optional ADVISORS_MODEL,
 *          ADVISORS_CLASSIFIER_MODEL, ADVISORS_LANGUAGE.
 */

import { Hono, type Context } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY") || "";
const DEFAULT_MODEL = Deno.env.get("ADVISORS_MODEL") || "anthropic/claude-sonnet-5.5";
const CLASSIFIER_MODEL = Deno.env.get("ADVISORS_CLASSIFIER_MODEL") || "anthropic/claude-haiku-5.5";
const DEFAULT_LANGUAGE = Deno.env.get("ADVISORS_LANGUAGE") || "fr";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const VERSION = "1.1.0";
const CHUNK = 30;           // thoughts per nightly extraction step
const CLASSIFY_BATCH = 40;  // thoughts per classification step

const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Access = {
  source_types: string[] | null;
  exclude_sensitivity: string[];
  since_days: number | null;
  max_facts: number;
};

type Persona = {
  id: string;
  slug: string;
  name: string;
  kind: "persona" | "sparring" | "chief_of_staff";
  description: string;
  seeks: string;
  says_no: string;
  says_yes: string;
  knows: string;
  does_not_know: string;
  access: Access;
  model: string | null;
  language: string;
  enabled: boolean;
  domain: string | null;
};

type Domain = {
  id: string;
  slug: string;
  name: string;
  description: string;
  keywords: string[];
  is_default: boolean;
};

type Fact = {
  id: string;
  content: string;
  created_at: string;
  source_type: string | null;
  sensitivity_tier: string | null;
  type: string | null;
  domains?: string[];
};

type Project = {
  name: string;
  type: "stratégique" | "autonome";
  domain?: string;
  folder?: string;
  watch?: string;
  status?: string;
  last_activity?: string | null;
  next?: string;
  updated_at?: string;
};

type CosData = {
  projects: Project[];
  proposed: { name: string; reason: string; seen_at: string; domain?: string }[];
  last_report?: string;
  last_report_at?: string;
};

/** Domain filter applied to retrieval: strict = all of the thought's domains must be allowed; overlap = any. */
type DomainFilter = { strict?: string[]; overlap?: string[] };

const DEFAULT_ACCESS: Access = {
  source_types: null,
  exclude_sensitivity: ["restricted", "private"],
  since_days: null,
  max_facts: 12,
};

const SPARRING_ACCESS: Access = { source_types: null, exclude_sensitivity: [], since_days: null, max_facts: 16 };

// ─────────────────────────────────────────────────────────────────────────────
// LLM helpers (OpenRouter)
// ─────────────────────────────────────────────────────────────────────────────

async function chat(model: string, system: string, user: string, json = false, maxTokens = 2000): Promise<string> {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured");
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  };
  if (json) body.response_format = { type: "json_object" };
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = await r.text();
    // OpenRouter keeps long non-streaming calls alive with whitespace / comment
    // lines before the JSON document: parse from the first brace.
    const start = raw.indexOf("{");
    let data: any = null;
    if (start >= 0) { try { data = JSON.parse(raw.slice(start)); } catch { /* non-JSON */ } }
    const msg = data?.choices?.[0]?.message;
    let text: string | null = typeof msg?.content === "string" ? msg.content : null;
    if (!text && Array.isArray(msg?.content)) {
      text = msg.content.filter((b: any) => b && b.type === "text" && typeof b.text === "string").map((b: any) => b.text).join("\n");
    }
    if (r.ok && text && text.trim()) return text;
    const finish = data?.choices?.[0]?.finish_reason || data?.choices?.[0]?.native_finish_reason || "";
    lastErr = `${r.status} ${data?.error?.message || data?.choices?.[0]?.error?.message || (finish ? `finish_reason=${finish}` : raw.replace(/\s+/g, " ").slice(0, 200))}`.trim();
    // Empty content with finish_reason=length: the model spent the budget on
    // reasoning tokens before writing. Double the budget and retry.
    if (r.ok && !text && finish === "length") { body.max_tokens = Number(body.max_tokens) * 2; continue; }
    if (r.status === 429 || r.status >= 500 || (r.ok && !text)) { await new Promise((res) => setTimeout(res, 1500 * (attempt + 1))); continue; }
    break;
  }
  throw new Error(`LLM call failed (${model}): ${lastErr}`);
}

function parseJson(text: string): any {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

async function getEmbedding(text: string): Promise<number[]> {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured");
  let input = text.length > 20000 ? text.slice(0, 20000) : text;
  let lastErr = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/text-embedding-3-small", input }),
    });
    const raw = await r.text();
    let data: any = null;
    try { data = JSON.parse(raw); } catch { /* ignore */ }
    const emb = data?.data?.[0]?.embedding;
    if (r.ok && Array.isArray(emb)) return emb;
    lastErr = `${r.status} ${data?.error?.message || raw}`.slice(0, 200);
    if (input.length > 500) { input = input.slice(0, Math.floor(input.length / 2)); continue; }
    break;
  }
  throw new Error(`embedding failed: ${lastErr}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Domains
// ─────────────────────────────────────────────────────────────────────────────

async function listDomains(): Promise<Domain[]> {
  const { data, error } = await supabase.from("advisor_domains").select("*").order("is_default", { ascending: false }).order("name");
  if (error) throw new Error(error.message);
  return (data || []) as Domain[];
}

async function defaultDomain(): Promise<Domain> {
  const all = await listDomains();
  const d = all.find((x) => x.is_default) || all[0];
  if (!d) throw new Error("No domain defined. Run the domains migration (it seeds the default domain) or set_domain.");
  return d;
}

function slugify(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Classify up to `limit` thoughts into domains. `reclassify` re-does already tagged ones (newest first).
 *  The model answers with the thoughts' INDEX (1..n), never their UUID, to keep the output short and
 *  cheap; a truncated or unparsable answer tags nothing (never silently defaults). */
async function classifyBatch(limit = CLASSIFY_BATCH, reclassify = false): Promise<{ done: number; remaining: boolean; counts: Record<string, number> }> {
  const domains = await listDomains();
  const def = domains.find((d) => d.is_default) || domains[0];
  if (!def) throw new Error("No domain defined.");
  let q = supabase.from("thoughts").select("id, content, source_type, created_at, domains").not("source_type", "in", '("chief_of_staff")').order("created_at", { ascending: false }).limit(limit);
  if (!reclassify) q = q.eq("domains", "{}");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data || []) as Fact[];
  const counts: Record<string, number> = {};
  if (!rows.length) return { done: 0, remaining: false, counts };
  const working = domains.filter((d) => !d.is_default);
  const valid = new Set(domains.map((d) => d.slug));
  let assignments: Record<string, string[]> = {};
  if (working.length) {
    const sys = `Tu classes des notes et conversations d'une personne dans ses DOMAINES. Domaines possibles :\n${working.map((d) => `- "${d.slug}" : ${d.name}. ${d.description}${d.keywords?.length ? ` Mots-clés : ${d.keywords.join(", ")}.` : ""}`).join("\n")}\n- "${def.slug}" : ${def.name} (par défaut) — tout ce qui ne relève clairement d'aucun domaine ci-dessus.\nRègles : une note peut appartenir à plusieurs domaines si elle mêle vraiment plusieurs sujets ; en cas de doute, le domaine par défaut ; ne mets jamais un domaine de travail sur une note purement personnelle. Les notes sont numérotées de 1 à ${rows.length}. Renvoie un JSON strict et COMPACT : {"1":["slug"],"2":["slug","slug"],...} avec exactement une entrée par numéro, rien d'autre.`;
    const user = rows.map((r, i) => `#${i + 1} [${(r.created_at || "").slice(0, 10)}] (${r.source_type || "?"}) ${r.content.replace(/\s+/g, " ").slice(0, 320)}`).join("\n");
    const out = await chat(CLASSIFIER_MODEL, sys, user, true, 2500);
    const parsed = parseJson(out);
    if (!parsed || typeof parsed !== "object") throw new Error("classifier answer unparsable; nothing tagged");
    assignments = parsed;
    const answered = Object.keys(assignments).length;
    if (answered < rows.length * 0.8) throw new Error(`classifier answered ${answered}/${rows.length} (truncated?); nothing tagged`);
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let ds = Array.isArray(assignments[String(i + 1)]) ? assignments[String(i + 1)].filter((s: unknown) => typeof s === "string" && valid.has(s)) : [];
    if (!ds.length) ds = [def.slug];
    ds = [...new Set(ds)];
    const { error: e } = await supabase.from("thoughts").update({ domains: ds }).eq("id", r.id);
    if (e) throw new Error(e.message);
    for (const s of ds) counts[s] = (counts[s] || 0) + 1;
  }
  return { done: rows.length, remaining: rows.length >= limit, counts };
}

// ─────────────────────────────────────────────────────────────────────────────
// Data helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeAccess(a: unknown, base: Access): Access {
  const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
  return {
    source_types: Array.isArray(o.source_types) && o.source_types.length ? (o.source_types as string[]) : base.source_types,
    exclude_sensitivity: Array.isArray(o.exclude_sensitivity) ? (o.exclude_sensitivity as string[]) : base.exclude_sensitivity,
    since_days: typeof o.since_days === "number" ? o.since_days : base.since_days,
    max_facts: typeof o.max_facts === "number" ? Math.max(1, Math.min(40, o.max_facts)) : base.max_facts,
  };
}

async function listPersonas(): Promise<Persona[]> {
  const { data, error } = await supabase.from("advisor_personas").select("*").order("kind").order("name");
  if (error) throw new Error(error.message);
  return (data || []) as Persona[];
}

async function getPersona(slug: string): Promise<Persona | null> {
  const { data } = await supabase.from("advisor_personas").select("*").eq("slug", slug).maybeSingle();
  return (data as Persona) || null;
}

async function ensureSpecial(kind: "sparring" | "chief_of_staff"): Promise<Persona> {
  const { data } = await supabase.from("advisor_personas").select("*").eq("kind", kind).limit(1).maybeSingle();
  if (data) return data as Persona;
  const row = kind === "sparring"
    ? {
      slug: "sparring", name: "Sparring partner", kind,
      description: "Un pair qui a lu tout le dossier et qui dit où il diverge et pourquoi. Il connaît la personne : ses positions datées, ses revirements, ses réactions, ses forces et ses faiblesses.",
      seeks: "Rendre les décisions explicites, datées et testables.",
      says_no: "", says_yes: "", knows: "Tout ce que le brain contient, et le profil distillé de la personne.", does_not_know: "",
      access: SPARRING_ACCESS, language: DEFAULT_LANGUAGE, domain: null,
    }
    : {
      slug: "chief-of-staff", name: "Chief of staff", kind,
      description: "Suit les projets de la personne : ce qui avance, ce qui attend une décision, où les choses sont rangées, ce dont elle s'éloigne.",
      seeks: "Qu'aucun projet ne soit abandonné par oubli.",
      says_no: "", says_yes: "", knows: "Les captures du brain, projet par projet.", does_not_know: "",
      access: { ...DEFAULT_ACCESS, max_facts: 8 }, language: DEFAULT_LANGUAGE, domain: null,
    };
  const { data: created, error } = await supabase.from("advisor_personas").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  return created as Persona;
}

async function currentProfile(kind: "sparring" | "chief_of_staff") {
  const { data } = await supabase.from("advisor_profiles").select("*").eq("kind", kind).order("version", { ascending: false }).limit(1).maybeSingle();
  return data as { id: string; version: number; content: string; data: any; thought_cursor: string | null; distilled_at: string | null } | null;
}

async function writeProfile(kind: "sparring" | "chief_of_staff", content: string, data: unknown, cursor: string | null, distilled: boolean) {
  const cur = await currentProfile(kind);
  const row = {
    kind,
    version: (cur?.version || 0) + 1,
    content,
    data: data ?? cur?.data ?? {},
    thought_cursor: cursor ?? cur?.thought_cursor ?? null,
    distilled_at: distilled ? new Date().toISOString() : cur?.distilled_at ?? null,
  };
  const { error } = await supabase.from("advisor_profiles").insert(row);
  if (error) throw new Error(error.message);
  return row.version;
}

/** Semantic retrieval from `thoughts`, filtered by an access policy and an optional domain filter. */
async function facts(query: string, access: Access, domain?: DomainFilter, limit?: number): Promise<Fact[]> {
  const emb = await getEmbedding(query);
  const { data, error } = await supabase.rpc("match_thoughts", {
    query_embedding: emb, match_threshold: 0.3, match_count: 60, filter: {},
  });
  if (error) throw new Error(error.message);
  const ids = (data || []).map((r: any) => r.id);
  if (!ids.length) return [];
  let q = supabase.from("thoughts").select("id, content, created_at, source_type, sensitivity_tier, type, domains").in("id", ids);
  if (access.source_types) q = q.in("source_type", access.source_types);
  if (access.exclude_sensitivity.length) {
    q = q.or(`sensitivity_tier.is.null,sensitivity_tier.not.in.(${access.exclude_sensitivity.map((s) => `"${s}"`).join(",")})`);
  }
  if (access.since_days) q = q.gte("created_at", new Date(Date.now() - access.since_days * 86400000).toISOString());
  if (domain?.strict?.length) {
    // all of the thought's domains must be allowed, and unclassified thoughts
    // (empty array = default domain) are excluded unless the default is allowed
    q = q.containedBy("domains", domain.strict);
    const def = await defaultDomain().catch(() => null);
    if (!def || !domain.strict.includes(def.slug)) q = q.not("domains", "eq", "{}");
  }
  if (domain?.overlap?.length) q = q.overlaps("domains", domain.overlap);
  const { data: rows, error: e2 } = await q;
  if (e2) throw new Error(e2.message);
  const order = new Map<string, number>(ids.map((id: string, i: number) => [id, i] as [string, number]));
  const sorted = ((rows || []) as Fact[]).sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  return sorted.slice(0, limit ?? access.max_facts);
}

function formatFacts(list: Fact[], maxChars = 700): string {
  if (!list.length) return "(aucun fait trouvé dans le brain sur ce sujet)";
  return list.map((f) => `- [${f.created_at.slice(0, 10)}] (${f.source_type || "?"}${f.domains?.length ? `, ${f.domains.join("+")}` : ""}) ${f.content.replace(/\s+/g, " ").slice(0, maxChars)}`).join("\n");
}

function langName(code: string) {
  return ({ fr: "français", en: "English", es: "español", de: "Deutsch", it: "italiano", pt: "português" } as Record<string, string>)[code] || code;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persona / sparring / panel
// ─────────────────────────────────────────────────────────────────────────────

function personaSystem(p: Persona, domainName: string | null): string {
  return `Tu joues ${p.name}. ${p.description}
Ce que tu cherches ou protèges : ${p.seeks || "non précisé"}.
Ce qui te fait dire non : ${p.says_no || "non précisé"}.
Ce qui te fait dire oui : ${p.says_yes || "non précisé"}.
${p.knows ? `Ce que tu sais : ${p.knows}.` : ""}
${p.does_not_know ? `Ce que tu NE sais PAS et ne dois pas supposer : ${p.does_not_know}.` : ""}
${domainName ? `Ton champ : ${domainName}. Tu ignores tout de la vie de la personne hors de ce champ.` : ""}
Tu ne connais du projet que les faits datés fournis ci-dessous. Tu réponds dans ton rôle, à la première personne, en ${langName(p.language)}, sans flatterie ni formule d'encouragement, en trois parties titrées :
1. Ma position (cinq à dix lignes, chiffrée quand c'est possible)
2. Les trois questions que je poserais
3. Ce qui me ferait changer d'avis`;
}

async function askPersona(p: Persona, question: string, frameDomain?: string): Promise<string> {
  const model = p.model || DEFAULT_MODEL;
  if (p.kind === "sparring") {
    const found = await facts(question, SPARRING_ACCESS, frameDomain ? { overlap: [frameDomain] } : undefined);
    return askSparring(p, question, found, model, frameDomain);
  }
  const access = normalizeAccess(p.access, DEFAULT_ACCESS);
  const domains = await listDomains();
  const dom = p.domain ? domains.find((d) => d.slug === p.domain) : null;
  const found = await facts(question, access, dom ? { strict: [dom.slug] } : undefined);
  const user = `Faits établis, extraits du brain de la personne (datés, les plus récents font foi) :\n${formatFacts(found)}\n\nQuestion qui t'est posée :\n${question}`;
  return chat(model, personaSystem(p, dom?.name || null), user, false, 2500);
}

async function askSparring(p: Persona, question: string, found: Fact[], model: string, frameDomain?: string): Promise<string> {
  const prof = await currentProfile("sparring");
  const profile = prof?.content?.trim() ? prof.content : "(profil pas encore distillé : réponds à partir des faits seulement et dis-le en une ligne)";
  const frame = frameDomain ? `\nCadre de la question : le domaine « ${frameDomain} ». Réponds dans ce cadre, mais sers-toi de tout ce que tu sais des autres domaines quand cela éclaire la décision (une contradiction, une contrainte, un engagement pris ailleurs).` : "";
  const system = `Tu es le sparring partner de la personne : un pair qui a lu tout le dossier, qui la connaît, et qui dit où il diverge et pourquoi. Tu n'es ni un coach ni un professeur. ${p.description}
Règles :
- Commence par le point qui compte. S'il y a une contradiction avec une position antérieure du profil, c'est ce point : cite-la avec sa date et demande ce qui a changé, sans supposer la réponse.
- Chiffre. Une recommandation, pas un éventail. Propose le test le moins cher qui tranche.
- Sépare ce qui est établi (fait, mesure), ce qui est son hypothèse (datée), et ce qui est une sortie de modèle. Quand tu la rejoins, dis sur quelle preuve ; quand tu diverges, dis-le d'abord.
- Le profil décrit ses forces, ses faiblesses, ses réactions : sers-t'en pour la challenger avec précision, jamais pour la commenter. Sur les sujets personnels, reste factuel, dans ses mots, et seulement si elle les amène.
- Ton neutre, pas de pédagogie, pas de questions dont tu connais la réponse. Termine par une question fermée : « acceptée, rejetée, ou plus tard ? »
- Réponds en ${langName(p.language)}.${frame}

PROFIL DE LA PERSONNE (distillé de ses conversations, confidentiel) :
${profile}`;
  const user = `Matière récente du brain (datée) :\n${formatFacts(found, 900)}\n\nCe que la personne te dit aujourd'hui :\n${question}`;
  return chat(model, system, user, false, 3000);
}

async function askPanel(question: string, slugs?: string[], domain?: string): Promise<string> {
  let personas = (await listPersonas()).filter((p) => p.enabled && p.kind === "persona");
  if (slugs?.length) personas = personas.filter((p) => slugs.includes(p.slug));
  if (domain) personas = personas.filter((p) => p.domain === domain);
  if (!personas.length) return "Aucune persona pour ce panel. Crée-en avec set_persona (par exemple : investisseur, expert-comptable, salarié), en précisant son domaine.";
  const answers = await Promise.all(personas.map(async (p) => {
    try { return { p, text: await askPersona(p, question) }; } catch (e) { return { p, text: `(erreur : ${e instanceof Error ? e.message : String(e)})` }; }
  }));
  const blocks = answers.map((a) => `## ${a.p.name}${a.p.domain ? ` (${a.p.domain})` : ""}\n${a.text}`).join("\n\n");
  let synthesis = "";
  try {
    synthesis = await chat(
      DEFAULT_MODEL,
      `Tu lis les réponses de plusieurs personae à la même question. En ${langName(personas[0].language)}, en huit lignes au plus : où elles divergent, ce que ce désaccord révèle sur la décision, et la question que la personne doit trancher en premier. Pas de résumé des réponses, pas de flatterie.`,
      `Question : ${question}\n\n${blocks}`,
      false,
      1200,
    );
  } catch (e) { synthesis = `(synthèse indisponible : ${e instanceof Error ? e.message : String(e)})`; }
  return `${blocks}\n\n## Ce que le panel révèle\n${synthesis}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chief of staff
// ─────────────────────────────────────────────────────────────────────────────

async function cosData(): Promise<CosData> {
  const prof = await currentProfile("chief_of_staff");
  const d = (prof?.data || {}) as Partial<CosData>;
  return { projects: Array.isArray(d.projects) ? d.projects : [], proposed: Array.isArray(d.proposed) ? d.proposed : [], last_report: d.last_report, last_report_at: d.last_report_at };
}

async function etatDesLieux(domain?: string): Promise<string> {
  const cos = await ensureSpecial("chief_of_staff");
  const data = await cosData();
  const projects = domain ? data.projects.filter((p) => p.domain === domain) : data.projects;
  if (!projects.length) return domain ? `Aucun projet déclaré dans le domaine « ${domain} ». set_projects pour en déclarer.` : "Aucun projet déclaré. Utilise set_projects pour en déclarer (nom, domaine, type stratégique ou autonome, dossier optionnel, ce qu'il faut surveiller). Le job nocturne proposera ensuite ceux qu'il voit apparaître dans le brain.";
  const access = normalizeAccess(cos.access, DEFAULT_ACCESS);
  const domains = await listDomains();
  const dname = (s?: string) => domains.find((d) => d.slug === s)?.name || s || "sans domaine";
  const perProject = await Promise.all(projects.map(async (pr) => {
    const f = await facts(`${pr.name} ${pr.watch || ""}`, { ...access, since_days: 45 }, pr.domain ? { overlap: [pr.domain] } : undefined, 6).catch(() => [] as Fact[]);
    return { pr, f };
  }));
  const today = new Date().toISOString().slice(0, 10);
  const groups = [...new Set(projects.map((p) => p.domain || ""))];
  const user = groups.map((g) =>
    `# DOMAINE : ${dname(g || undefined)}\n` + perProject.filter(({ pr }) => (pr.domain || "") === g).map(({ pr, f }) =>
      `### ${pr.name} — ${pr.type}${pr.folder ? ` — ${pr.folder}` : " — sans dossier"}\nÉtat connu : ${pr.status || "inconnu"} | dernière activité notée : ${pr.last_activity || "?"} | attend : ${pr.next || "?"}\nFaits récents :\n${formatFacts(f, 500)}`
    ).join("\n\n")
  ).join("\n\n") + (data.proposed.length && !domain ? `\n\nProjets vus dans le brain mais non déclarés : ${data.proposed.map((p) => `${p.name}${p.domain ? ` (${p.domain})` : ""}`).join(", ")}` : "");
  const system = `Tu es le chief of staff de la personne. Tu produis un état des lieux daté du ${today}, en ${langName(cos.language)}, entre 400 et 900 mots, avec exactement cette structure :
# État des lieux — ${today}${domain ? ` — ${dname(domain)}` : ""}
${groups.length > 1 ? "## <un titre de niveau 2 par domaine, puis> " : ""}### <un titre par projet, avec son dossier ou « sans dossier »>  (où il en est en deux ou trois phrases datées ; « Dernière activité : date (source) » ; « Attend : la prochaine décision ou action, et de qui »)
## Bloqué sur toi  (décisions que seule la personne peut prendre, projet par projet ; sinon « rien »)
## Ce dont tu t'éloignes  (projets stratégiques sans activité depuis plus de trois semaines, avec la durée ; sinon « rien »)
## Où sont rangées les choses  (seulement ce qui risque de se perdre)
Règles : dates partout ; en cas de contradiction la plus récente fait foi ; ne rien inventer, un projet sans trace se signale « aucune trace depuis <date> » ; pas de flatterie.`;
  const report = await chat(cos.model || DEFAULT_MODEL, system, user, false, 4000);
  const prof = await currentProfile("chief_of_staff");
  await writeProfile("chief_of_staff", prof?.content || "", { ...data, last_report: report, last_report_at: new Date().toISOString() }, null, false);
  try {
    const content = `État chief of staff — ${today}${domain ? ` — ${dname(domain)}` : ""}\n\n${report}`;
    const up = await supabase.rpc("upsert_thought", { p_content: content, p_payload: { metadata: { source: "chief_of_staff", source_type: "chief_of_staff", type: "status" } } });
    const id = up.data?.id;
    if (id) {
      const emb = await getEmbedding(content).catch(() => null);
      await supabase.from("thoughts").update({ source_type: "chief_of_staff", type: "status", domains: domain ? [domain] : [], ...(emb ? { embedding: emb } : {}) }).eq("id", id);
    }
  } catch { /* the report is still returned */ }
  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// Nightly distillation
// ─────────────────────────────────────────────────────────────────────────────

async function newThoughtsSince(cursor: string | null, max: number): Promise<Fact[]> {
  let q = supabase.from("thoughts").select("id, content, created_at, source_type, sensitivity_tier, type, domains")
    .not("source_type", "in", '("chief_of_staff")')
    .order("created_at", { ascending: true }).limit(max);
  if (cursor) q = q.gt("created_at", cursor);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []) as Fact[];
}

const PROFILE_SKELETON = `# Profil — sparring partner

## 1. Situation (faits datés)
## 2. Qui est la personne (rôles, expérience, façon de décider, forces, faiblesses, ce qu'elle dit d'elle-même)
## 3. Thèse et positions par domaine (datées)
## 4. Hypothèses chiffrées (valeur, date, statut, comment la confronter)
## 5. Décisions en vigueur
## 6. Revirements (position antérieure → nouvelle, ce qui a changé ou « non expliqué »)
## 7. Questions ouvertes
## 8. Comment la challenger (réactions observées, corrections faites, règles qui en découlent)
## 9. Idées abandonnées
## 10. Journal des mises à jour`;

// Each nightly call must stay well under the Edge Function wall-clock limit, so
// a call does ONE bounded step: either extract a delta from the next chunk of
// thoughts (stored as pending in the profile data), or, when no new thoughts
// remain and deltas are pending, merge them into the profile as a line patch.
// The scheduled workflow calls again while `remaining` is true.

async function nightlySparring(): Promise<{ read: number; remaining: boolean; summary: string }> {
  const sp = await ensureSpecial("sparring");
  const prof = await currentProfile("sparring");
  const cursor = prof?.thought_cursor || null;
  const data = (prof?.data && typeof prof.data === "object" ? prof.data : {}) as { pending?: string[] };
  const pending: string[] = Array.isArray(data.pending) ? data.pending : [];
  const model = sp.model || DEFAULT_MODEL;
  const lang = langName(sp.language);
  const batch = await newThoughtsSince(cursor, CHUNK);

  if (batch.length) {
    const user = batch.map((f) => `[${f.created_at.slice(0, 16)}] (${f.source_type || "?"}${f.domains?.length ? `, domaine ${f.domains.join("+")}` : ""})\n${f.content.replace(/\s+/g, " ").slice(0, 1500)}`).join("\n\n");
    const d = await chat(model, `Tu distilles les nouvelles conversations d'une personne pour nourrir le profil de son sparring partner. En ${lang}, renvoie UNIQUEMENT ce qui vaut la peine d'être retenu durablement, en JSON strict : {"positions":[{"date","statement","domain"}],"reversals":[{"date","from","to","why"}],"reactions":[{"date","accepted_or_rejected","what","rule"}],"traits":[{"date","observation"}],"decisions":[{"date","statement","domain"}],"open_questions":[{"date","question","domain"}]}. "domain" = le domaine indiqué sur la conversation. Les conversations mêlent ce que la personne a dit et ce qu'un assistant a proposé : n'attribue à la personne que ses propres mots. Listes vides si rien.`, user, true, 2500);
    const newCursor = batch[batch.length - 1].created_at;
    const v = await writeProfile("sparring", prof?.content || "", { ...data, pending: [...pending, d] }, newCursor, false);
    return { read: batch.length, remaining: true, summary: `v${v}, ${batch.length} thoughts extraits jusqu'au ${newCursor.slice(0, 16)} (${pending.length + 1} delta(s) en attente de fusion)` };
  }
  if (!pending.length) return { read: 0, remaining: false, summary: "rien de nouveau" };

  const base = prof?.content?.trim() ? prof.content : PROFILE_SKELETON;
  const headings = base.split("\n").filter((l) => /^#{2,3} /.test(l));
  const out = await chat(model, `Tu tiens à jour le profil d'une personne pour son sparring partner, en ${lang}. On te donne les TITRES de section du profil actuel et des deltas extraits de ses conversations récentes. Renvoie un JSON strict : {"patches":[{"heading":"<titre exact, copié de la liste>","lines":["- AAAA-MM-JJ — [domaine] …"]}],"journal":"- AAAA-MM-JJ — une ligne qui résume cette mise à jour"}. Règles : une ligne par élément, datée, avec le domaine entre crochets quand il est connu, factuelle, dans les mots de la personne quand c'est une position ; une position qui contredit une position connue va dans la section des revirements ; une correction ou un rejet va dans la section « comment la challenger » avec la citation ; n'écris rien qui ne vienne pas des deltas ; pas de doublon évident ; listes vides si rien. Seuls les titres de la liste sont valides.`, `TITRES :\n${headings.join("\n")}\n\nDELTAS :\n${pending.join("\n")}`, true, 2500);
  const patch = parseJson(out) || {};
  const lines = base.split("\n");
  let applied = 0;
  const norm = (s: string) => s.replace(/^#+\s*/, "").trim().toLowerCase();
  const patches: { heading: string; lines: string[] }[] = Array.isArray(patch.patches) ? patch.patches : [];
  if (typeof patch.journal === "string" && patch.journal.trim()) {
    const jh = headings.filter((h) => /journal/i.test(h)).pop() || "## Journal des mises à jour";
    patches.push({ heading: jh, lines: [patch.journal] });
  }
  for (const p of patches) {
    if (!p || typeof p.heading !== "string" || !Array.isArray(p.lines) || !p.lines.length) continue;
    const idx = lines.findIndex((l) => /^#{2,3} /.test(l) && norm(l) === norm(p.heading));
    const add = p.lines.filter((x: unknown) => typeof x === "string" && x.trim()).map((x: string) => (x.startsWith("-") ? x : `- ${x}`));
    if (!add.length) continue;
    if (idx < 0) { lines.push("", `## ${p.heading.replace(/^#+\s*/, "")}`, ...add); applied += add.length; continue; }
    const level = (lines[idx].match(/^#+/) || ["##"])[0].length;
    let end = idx + 1;
    while (end < lines.length && !(new RegExp(`^#{1,${level}} `).test(lines[end]))) end++;
    while (end > idx + 1 && lines[end - 1].trim() === "") end--;
    lines.splice(end, 0, ...add);
    applied += add.length;
  }
  const v = await writeProfile("sparring", lines.join("\n"), { ...data, pending: [] }, null, true);
  return { read: 0, remaining: false, summary: `profil v${v} : ${applied} ligne(s) ajoutée(s) depuis ${pending.length} delta(s)` };
}

async function nightlyChiefOfStaff(): Promise<{ read: number; remaining: boolean; summary: string }> {
  const cos = await ensureSpecial("chief_of_staff");
  const prof = await currentProfile("chief_of_staff");
  const data = await cosData();
  const cursor = prof?.thought_cursor || null;
  const batch = await newThoughtsSince(cursor, CHUNK * 2);
  if (!batch.length) return { read: 0, remaining: false, summary: "rien de nouveau" };
  const model = cos.model || DEFAULT_MODEL;
  const lang = langName(cos.language);
  const domains = await listDomains();
  const user = batch.map((f) => `[${f.created_at.slice(0, 16)}] (${f.source_type || "?"}${f.domains?.length ? `, ${f.domains.join("+")}` : ""}) ${f.content.replace(/\s+/g, " ").slice(0, 700)}`).join("\n");
  const known = data.projects.map((p) => `- ${p.name} [${p.domain || "sans domaine"}] (${p.type}) : ${p.status || "?"} | dernière activité ${p.last_activity || "?"} | attend ${p.next || "?"}`).join("\n") || "(aucun projet déclaré)";
  const out = await chat(model, `Tu es le chief of staff d'une personne. On te donne l'état connu de ses projets et ses conversations récentes (chacune avec son domaine). Domaines possibles : ${domains.map((d) => d.slug).join(", ")}. En ${lang}, renvoie un JSON strict : {"projects":[{"name","status","last_activity","next"}],"proposed":[{"name","domain","reason"}]}. "projects" ne contient que les projets déjà déclarés dont l'état change (status : une phrase ; last_activity : date AAAA-MM-JJ ; next : la prochaine décision ou action et de qui). "proposed" : des projets ou chantiers qui reviennent dans les conversations et qui ne sont pas déclarés, deux au plus, avec leur domaine et la raison. N'invente rien ; listes vides si rien.`, `PROJETS DÉCLARÉS :\n${known}\n\nCONVERSATIONS RÉCENTES :\n${user}`, true, 2000);
  const parsed = parseJson(out) || {};
  const now = new Date().toISOString();
  const projects = data.projects.map((p) => {
    const u = (parsed.projects || []).find((x: any) => x && typeof x.name === "string" && x.name.toLowerCase() === p.name.toLowerCase());
    return u ? { ...p, status: u.status || p.status, last_activity: u.last_activity || p.last_activity, next: u.next || p.next, updated_at: now } : p;
  });
  const proposed = [...data.proposed];
  const valid = new Set(domains.map((d) => d.slug));
  for (const pr of parsed.proposed || []) {
    if (!pr || typeof pr.name !== "string") continue;
    const n = pr.name.trim();
    if (!n || projects.some((p) => p.name.toLowerCase() === n.toLowerCase()) || proposed.some((p) => p.name.toLowerCase() === n.toLowerCase())) continue;
    proposed.push({ name: n, reason: String(pr.reason || ""), seen_at: now, domain: typeof pr.domain === "string" && valid.has(pr.domain) ? pr.domain : undefined });
  }
  const newCursor = batch[batch.length - 1].created_at;
  const v = await writeProfile("chief_of_staff", prof?.content || "", { ...data, projects, proposed }, newCursor, true);
  return { read: batch.length, remaining: batch.length >= CHUNK * 2, summary: `état v${v}, ${batch.length} thoughts lus, ${(parsed.projects || []).length} projet(s) mis à jour, ${proposed.length - data.proposed.length} proposé(s)` };
}

type Kind = "classify" | "sparring" | "chief_of_staff";

async function runNightly(kind?: Kind): Promise<string> {
  // classification first: the other two steps read the domain tags
  const kinds: Kind[] = kind ? [kind] : ["classify", "sparring", "chief_of_staff"];
  const lines: string[] = [];
  for (const k of kinds) {
    const { data: run } = await supabase.from("advisor_runs").insert({ kind: k }).select("id").single();
    try {
      let r: { read: number; remaining: boolean; summary: string };
      if (k === "classify") {
        const c = await classifyBatch();
        r = { read: c.done, remaining: c.remaining, summary: c.done ? `${c.done} thoughts classés (${Object.entries(c.counts).map(([s, n]) => `${s}: ${n}`).join(", ")})` : "rien à classer" };
      } else if (k === "sparring") r = await nightlySparring();
      else r = await nightlyChiefOfStaff();
      await supabase.from("advisor_runs").update({ finished_at: new Date().toISOString(), status: "ok", thoughts_read: r.read, summary: r.summary }).eq("id", run?.id);
      lines.push(`${k}: ${r.summary}${r.remaining ? " (il en reste : relancer)" : ""}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase.from("advisor_runs").update({ finished_at: new Date().toISOString(), status: "error", error: msg }).eq("id", run?.id);
      lines.push(`${k}: ERREUR ${msg}`);
    }
  }
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP
// ─────────────────────────────────────────────────────────────────────────────

const app = new Hono();

function authorized(c: Context) {
  const key = c.req.query("key") || c.req.header("x-access-key") || c.req.header("x-brain-key");
  return Boolean(key && MCP_ACCESS_KEY && key === MCP_ACCESS_KEY);
}

const health = (c: Context) => c.json({ status: "ok", service: "open-brain-advisors", version: VERSION, model: DEFAULT_MODEL, classifier: CLASSIFIER_MODEL });
app.get("/health", health);
app.get("/:fn/health", health);

const nightly = async (c: Context) => {
  if (!authorized(c)) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const kind = ["classify", "sparring", "chief_of_staff"].includes(body?.kind) ? body.kind as Kind : undefined;
  const result = await runNightly(kind);
  return c.json({ ok: !/ERREUR/.test(result), result, remaining: /il en reste/.test(result) });
};
app.post("/jobs/nightly", nightly);
app.post("/:fn/jobs/nightly", nightly);

app.all("*", async (c) => {
  if (!c.req.header("accept")?.includes("text/event-stream")) {
    const headers = new Headers(c.req.raw.headers);
    headers.set("Accept", "application/json, text/event-stream");
    const patched = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: c.req.raw.body,
      // @ts-ignore -- duplex required for streaming body in Deno
      duplex: "half",
    });
    Object.defineProperty(c.req, "raw", { value: patched, writable: true });
  }
  if (!authorized(c)) return c.json({ error: "Unauthorized" }, 401);

  const server = new McpServer({ name: "open-brain-advisors", version: VERSION });
  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
  const fail = (e: unknown) => ({ content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true });

  // ── domains ────────────────────────────────────────────────────────────────

  server.tool("list_domains", "List the domains that partition the memory (areas of life/work), with how many thoughts each holds.", {}, async () => {
    try {
      const ds = await listDomains();
      const lines: string[] = [];
      for (const d of ds) {
        const { count } = await supabase.from("thoughts").select("id", { count: "exact", head: true }).contains("domains", [d.slug]);
        lines.push(`- ${d.slug} — ${d.name}${d.is_default ? " [défaut]" : ""} : ${d.description}${d.keywords?.length ? ` (mots-clés : ${d.keywords.join(", ")})` : ""} — ${count ?? 0} thoughts`);
      }
      const { count: untagged } = await supabase.from("thoughts").select("id", { count: "exact", head: true }).eq("domains", "{}");
      lines.push(`- (non classés : ${untagged ?? 0}, comptés dans le domaine par défaut jusqu'au prochain classement)`);
      return text(lines.join("\n"));
    } catch (e) { return fail(e); }
  });

  server.tool("set_domain", "Create or update a domain (upsert by slug). The description is what the nightly classifier reads: say what belongs here, what does not, and give keywords. Only one domain can be the default.", {
    slug: z.string().optional().describe("Identifier; derived from the name if omitted"),
    name: z.string(),
    description: z.string().describe("What belongs to this domain, and what does not"),
    keywords: z.array(z.string()).optional(),
    is_default: z.boolean().optional().describe("Make it the default domain (unclassified thoughts count as default)"),
  }, async (a) => {
    try {
      const slug = a.slug ? slugify(a.slug) : slugify(a.name);
      if (!slug) return text("Slug vide.");
      if (a.is_default) await supabase.from("advisor_domains").update({ is_default: false }).eq("is_default", true);
      const { data: existing } = await supabase.from("advisor_domains").select("*").eq("slug", slug).maybeSingle();
      const row = { slug, name: a.name, description: a.description, keywords: a.keywords ?? existing?.keywords ?? [], is_default: a.is_default ?? existing?.is_default ?? false, updated_at: new Date().toISOString() };
      const { error } = await supabase.from("advisor_domains").upsert(row, { onConflict: "slug" });
      if (error) throw new Error(error.message);
      return text(`Domaine '${slug}' ${existing ? "mis à jour" : "créé"}${row.is_default ? " (défaut)" : ""}. Les thoughts déjà classés ne bougent pas : classify_domains avec reclassify=true pour les reclasser.`);
    } catch (e) { return fail(e); }
  });

  server.tool("delete_domain", "Remove a domain; its thoughts are re-tagged to the default domain, its personas lose their domain (they must be re-bound before use).", { slug: z.string() }, async ({ slug }) => {
    try {
      const ds = await listDomains();
      const d = ds.find((x) => x.slug === slug);
      if (!d) return text(`Pas de domaine '${slug}'.`);
      if (d.is_default) return text("Le domaine par défaut ne se supprime pas : désigne-en un autre d'abord (set_domain is_default=true).");
      const def = ds.find((x) => x.is_default)!;
      const { data: rows } = await supabase.from("thoughts").select("id, domains").contains("domains", [slug]);
      for (const r of rows || []) {
        const nd = (r.domains as string[]).filter((s) => s !== slug);
        await supabase.from("thoughts").update({ domains: nd.length ? nd : [def.slug] }).eq("id", r.id);
      }
      await supabase.from("advisor_personas").update({ domain: null }).eq("domain", slug);
      const { error } = await supabase.from("advisor_domains").delete().eq("slug", slug);
      if (error) throw new Error(error.message);
      return text(`Domaine '${slug}' supprimé ; ${(rows || []).length} thoughts réaffectés.`);
    } catch (e) { return fail(e); }
  });

  server.tool("set_thought_domains", "Correct the domains of thoughts: by thought id, or by a phrase of their title/content (all matches are shown first; pass confirm=true to apply).", {
    id: z.string().optional(), query: z.string().optional().describe("Phrase to match in the content (case-insensitive)"),
    domains: z.array(z.string()).describe("Domain slugs to set"), confirm: z.boolean().optional(),
  }, async ({ id, query, domains, confirm }) => {
    try {
      const valid = new Set((await listDomains()).map((d) => d.slug));
      const ds = [...new Set(domains.filter((s) => valid.has(s)))];
      if (!ds.length) return text("Aucun domaine valide. list_domains pour les voir.");
      let q = supabase.from("thoughts").select("id, content, domains").limit(20);
      if (id) q = q.eq("id", id); else if (query) q = q.ilike("content", `%${query}%`); else return text("Donne un id ou une phrase (query).");
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      if (!data?.length) return text("Aucun thought trouvé.");
      if (!confirm && !id) return text(`${data.length} thought(s) trouvé(s) :\n${data.map((t: any) => `- ${t.id} [${(t.domains || []).join("+") || "non classé"}] ${t.content.split("\n")[0].slice(0, 80)}`).join("\n")}\nRelance avec confirm=true pour les passer en ${ds.join("+")}.`);
      for (const t of data) await supabase.from("thoughts").update({ domains: ds }).eq("id", t.id);
      return text(`${data.length} thought(s) classé(s) en ${ds.join("+")}.`);
    } catch (e) { return fail(e); }
  });

  server.tool("classify_domains", "Run the domain classifier now on unclassified thoughts (or on all with reclassify=true), one bounded batch per call; says if more remains.", {
    reclassify: z.boolean().optional(), limit: z.number().optional(),
  }, async ({ reclassify, limit }) => {
    try {
      const c = await classifyBatch(Math.max(5, Math.min(150, limit || CLASSIFY_BATCH)), reclassify || false);
      return text(c.done ? `${c.done} thoughts classés : ${Object.entries(c.counts).map(([s, n]) => `${s} ${n}`).join(", ")}.${c.remaining ? " Il en reste : relance." : " Terminé."}` : "Rien à classer.");
    } catch (e) { return fail(e); }
  });

  // ── personas ───────────────────────────────────────────────────────────────

  server.tool("list_personas", "List the panel's personas (with their domain and what each may know), plus the sparring partner and the chief of staff.", {}, async () => {
    try {
      const list = await listPersonas();
      if (!list.length) return text("Aucune persona. Crée-en avec set_persona.");
      return text(list.map((p) => `- ${p.slug} — ${p.name} [${p.kind}${p.kind === "persona" ? `, domaine ${p.domain || "NON DÉFINI"}` : ", global"}${p.enabled ? "" : ", désactivée"}] : ${p.description}\n  cherche : ${p.seeks || "-"} | non si : ${p.says_no || "-"} | oui si : ${p.says_yes || "-"}\n  sait : ${p.knows || "-"} | ne sait pas : ${p.does_not_know || "-"}\n  accès : sources ${p.access?.source_types ? p.access.source_types.join(",") : "toutes"}, exclut ${(p.access?.exclude_sensitivity || []).join(",") || "rien"}, fenêtre ${p.access?.since_days ? p.access.since_days + " j" : "illimitée"}`).join("\n"));
    } catch (e) { return fail(e); }
  });

  server.tool("set_persona", "Create or update a persona of the panel (upsert by slug). A persona belongs to ONE domain and only sees thoughts of that domain. Describe who they are, what they seek, what makes them say no or yes, what they know and must not know.", {
    slug: z.string().describe("Short identifier, e.g. 'investisseur', 'expert-comptable', 'professeur'"),
    name: z.string().describe("Display name, e.g. 'Investisseur business angel'"),
    domain: z.string().optional().describe("Domain slug the persona belongs to (required when more than one domain exists)"),
    description: z.string().describe("Who they are: role, experience, stance"),
    seeks: z.string().optional().describe("What they look for or protect"),
    says_no: z.string().optional().describe("What makes them say no"),
    says_yes: z.string().optional().describe("What makes them say yes"),
    knows: z.string().optional().describe("What they know about the project / the person"),
    does_not_know: z.string().optional().describe("What they must NOT know or assume (e.g. private doubts, family, health)"),
    source_types: z.array(z.string()).optional().describe("Brain sources they may read (e.g. ['curated_claim','chatgpt_import']); omit for all"),
    exclude_sensitivity: z.array(z.string()).optional().describe("Sensitivity tiers never shown; default ['restricted','private']"),
    since_days: z.number().optional().describe("Only thoughts from the last N days; omit for no limit"),
    model: z.string().optional().describe("OpenRouter model id for this persona; default server model"),
    language: z.string().optional().describe("Answer language code, default 'fr'"),
    enabled: z.boolean().optional(),
  }, async (a) => {
    try {
      const existing = await getPersona(a.slug);
      if (existing && existing.kind !== "persona") return text(`'${a.slug}' est ${existing.kind} : utilise set_profile pour son profil ; son accès n'est pas modifiable ici.`);
      const domains = await listDomains();
      let domain = a.domain ?? existing?.domain ?? null;
      if (!domain) {
        if (domains.length === 1) domain = domains[0].slug;
        else return text(`Précise le domaine de cette persona (domain). Domaines : ${domains.map((d) => d.slug).join(", ")}.`);
      }
      if (!domains.some((d) => d.slug === domain)) return text(`Domaine inconnu '${domain}'. Domaines : ${domains.map((d) => d.slug).join(", ")}.`);
      const access = normalizeAccess({ source_types: a.source_types, exclude_sensitivity: a.exclude_sensitivity, since_days: a.since_days }, existing?.access ? normalizeAccess(existing.access, DEFAULT_ACCESS) : DEFAULT_ACCESS);
      const row = {
        slug: a.slug, name: a.name, kind: "persona", domain, description: a.description,
        seeks: a.seeks ?? existing?.seeks ?? "", says_no: a.says_no ?? existing?.says_no ?? "", says_yes: a.says_yes ?? existing?.says_yes ?? "",
        knows: a.knows ?? existing?.knows ?? "", does_not_know: a.does_not_know ?? existing?.does_not_know ?? "",
        access, model: a.model ?? existing?.model ?? null, language: a.language ?? existing?.language ?? DEFAULT_LANGUAGE,
        enabled: a.enabled ?? existing?.enabled ?? true, updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("advisor_personas").upsert(row, { onConflict: "slug" });
      if (error) throw new Error(error.message);
      return text(`Persona '${a.slug}' ${existing ? "mise à jour" : "créée"}, domaine ${domain}. Accès : sources ${access.source_types ? access.source_types.join(",") : "toutes"}, exclut ${access.exclude_sensitivity.join(",") || "rien"}, fenêtre ${access.since_days ? access.since_days + " j" : "illimitée"}.`);
    } catch (e) { return fail(e); }
  });

  server.tool("delete_persona", "Remove a persona from the panel (not the sparring partner nor the chief of staff).", { slug: z.string() }, async ({ slug }) => {
    try {
      const p = await getPersona(slug);
      if (!p) return text(`Pas de persona '${slug}'.`);
      if (p.kind !== "persona") return text(`'${slug}' est ${p.kind} et ne se supprime pas.`);
      const { error } = await supabase.from("advisor_personas").delete().eq("slug", slug);
      if (error) throw new Error(error.message);
      return text(`Persona '${slug}' supprimée.`);
    } catch (e) { return fail(e); }
  });

  server.tool("ask_persona", "Ask one persona a question. It answers in role from the brain facts of its domain it is allowed to see: position, three questions, what would change its mind.", {
    slug: z.string(), question: z.string(),
  }, async ({ slug, question }) => {
    try {
      const p = await getPersona(slug);
      if (!p) return text(`Pas de persona '${slug}'. list_personas pour voir le panel.`);
      if (p.kind === "persona" && !p.domain) return text(`La persona '${slug}' n'a pas de domaine : set_persona avec domain=… avant de l'interroger.`);
      return text(`## ${p.name}\n${await askPersona(p, question)}`);
    } catch (e) { return fail(e); }
  });

  server.tool("ask_panel", "Ask the whole panel (every enabled persona, optionally of one domain) the same question. Each persona answers separately from the facts it may see; a short synthesis says where they diverge and what to decide first.", {
    question: z.string(), domain: z.string().optional().describe("Restrict to the personas of this domain"), slugs: z.array(z.string()).optional().describe("Restrict to these personas"),
  }, async ({ question, domain, slugs }) => {
    try { return text(await askPanel(question, slugs, domain)); } catch (e) { return fail(e); }
  });

  server.tool("ask_sparring", "Talk to your sparring partner: a peer who knows your positions, reversals and reactions (nightly-distilled profile) and challenges you with precision. Optionally frame the question in a domain; it still uses what it knows from the others.", {
    message: z.string().describe("What you want to discuss, decide, or be challenged on"),
    domain: z.string().optional().describe("Domain slug to frame the answer in"),
  }, async ({ message, domain }) => {
    try { const p = await ensureSpecial("sparring"); return text(await askPersona(p, message, domain)); } catch (e) { return fail(e); }
  });

  // ── profiles ───────────────────────────────────────────────────────────────

  server.tool("get_profile", "Read the living profile the sparring partner keeps about you (kind 'sparring'), or the chief of staff's state (kind 'chief_of_staff').", {
    kind: z.enum(["sparring", "chief_of_staff"]),
  }, async ({ kind }) => {
    try {
      const prof = await currentProfile(kind);
      if (!prof) return text(`Pas encore de profil '${kind}'. Le job nocturne le créera, ou set_profile pour l'amorcer.`);
      const head = `(version ${prof.version}, distillé ${prof.distilled_at?.slice(0, 16) || "jamais"}, curseur ${prof.thought_cursor?.slice(0, 16) || "aucun"})\n`;
      return text(kind === "sparring" ? head + prof.content : head + JSON.stringify(prof.data, null, 2));
    } catch (e) { return fail(e); }
  });

  server.tool("set_profile", "Replace the sparring partner's profile text (markdown). Use it to seed it from an existing document, or to correct what the nightly job got wrong.", {
    content: z.string(),
    cursor: z.string().optional().describe("ISO date: thoughts before it are considered already integrated (default: now)"),
  }, async ({ content, cursor }) => {
    try {
      const v = await writeProfile("sparring", content, undefined, cursor || new Date().toISOString(), false);
      return text(`Profil sparring enregistré, version ${v}.`);
    } catch (e) { return fail(e); }
  });

  server.tool("reset_cursor", "Move the nightly job's cursor for a kind: thoughts after this date will be (re)distilled on the next run.", {
    kind: z.enum(["sparring", "chief_of_staff"]), to: z.string().describe("ISO date, e.g. 2026-01-01"),
  }, async ({ kind, to }) => {
    try {
      const prof = await currentProfile(kind);
      const v = await writeProfile(kind, prof?.content || "", prof?.data, new Date(to).toISOString(), false);
      return text(`Curseur ${kind} placé au ${to} (version ${v}).`);
    } catch (e) { return fail(e); }
  });

  // ── chief of staff ─────────────────────────────────────────────────────────

  server.tool("list_projects", "Chief of staff: the declared projects by domain with their known state, and the projects the nightly job proposes to add.", {}, async () => {
    try {
      const d = await cosData();
      const lines = d.projects.map((p) => `- ${p.name} [${p.domain || "sans domaine"}] (${p.type}${p.folder ? `, ${p.folder}` : ""}) : ${p.status || "état inconnu"} | dernière activité ${p.last_activity || "?"} | attend ${p.next || "?"}`);
      const prop = d.proposed.map((p) => `- ${p.name} [${p.domain || "?"}] — ${p.reason} (vu le ${p.seen_at.slice(0, 10)})`);
      return text(`Projets déclarés :\n${lines.join("\n") || "(aucun)"}\n\nProposés par le job nocturne (set_projects pour les adopter) :\n${prop.join("\n") || "(aucun)"}`);
    } catch (e) { return fail(e); }
  });

  server.tool("set_projects", "Chief of staff: declare or update the projects to follow, each in a domain. Replaces the list; known states are kept for projects whose name is unchanged.", {
    projects: z.array(z.object({
      name: z.string(), domain: z.string().optional().describe("Domain slug"), type: z.enum(["stratégique", "autonome"]).default("autonome"),
      folder: z.string().optional().describe("Repo or folder path if any"),
      watch: z.string().optional().describe("What to watch for this project"),
    })),
  }, async ({ projects }) => {
    try {
      const d = await cosData();
      const valid = new Set((await listDomains()).map((x) => x.slug));
      const merged: Project[] = projects.map((np) => {
        const old = d.projects.find((p) => p.name.toLowerCase() === np.name.toLowerCase());
        const domain = np.domain && valid.has(np.domain) ? np.domain : old?.domain;
        return { ...(old || {}), name: np.name, type: np.type, domain, folder: np.folder ?? old?.folder, watch: np.watch ?? old?.watch };
      });
      const proposed = d.proposed.filter((p) => !merged.some((m) => m.name.toLowerCase() === p.name.toLowerCase()));
      const prof = await currentProfile("chief_of_staff");
      await ensureSpecial("chief_of_staff");
      const v = await writeProfile("chief_of_staff", prof?.content || "", { ...d, projects: merged, proposed }, null, false);
      const missing = merged.filter((m) => !m.domain).map((m) => m.name);
      return text(`${merged.length} projet(s) déclarés (état v${v}).${missing.length ? ` Sans domaine : ${missing.join(", ")}.` : ""}`);
    } catch (e) { return fail(e); }
  });

  server.tool("etat_des_lieux", "Chief of staff: a dated status report of the declared projects (all domains, or one) — where each stands, what it waits for, what is blocked on you, what you are drifting away from.", {
    domain: z.string().optional().describe("Restrict to one domain"),
  }, async ({ domain }) => {
    try { return text(await etatDesLieux(domain)); } catch (e) { return fail(e); }
  });

  // ── forget / nightly ───────────────────────────────────────────────────────

  server.tool("forget", "Delete thoughts from the brain: by id, or by a phrase of their title/content. Matches are listed first; pass confirm=true to delete them for good.", {
    id: z.string().optional(), query: z.string().optional(), confirm: z.boolean().optional(),
  }, async ({ id, query, confirm }) => {
    try {
      let q = supabase.from("thoughts").select("id, content, created_at, source_type").limit(10);
      if (id) q = q.eq("id", id); else if (query) q = q.ilike("content", `%${query}%`); else return text("Donne un id ou une phrase (query).");
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      if (!data?.length) return text("Aucun thought trouvé.");
      if (!confirm) return text(`${data.length} thought(s) trouvé(s) :\n${data.map((t: any) => `- ${t.id} [${t.created_at.slice(0, 10)}, ${t.source_type}] ${t.content.split("\n")[0].slice(0, 80)}`).join("\n")}\nRelance avec confirm=true pour les supprimer définitivement.`);
      const ids = data.map((t: any) => t.id);
      const { error: e } = await supabase.from("thoughts").delete().in("id", ids);
      if (e) throw new Error(e.message);
      return text(`${ids.length} thought(s) supprimé(s).`);
    } catch (e) { return fail(e); }
  });

  server.tool("run_nightly", "Run the nightly job now: classify new thoughts into domains, distill the sparring profile, update the chief of staff state. One bounded step per kind; says if more remains.", {
    kind: z.enum(["classify", "sparring", "chief_of_staff"]).optional(),
  }, async ({ kind }) => {
    try { return text(await runNightly(kind)); } catch (e) { return fail(e); }
  });

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
