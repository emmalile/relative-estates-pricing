-- ═══════════════════════════════════════════════════════
-- PER-VENDOR FORM LINKS
-- ═══════════════════════════════════════════════════════
-- The manufacturer pricing form is public by design — vendors are outside
-- companies and we decided not to make them create accounts. But the link
-- identified a project and a category, never a vendor, and two things
-- followed from that:
--
--   1. The URL is /projects/<slug>/form/<category>, and slugs are generated
--      from project names. Anyone who guesses one could read the material
--      schedule and the pricing the vendor had already submitted.
--
--   2. A submission was keyed on schedules.manufacturer rather than on who
--      was filling the form in. Send the same link to two vendors and the
--      second sees the first's prices and overwrites them.
--
-- A token makes the link identify the vendor. It is unguessable, it can be
-- revoked without changing anything else, and it tells the form which
-- vendor's pricing to load and save.
--
-- Safe to run more than once. It backfills a token for every schedule that
-- already names a manufacturer, so no existing vendor is orphaned.
--
-- ⚠️  OPERATIONAL NOTE — links already sent to vendors stop working.
-- That is the point: those are the links that anyone holding the slug could
-- open. After running this, copy each vendor's new link from the schedule's
-- ⋮ menu on the dashboard and send it on.
-- ═══════════════════════════════════════════════════════

create extension if not exists pgcrypto;

create table if not exists vendor_form_tokens (
  id           uuid default gen_random_uuid() primary key,
  project_id   uuid not null references projects(id) on delete cascade,
  category     text not null,

  -- Who this link is for. Matches submissions.manufacturer_name, which is
  -- how a quote has always been attributed — the token just makes the form
  -- read it from the link instead of from the schedule.
  vendor_name  text not null,

  -- 32 bytes of urandom, hex encoded. Long enough that guessing is not a
  -- strategy, short enough to survive being pasted into an email.
  token        text not null unique default encode(gen_random_bytes(32), 'hex'),

  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  last_used_at timestamptz,
  revoked_at   timestamptz,

  -- One live link per vendor per schedule. Re-issuing replaces rather than
  -- accumulates, so there is never a second working link you forgot about.
  unique (project_id, category, vendor_name)
);

create index if not exists idx_vendor_form_tokens_lookup
  on vendor_form_tokens(token) where revoked_at is null;

alter table vendor_form_tokens enable row level security;

drop policy if exists "internal manage vendor tokens" on vendor_form_tokens;

-- Internal roles manage links for projects they can access. The public form
-- route reads this table through the service-role client, which bypasses
-- RLS — deliberately, since the vendor opening the link has no account at
-- all. That route checks the token itself and returns only that vendor's
-- own data.
create policy "internal manage vendor tokens" on vendor_form_tokens
  for all using (public.is_internal() and public.has_project_access(project_id))
  with check (public.is_internal() and public.has_project_access(project_id));

-- ── Backfill ─────────────────────────────────────────────
-- Every schedule that names a manufacturer gets a link, so the first thing
-- you see on the dashboard after this is a link to send rather than an
-- empty list.
insert into vendor_form_tokens (project_id, category, vendor_name)
select s.project_id, s.category, trim(s.manufacturer)
from schedules s
where coalesce(trim(s.manufacturer), '') <> ''
on conflict (project_id, category, vendor_name) do nothing;

-- Vendors that have already quoted but are not the schedule's named
-- manufacturer also get one — on a category where two vendors quoted, both
-- need their own link from here on.
insert into vendor_form_tokens (project_id, category, vendor_name)
select distinct sub.project_id, sub.category, trim(sub.manufacturer_name)
from submissions sub
where coalesce(trim(sub.manufacturer_name), '') <> ''
on conflict (project_id, category, vendor_name) do nothing;

-- ── DONE ─────────────────────────────────────────────────
-- Nothing else changes. Submissions, pricing and approvals are untouched;
-- this only decides who is allowed to open a form and whose pricing they
-- see when they do.
