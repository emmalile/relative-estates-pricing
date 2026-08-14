-- ═══════════════════════════════════════════════════════════════
-- RELATIVE ESTATE — DROPBOX FILE INDEX
-- Already applied to the live project. Kept here so the schema is
-- described in the repo rather than only in the database.
--
-- Requires supabase-auth-migration.sql to have run first: the policies
-- below use is_internal() and has_project_access() from it.
--
-- Environment variables this needs (server-side only):
--   DROPBOX_APP_KEY
--   DROPBOX_APP_SECRET
-- ═══════════════════════════════════════════════════════════════

-- One Dropbox account for the whole team, so a singleton row.
--
-- RLS is enabled with NO policies on purpose: that makes the table
-- unreachable by anon and authenticated alike, including admins. The
-- refresh token is a long-lived credential and only ever needs to be read
-- server-side by the service-role client, which bypasses RLS. Connection
-- status reaches the UI through /api/dropbox/status, which returns
-- metadata only and never the tokens.
create table if not exists dropbox_connection (
  id             int primary key default 1 check (id = 1),
  account_id     text,
  account_email  text,
  account_name   text,
  access_token   text,
  refresh_token  text not null,
  expires_at     timestamptz,
  connected_by   uuid references profiles(id) on delete set null,
  connected_at   timestamptz default now(),
  updated_at     timestamptz default now()
);

alter table dropbox_connection enable row level security;
-- deliberately no policies — service role only

-- Which Dropbox folder backs which project. The cursor lets sync ask
-- Dropbox for changes only, rather than re-listing the whole folder.
create table if not exists project_folders (
  project_id      uuid primary key references projects(id) on delete cascade,
  dropbox_path    text not null,
  cursor          text,
  last_synced_at  timestamptz,
  last_error      text,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Cached file metadata. Never file content — Dropbox stays the source of
-- truth, and downloads go through short-lived temporary links.
create table if not exists project_files (
  id                uuid default gen_random_uuid() primary key,
  project_id        uuid references projects(id) on delete cascade,
  dropbox_id        text not null,
  path_lower        text not null,
  path_display      text not null,
  name              text not null,
  ext               text,
  size_bytes        bigint,
  rev               text,
  client_modified   timestamptz,
  server_modified   timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique(project_id, dropbox_id)
);

create index if not exists idx_project_files_project on project_files(project_id);
create index if not exists idx_project_files_ext on project_files(project_id, ext);

alter table project_folders enable row level security;
alter table project_files   enable row level security;

-- Files are internal-only: clients never see them. Same boundary as
-- submissions and approvals.
drop policy if exists "internal read project_folders" on project_folders;
drop policy if exists "admins write project_folders" on project_folders;
drop policy if exists "internal read project_files" on project_files;
drop policy if exists "internal write project_files" on project_files;

create policy "internal read project_folders" on project_folders
  for select using (public.is_internal() and public.has_project_access(project_id));
create policy "admins write project_folders" on project_folders
  for all using (public.is_admin()) with check (public.is_admin());

create policy "internal read project_files" on project_files
  for select using (public.is_internal() and public.has_project_access(project_id));
create policy "internal write project_files" on project_files
  for all using (public.is_internal() and public.has_project_access(project_id))
  with check (public.is_internal() and public.has_project_access(project_id));
