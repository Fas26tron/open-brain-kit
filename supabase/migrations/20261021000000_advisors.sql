-- Open Brain — advisors layer (chief of staff, sparring partner, panel of personas).
--
-- Three small tables next to `thoughts` (which is never modified):
--   advisor_personas  the personas, including the special kinds "sparring" and
--                     "chief_of_staff"; each carries its own access policy to
--                     the thoughts (what it may know)
--   advisor_profiles  living documents distilled nightly: the sparring
--                     partner's profile of the person (sensitive), and the
--                     chief of staff's project state
--   advisor_runs      log of nightly distillation runs
-- Idempotent: safe to run multiple times.

create table if not exists advisor_personas (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind text not null default 'persona' check (kind in ('persona', 'sparring', 'chief_of_staff')),
  description text not null default '',
  seeks text not null default '',
  says_no text not null default '',
  says_yes text not null default '',
  knows text not null default '',
  does_not_know text not null default '',
  -- what this persona may read from `thoughts`:
  --   source_types: null = all, or ["chatgpt_import", ...]
  --   exclude_sensitivity: tiers never shown (default: restricted, private)
  --   since_days: null = no date limit
  --   max_facts: how many retrieved thoughts are passed to the model
  access jsonb not null default '{"source_types": null, "exclude_sensitivity": ["restricted", "private"], "since_days": null, "max_facts": 12}'::jsonb,
  model text,
  language text not null default 'fr',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists advisor_profiles (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('sparring', 'chief_of_staff')),
  version integer not null default 1,
  content text not null default '',
  data jsonb not null default '{}'::jsonb,
  thought_cursor timestamptz,
  distilled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, version)
);

create table if not exists advisor_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  thoughts_read integer not null default 0,
  summary text,
  error text
);

create index if not exists advisor_profiles_kind_version_idx on advisor_profiles (kind, version desc);
create index if not exists advisor_runs_started_idx on advisor_runs (started_at desc);

alter table advisor_personas enable row level security;
alter table advisor_profiles enable row level security;
alter table advisor_runs enable row level security;

drop policy if exists "service role full access" on advisor_personas;
create policy "service role full access" on advisor_personas for all using (auth.role() = 'service_role');
drop policy if exists "service role full access" on advisor_profiles;
create policy "service role full access" on advisor_profiles for all using (auth.role() = 'service_role');
drop policy if exists "service role full access" on advisor_runs;
create policy "service role full access" on advisor_runs for all using (auth.role() = 'service_role');

grant select, insert, update, delete on table public.advisor_personas to service_role;
grant select, insert, update, delete on table public.advisor_profiles to service_role;
grant select, insert, update, delete on table public.advisor_runs to service_role;
