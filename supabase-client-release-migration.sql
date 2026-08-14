-- ═══════════════════════════════════════════════════════
-- CLIENT PRICE RELEASE
-- ═══════════════════════════════════════════════════════
-- Until now a manufacturer's quote reached the client the moment it was
-- submitted. The client's page recomputed the marked-up price on every
-- load, so a vendor filling in a form at 9pm changed what the client saw
-- at 9pm, before anyone internal had looked at it.
--
-- This adds a gate. A price is HELD until someone internal releases it,
-- and what gets released is a NUMBER, not a permission: the client price
-- is snapshotted onto the approvals row at the moment of release, and the
-- client page renders that snapshot. A later re-quote, or a change of
-- markup, moves the internal figure and leaves the client's alone until
-- someone releases again. That is the whole point — a client's price
-- should never change without somebody deciding it should.
--
--   client_released     is the client currently seeing a price at all
--   client_price        the per-unit price they are seeing
--   client_released_at  when it was released
--   client_released_by  who released it (email, denormalised like the
--                       audit log, so it survives the account)
--
-- ── ORDER OF OPERATIONS ──
-- Run this BEFORE deploying the code that reads it. The code treats
-- anything other than client_released = true as held, so if the column is
-- missing every client dashboard shows "Pricing in progress" until this
-- has run.
--
-- Existing rows are grandfathered to released. They are already on
-- clients' screens; a migration is not the place to take fifty-two prices
-- away from someone mid-project. Their client_price is left null, which
-- the client view reads as "show the live price", exactly as it does
-- today. Releasing any of those lines afterwards locks its number.
-- ═══════════════════════════════════════════════════════

alter table approvals add column if not exists client_price       numeric;
alter table approvals add column if not exists client_released_at timestamptz;
alter table approvals add column if not exists client_released_by text;

-- The gate itself, and the one-time grandfathering of what is already on
-- clients' screens, in a single block that fires only on the run that
-- creates the column.
--
-- Written this way rather than as "add column if not exists" followed by
-- an update, because that pair is not safe to run twice. By the second
-- run the table holds rows that are held ON PURPOSE — a quote that landed
-- this morning and has not been reviewed — and a blanket update would
-- publish every one of them. This file gets pasted into the SQL editor by
-- hand; it has to survive being pasted twice.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'approvals' and column_name = 'client_released'
  ) then
    alter table approvals add column client_released boolean not null default false;
    -- Every row that predates the gate. They are already visible to
    -- clients and a migration is not the place to take fifty-two prices
    -- away from someone mid-project.
    update approvals set client_released = true;
  end if;
end $$;

-- The dashboard asks "what in this category is still held?" on every load.
create index if not exists idx_approvals_client_released
  on approvals(project_id, category, client_released);

-- No policy changes. Releasing goes through /api/approvals/release, which
-- is internal-only and writes as the signed-in user, so the existing
-- "internal write approvals" policy already covers it. Clients read these
-- columns only through /api/client-view/[slug], which never emits them —
-- it sends the finished number and nothing about how it was decided.
