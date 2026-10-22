-- Open Brain — domains: partition the memory into areas of life/work.
--
-- A domain is a named area ("Artinary & Arts Lab", "Personal life", …). Each
-- thought is tagged with the domains it belongs to (nightly classification,
-- correctable by hand). Personas are bound to ONE domain and only ever see
-- thoughts whose domains are all allowed (strict rule). Unclassified thoughts
-- count as the default domain. The chief of staff and the sparring partner
-- stay global.
--
-- Additive only: adds a column to `thoughts`, never alters existing ones.
-- Idempotent.

create table if not exists advisor_domains (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  keywords text[] not null default '{}',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- exactly one default domain
create unique index if not exists advisor_domains_one_default_idx on advisor_domains (is_default) where is_default;

alter table thoughts add column if not exists domains text[] not null default '{}';
create index if not exists thoughts_domains_gin_idx on thoughts using gin (domains);

alter table advisor_personas add column if not exists domain text;

alter table advisor_domains enable row level security;
drop policy if exists "service role full access" on advisor_domains;
create policy "service role full access" on advisor_domains for all using (auth.role() = 'service_role');
grant select, insert, update, delete on table public.advisor_domains to service_role;

-- seed the default domain (renameable)
insert into advisor_domains (slug, name, description, is_default)
select 'personal', 'Vie personnelle', 'Tout ce qui ne relève d''aucun domaine de travail déclaré : famille, voyages, santé, loisirs, questions ponctuelles du quotidien.', true
where not exists (select 1 from advisor_domains where is_default);
