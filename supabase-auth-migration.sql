-- ═══════════════════════════════════════════════════════════════
-- RELATIVE ESTATES — AUTH & ACCESS CONTROL
-- Run this in Supabase: SQL Editor > New Query > Paste > Run
--
-- ⚠️  RUN THIS ONLY AFTER the new application code is deployed.
--     It replaces the "allow everyone" policies with real ones, so
--     the old code (which talks to Supabase with no signed-in user)
--     will stop working the moment this runs.
--
-- ROLLOUT ORDER
--   1. Deploy the app code that goes with this migration
--   2. Supabase > Authentication > Providers > enable Google, and
--      enable Email (magic link)
--   3. Add SUPABASE_SERVICE_ROLE_KEY to .env.local and to Vercel
--      (Project Settings > API > service_role — never NEXT_PUBLIC_)
--   4. Run PART 1 and PART 2 of this file
--   5. Sign in once with your Google account (you will be told you
--      have no access — that is expected, it just creates your
--      auth record)
--   6. Run PART 3 to make yourself the owner, using your email
--   7. Run PART 4 to switch the old open policies off
-- ═══════════════════════════════════════════════════════════════


-- ── PART 1: TABLES ─────────────────────────────────────────────

-- One row per person who can sign in. A row here IS the grant of
-- access: signing in with Google does NOT create one. Someone with
-- an auth record but no profile can log in and see nothing, which is
-- what we want — access is by invitation, not by knowing the URL.
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'client'
              check (role in ('owner', 'admin', 'member', 'client')),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Which scoped users can see which projects.
--
-- owner and admin do NOT need rows here — they see everything by role.
-- member and client see only the projects listed for them, so deleting
-- a row here is exactly the "remove someone from a project" action.
create table if not exists project_members (
  id          uuid default gen_random_uuid() primary key,
  project_id  uuid references projects(id) on delete cascade,
  user_id     uuid references profiles(id) on delete cascade,
  added_by    uuid references profiles(id) on delete set null,
  created_at  timestamptz default now(),
  unique(project_id, user_id)
);

create index if not exists idx_project_members_user on project_members(user_id);
create index if not exists idx_project_members_project on project_members(project_id);

-- Lets an admin grant access to someone who has never signed in.
-- A profile cannot exist before then (profiles.id references auth.users),
-- so the grant is keyed by email and converted into a real profile on that
-- person's first sign-in. See lib/invitations.js.
create table if not exists invitations (
  email        text primary key,
  role         text not null default 'client'
               check (role in ('owner', 'admin', 'member', 'client')),
  project_ids  uuid[] not null default '{}',
  invited_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz default now()
);


-- ── PART 2: HELPER FUNCTIONS ───────────────────────────────────
--
-- These are SECURITY DEFINER on purpose. A policy on `profiles` that
-- needed to read `profiles` to decide access would recurse forever;
-- running these as the definer sidesteps that. They are read-only and
-- take no user input, so they cannot be used to escalate.

create or replace function public.current_user_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- owner + admin: full access to everything.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_user_role() in ('owner', 'admin'), false)
$$;

-- owner + admin + member: allowed to see cost, margin and profit.
-- Clients are deliberately excluded.
create or replace function public.is_internal()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_user_role() in ('owner', 'admin', 'member'), false)
$$;

-- Admins see every project; everyone else sees only what they are
-- explicitly a member of.
create or replace function public.has_project_access(pid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1 from public.project_members m
      where m.project_id = pid and m.user_id = auth.uid()
    )
$$;


-- ── PART 3: BOOTSTRAP YOURSELF AS OWNER ────────────────────────
--
-- Run this AFTER signing in with Google once, so that your row in
-- auth.users exists. Replace the email with the one you signed in with.
--
--   insert into profiles (id, email, full_name, role)
--   select id, email, 'Emma', 'owner' from auth.users
--   where email = 'emma.lile926@gmail.com'
--   on conflict (id) do update set role = 'owner';
--
-- Verify it worked:
--   select email, role from profiles;


-- ── PART 4: ROW LEVEL SECURITY ─────────────────────────────────
-- Everything below replaces the old "Allow all for anon" policies.

alter table profiles        enable row level security;
alter table project_members enable row level security;
alter table invitations     enable row level security;
alter table projects        enable row level security;
alter table schedules       enable row level security;
alter table submissions     enable row level security;
alter table approvals       enable row level security;

-- Drop the old wide-open policies from supabase-schema.sql.
drop policy if exists "Allow all for anon" on projects;
drop policy if exists "Allow all for anon" on schedules;
drop policy if exists "Allow all for anon" on submissions;
drop policy if exists "Allow all for anon" on approvals;

-- Idempotent: profiles and project_members were locked down ahead of the
-- rest (they are new tables that production never touches, and leaving
-- them unprotected would have let anyone with the anon key insert
-- themselves as owner). Dropping first lets this file be re-run safely.
drop policy if exists "read own profile" on profiles;
drop policy if exists "admins manage profiles" on profiles;
drop policy if exists "read own memberships" on project_members;
drop policy if exists "admins manage memberships" on project_members;
drop policy if exists "admins manage invitations" on invitations;
drop policy if exists "read accessible projects" on projects;
drop policy if exists "internal update projects" on projects;
drop policy if exists "admins create projects" on projects;
drop policy if exists "admins delete projects" on projects;
drop policy if exists "read accessible schedules" on schedules;
drop policy if exists "internal write schedules" on schedules;
drop policy if exists "read accessible submissions" on submissions;
drop policy if exists "internal write submissions" on submissions;
drop policy if exists "read accessible approvals" on approvals;
drop policy if exists "internal write approvals" on approvals;

