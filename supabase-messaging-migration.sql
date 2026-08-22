-- ═══════════════════════════════════════════════════════
-- CLIENT AND VENDOR MESSAGING — SHARED INBOX
-- ═══════════════════════════════════════════════════════
-- Client questions arrive by text message and are answered on one
-- person's phone. Nobody else can see the thread, nothing said in it
-- reaches the project record, and when that person is unavailable the
-- question waits. This migration moves those conversations into the
-- app so the whole team can see and answer them.
--
-- This is the plumbing only. No message is answered automatically by
-- anything in this file — every reply is typed by a person. The
-- automatic answer comes later and sits on top of these tables.
--
-- ── THE ONE THING TO GET RIGHT NOW ──
-- contacts.audience. A client and a vendor may not be told the same
-- things, and they are redacted in OPPOSITE directions:
--
--   client       may see the released client price. Never cost, never
--                markup, never DDP, never internal notes.
--   manufacturer may see their own line items and their own quote.
--                Never the client price — they know what they quoted,
--                so the client's number is our margin in one
--                subtraction — and never another vendor's pricing.
--
-- Neither of them sees what the dashboard shows. So the column is NOT
-- NULL with no default: a row that defaulted to something permissive is
-- exactly the row that leaks later.
--
-- 'unknown' is a real audience rather than a missing one. A number we do
-- not recognise still texts us, and the honest record of that is a row
-- saying so — one that every reader must treat as "disclose nothing"
-- until a person links it to a client or a vendor.
--
-- Safe to run more than once.
--
-- Run this in the Supabase SQL editor:
--   Supabase dashboard → SQL Editor → New query → paste → Run
-- ═══════════════════════════════════════════════════════

create extension if not exists pgcrypto;


-- ── 1. CONTACTS ──────────────────────────────────────────
-- A phone number we recognise, and what it is allowed to be told.
--
-- The phone number is the whole of the identification, which is not
-- much: it is not a password and it can be spoofed. That is why an
-- unrecognised number is never answered with project data — it gets an
-- acknowledgement and raises a task for a person. See lib/messaging.js.
create table if not exists contacts (
  id           uuid default gen_random_uuid() primary key,

  -- E.164, normalised on the way in (+13105551234). Unique, because two
  -- rows for one number means two answers to "what may this person see".
  phone        text not null unique,

  -- The whole point of this table. No default on purpose.
  audience     text not null
               check (audience in ('unknown', 'client', 'manufacturer', 'internal')),

  -- Who this is. A client usually has an account; a vendor deliberately
  -- does not — the pricing form is open by design — so vendors are
  -- identified against the vendor list instead.
  profile_id   uuid references profiles(id) on delete set null,
  vendor_id    uuid references vendors(id) on delete set null,

  -- The project their messages are about, when there is only one. Null
  -- means "ask them" rather than "any project": a vendor quotes across
  -- many, and guessing which one a question is about is how the wrong
  -- project's data ends up in a reply.
  project_id   uuid references projects(id) on delete set null,

  display_name text,
  notes        text,

  -- STOP. Set when they opt out; nothing outbound may be sent while it
  -- is set, and only they can clear it by texting START.
  opted_out_at timestamptz,

  created_at   timestamptz not null default now(),
  created_by   uuid references profiles(id) on delete set null,
  updated_at   timestamptz not null default now()
);

create index if not exists idx_contacts_project on contacts(project_id);
create index if not exists idx_contacts_profile on contacts(profile_id);
create index if not exists idx_contacts_vendor  on contacts(vendor_id);


-- ── 2. CONVERSATIONS ─────────────────────────────────────
-- One thread per contact per project. Splitting by project is what lets
-- a vendor who quotes on four jobs have four threads instead of one
-- ambiguous one.
create table if not exists conversations (
  id              uuid default gen_random_uuid() primary key,
  contact_id      uuid not null references contacts(id) on delete cascade,
  project_id      uuid references projects(id) on delete set null,

  -- Built for more than one channel from the start. WhatsApp arrives
  -- through the same webhook with a different prefix on the number, and
  -- a thread should not change identity when someone switches app.
  channel         text not null default 'sms'
                  check (channel in ('sms', 'whatsapp')),

  status          text not null default 'open'
                  check (status in ('open', 'waiting', 'closed')),

  -- Who owns answering this. Null means nobody has picked it up, which
  -- is the state the inbox sorts to the top.
  assignee_id     uuid references profiles(id) on delete set null,

  subject         text,
  last_message_at timestamptz not null default now(),

  -- Set when a person opens the thread, so the list can show what has
  -- not been looked at without a per-user read table.
  last_read_at    timestamptz,

  created_at      timestamptz not null default now()
);

create index if not exists idx_conversations_recent
  on conversations(status, last_message_at desc);
create index if not exists idx_conversations_contact on conversations(contact_id);
create index if not exists idx_conversations_project on conversations(project_id);

