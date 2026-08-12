-- ═══════════════════════════════════════════════════════════════
-- RELATIVE ESTATES — DOCUMENT EXTRACTION
-- Applied to the live project. Kept here so the schema is described
-- in the repo rather than only in the database.
--
-- Requires supabase-auth-migration.sql (for is_internal() and
-- has_project_access()) and supabase-dropbox-migration.sql.
--
-- Environment variables this needs (server-side only):
--   ANTHROPIC_API_KEY
-- ═══════════════════════════════════════════════════════════════

-- One row per document read. `items` holds the proposed line items and each
-- one's review state, so a half-reviewed extraction survives closing the tab.
--
-- Nothing here is authoritative. Applying an extraction copies its approved
-- items onto the schedule; until then a schedule is unaffected by anything
-- stored in this table.
create table if not exists extractions (
  id            uuid default gen_random_uuid() primary key,
  project_id    uuid references projects(id) on delete cascade,
  category      text not null,

  -- Where it came from. The path is kept rather than a file id so an
  -- extraction still says what it read after a Dropbox re-sync.
  source_path   text not null,
  source_name   text not null,

  -- reviewing → applied | discarded, or failed if the read itself failed.
  status        text not null default 'reviewing'
                check (status in ('reviewing', 'applied', 'discarded', 'failed')),

  model         text,
  items         jsonb not null default '[]'::jsonb,
  notes         text,
  error         text,
  usage         jsonb,

  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  applied_at    timestamptz,
  applied_by    uuid references profiles(id) on delete set null
);

create index if not exists idx_extractions_project on extractions(project_id, created_at desc);
create index if not exists idx_extractions_status on extractions(project_id, status);

alter table extractions enable row level security;

-- Extractions carry supplier pricing, so they sit on the internal side of the
-- same boundary as submissions, approvals, and project files.
drop policy if exists "internal read extractions" on extractions;
drop policy if exists "internal write extractions" on extractions;

create policy "internal read extractions" on extractions
  for select using (public.is_internal() and public.has_project_access(project_id));
create policy "internal write extractions" on extractions
  for all using (public.is_internal() and public.has_project_access(project_id))
  with check (public.is_internal() and public.has_project_access(project_id));
