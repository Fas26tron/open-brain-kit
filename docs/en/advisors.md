# Advisors: chief of staff, sparring partner, persona panel

*Version française : [../advisors.md](../advisors.md).*

Three roles served by your brain itself, hence usable from **any client**: claude.ai, Claude Desktop, Claude mobile, ChatGPT, Claude Code. One configuration, valid everywhere. A nightly job makes them learn from your conversations without you thinking about it.

- **The chief of staff** tracks your projects: where each one stands, what it waits for, what is blocked on you, what you are drifting away from. "Where do my projects stand?" produces a dated status report.
- **The sparring partner** is a peer who knows you: your dated positions, your reversals, your reactions, your strengths and weaknesses, distilled every night into a confidential profile. It challenges you precisely and ends with a closed question.
- **The panel**: the personas you define, investor, accountant, employee, banker, customer. One question, one answer per persona from the facts each is allowed to see, then what their disagreements reveal.

## Installation

Prerequisites: the kit deployed (steps 1 to 6 of [install.md](install.md); the `open-brain-advisors` function and its tables are part of them).

Verify: `curl -s https://PROJECT_REF.supabase.co/functions/v1/open-brain-advisors/health`.

Optional settings, with `supabase secrets set`: `ADVISORS_MODEL` (OpenRouter id of the model that plays the roles, default `anthropic/claude-sonnet-5.5`), `ADVISORS_LANGUAGE` (default `fr`; set `en` for English answers).

**Connector**: add it like Open Brain, in each client ([connect-clients.md](connect-clients.md)), name `Advisors`, URL:

```
https://PROJECT_REF.supabase.co/functions/v1/open-brain-advisors?key=BRAIN_KEY
```

**Nightly job**: copy `keepalive/advisors-nightly.yml` into your keep-alive GitHub repository, under `.github/workflows/`. It reuses the two secrets already set. Run it once by hand from the Actions tab.

**Done when**: "list my personas" answers in Claude, and the nightly job's first run is green.

## Domains

**Domains** partition the memory into areas of life or work: "Artinary & Arts Lab", "Forward College", "Personal life". Every thought carries the domain(s) it belongs to, assigned every night by a light classifier from the domains' descriptions, and correctable with a sentence. A default domain always exists ("Personal life"): everything not clearly attached elsewhere goes there.

- A **persona** belongs to one domain and only sees its thoughts, strict rule: a thought that also touches another domain is invisible to it.
- The **chief of staff** is global; each project is attached to a domain; "where do my Forward College projects stand" or "full status report".
- The **sparring partner** is global and sees everything; "sparring, within Forward College…" frames the answer without blinding it.

Definition rules, with examples of good and bad descriptions, are in [rules.md](rules.md).

## Using them, from any client

Everything goes through sentences; the client calls the matching tool.

| You say | Tool |
|---|---|
| "Create a domain Forward College: the school, its team, its campuses, its financing, its students; not my personal life" | `set_domain` |
| "Show me my domains" / "reclassify everything" / "this conversation about X belongs to Forward College" | `list_domains`, `classify_domains`, `set_thought_domains` |
| "Add a persona in Forward College: tenured teacher at the school, ten years in, protects teaching quality and workload, says no to anything that adds hours without means, says yes to what values the profession. They do not know my private conversations." | `set_persona` |
| "Show me my panel" | `list_personas` |
| "Ask the panel: should we open a second campus in 2027?" | `ask_panel` |
| "Ask the investor what they think of the financing plan" | `ask_persona` |
| "Sparring: I am thinking of postponing the launch by six months" | `ask_sparring` |
| "Declare my projects: Website redesign (strategic), Head of teaching recruitment (strategic), Regional grant file (standalone, deadline 15 November)" | `set_projects` |
| "Where do my projects stand?" | `etat_des_lieux` |
| "What does my sparring partner know about me?" | `get_profile` |
| "Forget the conversation about the hotel in Corsica" | `forget` (shows before deleting) |
| "Run the distillation now" | `run_nightly` |

The chief of staff proposes by itself the projects it sees recurring in your conversations and that are not declared; "list my projects" shows them, "declare…" adopts them.

## What each persona is allowed to know

Two mechanisms, and only the first is a guarantee:

1. **Deterministic filters**, in `set_persona`: allowed sources (`source_types`, for instance only curated claims), excluded sensitivity tiers (`exclude_sensitivity`, default `restricted` and `private`), a time window (`since_days`). The server never passes a thought outside these filters. What must stay out of reach is **tagged** (thought sensitivity), not described.
2. **Description** (`knows`, `does_not_know`): tells the persona what it must not assume. Useful for the role play, not a barrier.

The sparring partner sees everything. Its profile lives in a separate table, never in the thoughts: no other persona can read it. That profile contains who you are; it stays in your Supabase.

## How they learn

Every night, the job reads the thoughts that arrived since the last pass (all sources: Chrome extension, Claude Code scanner, mobile app) and:

- **classifies** the new thoughts into domains;
- updates the **sparring partner's profile**: new positions, reversals, reactions to advice, rules for challenging you, observed traits. Nothing is deleted; a superseded position moves to "reversals" with its date. The profile grows by appended lines under its existing headings, never by a rewrite;
- updates the **project state** of the chief of staff and proposes undeclared projects.

Between two nights, both roles still see everything that is captured, by searching at question time. The night is for distilling, not for knowing.

**Re-read the profile once a week** ("what does my sparring partner know about me?"). A profile that learns without review ends up describing you wrongly on some point without you knowing. `set_profile` replaces the text if you correct it; `reset_cursor` makes a period distilled again.

**Seeding**: if you already have a document that describes you (a founder model, notes), `set_profile` with its content avoids starting from zero. To distill the whole imported history, `reset_cursor` to an old date, then `run_nightly` as many times as it asks: long, and it costs model calls, to be done once.

## Costs and limits

- Each panel question = one model call per persona, plus one for the synthesis. Each night = one call per batch of 30 new thoughts, plus a profile merge; the workflow chains up to 12 calls. With the default model, a few cents per question, a few tens of cents per active night.
- The quality of the roles is that of the server model. A low-end model gives caricatures.
- "Like a therapist": the sparring partner reflects the patterns visible in your conversations, precisely if the profile is well distilled. It is an informed mirror, not a clinician.
- On ChatGPT, the plugin is created then **installed** (two steps, see [connect-clients.md](connect-clients.md)); paid plan; tool sometimes to be named.

The kit's `chief-of-staff/` pack remains the local version for Claude Code: it also reads your git repositories and sessions, and versions everything in a repo. Both can coexist on the same brain.