-- One open thread per contact per project. A second inbound message
-- continues the thread rather than starting a rival one.
create unique index if not exists idx_conversations_open_unique
  on conversations(contact_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status <> 'closed';


-- ── 3. MESSAGES ──────────────────────────────────────────
-- Every message in and out, including the ones that failed to send.
create table if not exists messages (
  id               uuid default gen_random_uuid() primary key,
  conversation_id  uuid not null references conversations(id) on delete cascade,

  direction        text not null check (direction in ('inbound', 'outbound')),

  -- Who produced it. 'assistant' is unused until automatic answers are
  -- switched on, and exists now so that turning them on does not need a
  -- migration and, more to the point, so that an automatic answer is
  -- distinguishable from a person's for as long as the thread exists.
  author           text not null default 'contact'
                   check (author in ('contact', 'staff', 'assistant')),

  body             text not null,

  -- Who typed it, for outbound staff messages.
  sent_by          uuid references profiles(id) on delete set null,

  -- Twilio's id for the message, and what became of it.
  external_id      text,
  status           text not null default 'received'
                   check (status in ('received', 'queued', 'sent', 'failed')),
  error            text,

  created_at       timestamptz not null default now()
);

create index if not exists idx_messages_conversation
  on messages(conversation_id, created_at);
create index if not exists idx_messages_external on messages(external_id);


-- ── 4. TASKS ─────────────────────────────────────────────
-- A question nobody has answered yet, owned by a named person.
--
-- This is the fallback that makes the whole thing safe to rely on: if
-- there is any doubt about who answers a message, a task exists saying
-- who does. Later, when the assistant is switched on, the same table
-- takes what it declined to answer.
create table if not exists tasks (
  id              uuid default gen_random_uuid() primary key,

  project_id      uuid references projects(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,

  -- The message that raised it, so the task can be read in context.
  message_id      uuid references messages(id) on delete set null,

  title           text not null,
  detail          text,

  -- Why this needs a person. 'unknown_contact' is the one that matters
  -- most: a number we do not recognise was told nothing, and somebody
  -- has to decide who it is.
  reason          text not null default 'inbound_message'
                  check (reason in ('inbound_message', 'unknown_contact',
                                    'assistant_declined', 'manual')),

  assignee_id     uuid references profiles(id) on delete set null,
  status          text not null default 'open'
                  check (status in ('open', 'done', 'cancelled')),

  due_at          timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid references profiles(id) on delete set null,
  completed_at    timestamptz,
  completed_by    uuid references profiles(id) on delete set null
);

create index if not exists idx_tasks_open
  on tasks(status, created_at desc) where status = 'open';
create index if not exists idx_tasks_assignee on tasks(assignee_id, status);
create index if not exists idx_tasks_conversation on tasks(conversation_id);


-- ── 5. WHO ANSWERS FOR A PROJECT ─────────────────────────
-- The person a project's messages go to when nobody has claimed them.
-- Without this every inbound message is assigned to nobody, which is
-- the situation this feature exists to end.
alter table projects
  add column if not exists primary_contact_id uuid references profiles(id) on delete set null;


-- ── 6. ROW LEVEL SECURITY ────────────────────────────────
-- Internal only, all four tables. These carry what clients and vendors
-- have said to us and what we intend to say back — none of it belongs
-- in the client view.
--
-- The inbound webhook has no signed-in user (Twilio is not a person) and
-- goes through the service-role client, exactly like the vendor form.
-- That route authenticates the request by Twilio's signature instead.
alter table contacts      enable row level security;
alter table conversations enable row level security;
alter table messages      enable row level security;
alter table tasks         enable row level security;

drop policy if exists "internal all contacts"      on contacts;
drop policy if exists "internal all conversations" on conversations;
drop policy if exists "internal all messages"      on messages;
drop policy if exists "internal all tasks"         on tasks;

create policy "internal all contacts" on contacts
  for all using (public.is_internal()) with check (public.is_internal());

-- Scoped by project where there is one. A member added to two projects
-- sees those two projects' threads and not the rest.
create policy "internal all conversations" on conversations
  for all using (
    public.is_internal()
    and (project_id is null or public.has_project_access(project_id))
  ) with check (
    public.is_internal()
    and (project_id is null or public.has_project_access(project_id))
  );

create policy "internal all messages" on messages
  for all using (
    public.is_internal()
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.project_id is null or public.has_project_access(c.project_id))
    )
  ) with check (
    public.is_internal()
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.project_id is null or public.has_project_access(c.project_id))
    )
  );

create policy "internal all tasks" on tasks
  for all using (
    public.is_internal()
    and (project_id is null or public.has_project_access(project_id))
  ) with check (
    public.is_internal()
    and (project_id is null or public.has_project_access(project_id))
  );


-- ── DONE ─────────────────────────────────────────────────
-- Nothing is connected to a phone network yet. Until TWILIO_ACCOUNT_SID,
-- TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER are set, the inbox is
-- readable and empty, and /settings/messaging says exactly which of the
-- three is missing.
--
-- Sanity checks:
--   select audience, count(*) from contacts group by audience;
--   select tablename, policyname from pg_policies
--    where tablename in ('contacts','conversations','messages','tasks');
