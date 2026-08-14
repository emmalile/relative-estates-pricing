-- ═══════════════════════════════════════════════════════
-- RELATIVE ESTATE — MATERIAL PRICING SYSTEM
-- Run this entire file in Supabase SQL Editor
-- Project Settings > SQL Editor > New Query > Paste > Run
-- ═══════════════════════════════════════════════════════

-- ── 1. PROJECTS ─────────────────────────────────────────
-- One row per project (e.g. "Residence at Oak Hill")
create table if not exists projects (
  id          uuid default gen_random_uuid() primary key,
  name        text not null,
  client      text,
  slug        text unique not null,
  status      text default 'active',
  categories  jsonb not null default '[]',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ── 2. CATEGORY SCHEDULES ───────────────────────────────
-- One row per category per project
-- e.g. project oak-hill has a "stone" schedule and a "doors" schedule
create table if not exists schedules (
  id              uuid default gen_random_uuid() primary key,
  project_id      uuid references projects(id) on delete cascade,
  category        text not null,           -- 'stone', 'doors', 'hardware', etc.
  manufacturer    text not null,           -- who the form is sent to
  items           jsonb not null default '[]',  -- parsed CSV rows
  created_at      timestamptz default now(),
  unique(project_id, category)
);

-- ── 3. SUBMISSIONS ──────────────────────────────────────
-- One row per manufacturer form submission
-- Multiple submissions per schedule (if multiple manufacturers)
create table if not exists submissions (
  id                uuid default gen_random_uuid() primary key,
  project_id        uuid references projects(id) on delete cascade,
  category          text not null,
  manufacturer_name text not null,
  pricing_data      jsonb not null default '[]',
  submitted_at      timestamptz default now()
);

-- ── 4. APPROVALS ────────────────────────────────────────
-- One row per line item per project
-- Tracks owner approval status, quantity, and notes
create table if not exists approvals (
  id          uuid default gen_random_uuid() primary key,
  project_id  uuid references projects(id) on delete cascade,
  category    text not null,
  item_key    text not null,    -- unique key: name|||finish|||cut
  status      text default 'pending',  -- pending | approved | rejected
  quantity    numeric default 0,
  notes       text default '',
  updated_at  timestamptz default now(),
  unique(project_id, category, item_key)
);

-- ── INDEXES for fast lookups ─────────────────────────────
create index if not exists idx_schedules_project on schedules(project_id);
create index if not exists idx_submissions_project on submissions(project_id);
create index if not exists idx_submissions_category on submissions(project_id, category);
create index if not exists idx_approvals_project on approvals(project_id);
create index if not exists idx_approvals_category on approvals(project_id, category);

-- ── ROW LEVEL SECURITY ───────────────────────────────────
-- Keeps data private. Only your app (via anon key) can read/write.
alter table projects enable row level security;
alter table schedules enable row level security;
alter table submissions enable row level security;
alter table approvals enable row level security;

-- Allow all operations via anon key (your app handles auth)
create policy "Allow all for anon" on projects for all using (true) with check (true);
create policy "Allow all for anon" on schedules for all using (true) with check (true);
create policy "Allow all for anon" on submissions for all using (true) with check (true);
create policy "Allow all for anon" on approvals for all using (true) with check (true);

-- ── DONE ─────────────────────────────────────────────────
-- You should see 4 tables in your Supabase Table Editor:
-- projects, schedules, submissions, approvals
