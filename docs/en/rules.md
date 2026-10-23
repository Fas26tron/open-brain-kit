# Definition rules: domains, personas, chief of staff, sparring partner, retention

*Version française : [../rules.md](../rules.md).*

This document fixes what each notion means and how to define it so that it works. Procedures are in [advisors.md](advisors.md); here are the rules.

## 1. Domains

A **domain** is an area of your life or work: "Artinary & Arts Lab", "Forward College", "Personal life". Domains partition the memory: every thought carries the domain(s) it belongs to.

**Rules**

1. **There is always a default domain**, created at installation as "Personal life" (`personal`). Everything the classifier cannot clearly attach to another domain goes there. It is the safe choice: a misclassified thought ends up on the private side, never on the side of a work persona.
2. **A thought may have several domains** when it genuinely mixes subjects. A conversation about your company and your family carries both.
3. **Classification runs every night** with a light model, from each domain's description. It is corrected with a sentence: "this conversation about X belongs to Forward College". Creating or editing a domain does not reclassify existing thoughts; ask to "reclassify everything" if needed.
4. **A domain is defined by its description, not its name.** The description is what the classifier reads. It must say what belongs to the domain **and what does not**, with keywords: project, people, institution and product names.

**Good description**: "Artinary & Arts Lab: the Artinary product (museum visit companion, artwork recognition, audio), the Arts Lab company, its financing, its partnerships with museums and foundations, the team (Alex, Aline), the roadmap, the business plan. Does not include: my personal investments in other companies, my family, my travels even when I visit a museum. Keywords: Artinary, Arts Lab, Musea, Orsay, Louvre, audio guide."

**Bad description**: "My work." The classifier can do nothing with it.

5. **Three to six domains** is the right size. Beyond that, classification hesitates and personas lack material. A project is not a domain: the chief of staff tracks projects, inside a domain.

## 2. Personas

A **persona** is a character you question: investor, accountant, employee, banker, customer, museum director. It answers in role, from the facts it is allowed to see.

**Rules**

1. **A persona belongs to one domain** and only sees the thoughts of that domain. A thought that also carries another domain is invisible to it: the strict rule, which protects the private side at the price of an occasionally missing fact.
2. **It never sees thoughts tagged `restricted` or `personal`**, nor the sparring partner's profile, whatever its domain.
3. **It is defined in five fields**, one or two sentences each: who they are; what they seek or protect; what makes them say no; what makes them say yes; what they must not know. The first four make the quality of the answer; the fifth is a role-play instruction, not a barrier. The barrier is the domain and the filters.
4. **Restrict its sources when possible.** An "outside" persona (investor, banker) should only see curated claims or documents, never the raw transcripts of your conversations, which contain your hesitations. An "inside" persona (employee, partner) may see more.
5. **Write the persona as a loyal adversary**, not an ally. What makes them say no is the most useful field: it produces the objections you had not seen.

**Example**: "Tenured teacher at the school, ten years in. Seeks: teaching quality and a sustainable workload. Says no to anything that adds hours without means, or decided without consulting the team. Says yes to what values the profession and what is tested at small scale first. Does not know: the school's finances, the discussions with investors. Domain: Forward College. Sources: curated claims."

## 3. The chief of staff

The **chief of staff** is unique and global. It tracks your **projects**, each attached to a domain, and produces status reports: per domain or for everything.

**Rules**

1. **A project is declared with its domain, its type and what to watch.** The type is `stratégique` (lasting, must not be forgotten) or `autonome` (to finish, then close). "What to watch" guides the nightly search: "beta, visitor feedback, go-live" beats nothing.
2. **It asks nothing of you.** It infers the state of projects from the brain, from your git repositories if you have any, from your Claude Code sessions. It only asks you a question when a decision is yours.
3. **It proposes, it does not decide.** When a subject recurs in your conversations without being declared, it proposes it with its domain; you adopt it or not.
4. **The "what you are drifting away from" section is always present**, even empty. That is its refocusing function: strategic projects with no activity for more than three weeks, with the duration.
5. **It reads all domains.** A "Forward College" status report only shows that domain's projects, but its knowledge of your other domains remains available on request.

## 4. The sparring partner

The **sparring partner** is unique and global. It knows you through a **profile** distilled every night from your conversations: dated positions, reversals, reactions to advice, strengths and weaknesses, rules for challenging you.

**Rules**

1. **It sees everything**, all domains, all sensitivity tiers. That is what lets it point out that a decision taken in one domain contradicts what you consider in another.
2. **Its profile is confidential by construction**: stored apart, never in the thoughts, inaccessible to personas.
3. **It learns by addition, never by rewrite.** Each night appends dated lines under the profile's existing headings. Nothing is deleted: a superseded position moves to the reversals with its date.
4. **You re-read it once a week.** "What does my sparring partner know about me?" A profile that learns without review ends up describing you wrongly on some point without you knowing. Correct with "replace my profile with…" or by editing the text.
5. **A question can be framed in a domain**: "sparring, within Forward College…". It answers in that frame while drawing on the rest.
6. **It is not a therapist.** It reflects the patterns visible in your conversations, precisely if the profile is well distilled. It does not diagnose.

## 5. Retention

Open Brain does not keep every interaction. The rule, applied by the Chrome extension before sending:

1. **A conversation is kept if you intervene at least three times, or if your messages total at least 600 characters**, even in one go. A one-off question, a phone number, a hotel are not kept.
2. **"Open Brain, remember"** (or "Open Brain, retiens") written in the conversation, in any client, forces capture. **"Open Brain, forget"** prevents it. An already captured conversation is removed with "forget the conversation about X" (the `forget` tool shows what it will delete before deleting).
3. **A conversation below the rule is re-examined at every sync** and captured as soon as it exceeds the rule.
4. **Notes dictated to the Claude app are not concerned**: they go through `capture_thought`, one sentence is enough.
5. **A conversation that grows replaces its previous version.** Every sync sends the whole conversation again; the server keeps the new version, carries over the domains and sensitivity set by hand on the old one, then deletes the old one. The nightly job only re-reads the new part.
6. **Retention removes the disposable; the domain sorts the rest.** A three-turn conversation about a hotel will be kept, and will go to "Personal life", invisible to work personas.

## 6. Sensitivity

Independent of the domain, a thought's **sensitivity** is `standard`, `personal` or `restricted` (Open Brain convention). Personas never access the last two tiers; search from your clients excludes `restricted` by default; the sparring partner sees everything.

Use it for what must stay out of reach of every persona, whatever the domain: health, personal money, conflicts. "Mark this conversation as restricted" is enough when the matching tool is connected; otherwise the tier is set in the `thoughts` table.

## 7. What the nightly job does, in order

The job advances on the date a row **entered the brain** (`captured_at`), not on the conversation's real date: a 2024 conversation imported today, or resumed today, is processed tonight.

1. **Classifies** the new thoughts into domains.
2. **Distills** the new thoughts into the sparring partner's profile.
3. **Updates** the chief of staff's project state and proposes undeclared projects.

Each step is bounded; a large backlog resolves in a few nights, or immediately by repeating "run the distillation now".
