-- Open Brain — capture tracking.
--
-- `created_at` holds the real date of a conversation (an imported 2024
-- conversation stays dated 2024), so it cannot tell what arrived since last
-- night. `captured_at` is the moment the row entered the brain; the nightly
-- jobs advance on it. Existing rows are backfilled with their created_at so
-- nothing is re-read. An index on metadata->>'conversation_id' supports the
-- replacement of older versions of a synced conversation.
--
-- Additive only, idempotent.

alter table thoughts add column if not exists captured_at timestamptz;
update thoughts set captured_at = created_at where captured_at is null;
alter table thoughts alter column captured_at set default now();
alter table thoughts alter column captured_at set not null;

create index if not exists thoughts_captured_at_idx on thoughts (captured_at);
create index if not exists thoughts_conversation_id_idx on thoughts ((metadata->>'conversation_id'));
