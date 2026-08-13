-- ═══════════════════════════════════════════════════════
-- SAMPLE TRACKING MIGRATION
-- ═══════════════════════════════════════════════════════
-- Adds a second, independent shipment to every approvals row: the sample
-- sent for an item (a stone sample, a door finish chip), tracked exactly
-- like the product but in its own columns, so a sample in transit can
-- never overwrite where the actual product is.
--
-- Safe to run more than once, and safe to run on a live database — it only
-- adds columns, and every existing row simply gets nulls (no sample sent).
--
-- Run this in the Supabase SQL editor:
--   Supabase dashboard → SQL Editor → New query → paste → Run
-- ═══════════════════════════════════════════════════════

-- ── Product shipment columns (Phase 3) ───────────────────
-- Already present on any database that has been running the shipment
-- tracking feature; included so a database built from scratch out of this
-- repo ends up with the same shape. Existing columns are left untouched.
alter table approvals add column if not exists shipment_status     text;
alter table approvals add column if not exists carrier             text;
alter table approvals add column if not exists tracking_number     text;
alter table approvals add column if not exists tracking_url        text;
alter table approvals add column if not exists eta                 date;
alter table approvals add column if not exists shipment_updated_at timestamptz;

-- ── Sample shipment columns ──────────────────────────────
alter table approvals add column if not exists sample_status          text;
alter table approvals add column if not exists sample_carrier         text;
alter table approvals add column if not exists sample_tracking_number text;
alter table approvals add column if not exists sample_tracking_url    text;
alter table approvals add column if not exists sample_eta             date;
alter table approvals add column if not exists sample_updated_at      timestamptz;

-- ── Stage constraints ────────────────────────────────────
-- Samples move through the same 7 stages as products, so both columns are
-- held to the same list — the one in lib/shipment.js INTERNAL_STAGES.
-- Keep the two in step: adding a stage there means adding it here.
do $$
begin
  alter table approvals add constraint approvals_shipment_status_check
    check (shipment_status is null or shipment_status in
      ('pending','production','transit','ground','warehouse','checkedin','delayed'));
exception
  when duplicate_object then null;  -- already constrained, nothing to do
end $$;

do $$
begin
  alter table approvals add constraint approvals_sample_status_check
    check (sample_status is null or sample_status in
      ('pending','production','transit','ground','warehouse','checkedin','delayed'));
exception
  when duplicate_object then null;
end $$;

-- ── Index ────────────────────────────────────────────────
-- Partial: only the handful of rows that actually have a sample out.
create index if not exists idx_approvals_sample_status
  on approvals(project_id, sample_status)
  where sample_status is not null;

-- ── DONE ─────────────────────────────────────────────────
-- Every item can now carry two shipments. Nothing else changes: pricing,
-- approvals, quantities and notes are untouched by this migration and by
-- the /api/tracking route that writes these columns.