-- The helper functions must not be callable by anon over /rest/v1/rpc.
-- Only signed-in users need them (policy evaluation runs as the
-- authenticated role); the service-role client bypasses RLS entirely.
revoke execute on function public.current_user_role()      from public, anon;
revoke execute on function public.is_admin()               from public, anon;
revoke execute on function public.is_internal()            from public, anon;
revoke execute on function public.has_project_access(uuid) from public, anon;
grant execute on function public.current_user_role()       to authenticated, service_role;
grant execute on function public.is_admin()                to authenticated, service_role;
grant execute on function public.is_internal()             to authenticated, service_role;
grant execute on function public.has_project_access(uuid)  to authenticated, service_role;

-- profiles ------------------------------------------------------
-- You can always read your own row (the app needs it to know your
-- role). Admins can read and manage everyone.
create policy "read own profile" on profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "admins manage profiles" on profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- project_members -----------------------------------------------
create policy "read own memberships" on project_members
  for select using (user_id = auth.uid() or public.is_admin());
create policy "admins manage memberships" on project_members
  for all using (public.is_admin()) with check (public.is_admin());

-- invitations ---------------------------------------------------
-- Admins only. The sign-in callback reads this through the service-role
-- client, because at that moment the person has no profile and therefore
-- no role for a policy to check.
create policy "admins manage invitations" on invitations
  for all using (public.is_admin()) with check (public.is_admin());

-- projects ------------------------------------------------------
create policy "read accessible projects" on projects
  for select using (public.has_project_access(id));
create policy "internal update projects" on projects
  for update using (public.is_internal() and public.has_project_access(id))
  with check (public.is_internal() and public.has_project_access(id));
create policy "admins create projects" on projects
  for insert with check (public.is_admin());
create policy "admins delete projects" on projects
  for delete using (public.is_admin());

-- schedules -----------------------------------------------------
create policy "read accessible schedules" on schedules
  for select using (public.has_project_access(project_id));
create policy "internal write schedules" on schedules
  for all using (public.is_internal() and public.has_project_access(project_id))
  with check (public.is_internal() and public.has_project_access(project_id));

-- submissions ---------------------------------------------------
-- NOTE: submissions hold raw manufacturer pricing — your cost.
-- Clients can currently read them for their own projects because the
-- client page still computes prices in the browser. Closing that is
-- the next phase: the client view moves to a server-computed feed and
-- this policy tightens to is_internal(). Until then the exposure is
-- limited to signed-in clients on their own projects, rather than
-- anyone on the internet as it was before.
create policy "read accessible submissions" on submissions
  for select using (public.has_project_access(project_id));
create policy "internal write submissions" on submissions
  for all using (public.is_internal() and public.has_project_access(project_id))
  with check (public.is_internal() and public.has_project_access(project_id));

-- approvals -----------------------------------------------------
-- Same note as above: approvals carry markup_override, shipping_ddp
-- and internal notes.
create policy "read accessible approvals" on approvals
  for select using (public.has_project_access(project_id));
create policy "internal write approvals" on approvals
  for all using (public.is_internal() and public.has_project_access(project_id))
  with check (public.is_internal() and public.has_project_access(project_id));


-- ── PART 5: THE OTHER THREE TABLES ─────────────────────────────
-- vendors, repository_products and repository_quotes are used by the
-- app but were never in supabase-schema.sql, so they were created
-- through the Supabase UI and their RLS state is unknown.
--
-- These are internal-only reference data — no client should see them.
-- If any of these tables does not exist in your project, delete that
-- block and re-run.

alter table vendors             enable row level security;
alter table repository_products enable row level security;
alter table repository_quotes   enable row level security;

drop policy if exists "Allow all for anon" on vendors;
drop policy if exists "Allow all for anon" on repository_products;
drop policy if exists "Allow all for anon" on repository_quotes;
drop policy if exists "internal all vendors" on vendors;
drop policy if exists "internal all repository_products" on repository_products;
drop policy if exists "internal all repository_quotes" on repository_quotes;

create policy "internal all vendors" on vendors
  for all using (public.is_internal()) with check (public.is_internal());
create policy "internal all repository_products" on repository_products
  for all using (public.is_internal()) with check (public.is_internal());
create policy "internal all repository_quotes" on repository_quotes
  for all using (public.is_internal()) with check (public.is_internal());


-- ── DONE ───────────────────────────────────────────────────────
-- Sanity checks:
--   select email, role from profiles;
--   select tablename, policyname from pg_policies where schemaname = 'public';
--
-- The manufacturer form is intentionally NOT covered by any policy
-- above. It has no signed-in user, so it goes through server routes
-- that use the service-role key and read only what that one form
-- needs. See app/api/form/.
