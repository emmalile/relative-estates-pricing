-- ═══════════════════════════════════════════════════════
-- APPROVAL AUDIT LOG
-- ═══════════════════════════════════════════════════════
-- Procurement disputes are settled by a record of who approved what, when,
-- and at what price. The approvals table only holds the current state: it
-- can say a line is approved, but not who approved it, when, at what the
-- price was at the time, or that it was rejected twice first.
--
-- Append-only by policy: internal roles may insert and read, nobody may
-- update or delete. A log you can edit settles nothing.
--
-- Safe to run more than once, and safe on a live database — it only adds a
-- table and its policies.
--
-- Run this in the Supabase SQL editor:
--   Supabase dashboard → SQL Editor → New query → paste → Run
--
-- NOTE: this creates the table. Nothing writes to it yet — wiring
-- /api/approvals to append a row on every status change is the other half,
-- and is deliberately not bundled with a schema change.
-- ═══════════════════════════════════════════════════════

create table if not exists approval_events (
  id           uuid default gen_random_uuid() primary key,
  project_id   uuid references projects(id) on delete cascade,
  category     text not null,
  item_key     text not null,

  -- What changed.
  from_status  text,
  to_status    text not null,

  -- What the numbers were at the moment of the decision. Snapshotted rather
  -- than joined, because the point of the record is what was true then —
  -- a later re-quote must not rewrite the history of an approval.
  unit_price   numeric,
  quantity     numeric,
  line_total   numeric,

  -- Who. Kept as an id and a denormalised email so the record survives the
  -- person's profile being removed.
  actor_id     uuid references auth.users(id) on delete set null,
  actor_email  text,

  created_at   timestamptz not null default now()
);

create index if not exists idx_approval_events_project
  on approval_events(project_id, created_at desc);
create index if not exists idx_approval_events_item
  on approval_events(project_id, category, item_key, created_at desc);

alter table approval_events enable row level security;

drop policy if exists "internal read approval events" on approval_events;
drop policy if exists "internal append approval events" on approval_events;

-- Readable by the internal roles that can already see the approvals it
-- describes, and only for projects they have access to.
create policy "internal read approval events" on approval_events
  for select using (public.is_internal() and public.has_project_access(project_id));

-- Insert only. No update policy and no delete policy exist, so neither is
-- permitted for any role short of the service key.
create policy "internal append approval events" on approval_events
  for insert with check (public.is_internal() and public.has_project_access(project_id));

-- ── DONE ─────────────────────────────────────────────────
-- One table, append-only. Nothing else changes: approvals keeps holding
-- current state, and this holds how it got there.
