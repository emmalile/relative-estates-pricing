-- ═══════════════════════════════════════════════════════════════
-- RELATIVE ESTATE — VENDORS AND REPOSITORY FED FROM THE WORK
-- Applied to the live project. Kept here so the schema is described
-- in the repo rather than only in the database.
--
-- The vendor list and the product repository were both filled in by
-- hand, separately from the projects that produced the information.
-- A manufacturer could quote on a project and never appear as a
-- vendor — which is exactly what had happened.
-- ═══════════════════════════════════════════════════════════════

-- Vendors created by the app rather than typed in by hand.
alter table vendors add column if not exists auto_added boolean default false;

-- One row per name. Without this a vendor quoting on three projects
-- becomes three vendors, and the list stops meaning anything. Matching
-- is on the trimmed, lowercased name so " vendor #1" and "Vendor #1"
-- are one company.
create unique index if not exists idx_vendors_name_unique
  on vendors (lower(trim(name)));

-- Where a catalog product came from, so an automatically added one can
-- be traced back to the quote that produced it, and updated in place
-- rather than duplicated on the next approval.
alter table repository_products
  add column if not exists source_project_id uuid references projects(id) on delete set null,
  add column if not exists source_item_key text,
  add column if not exists quoted_at timestamptz,
  add column if not exists auto_added boolean default false;

create unique index if not exists idx_repo_products_source
  on repository_products (vendor_id, category, source_item_key)
  where source_item_key is not null;

-- Backfill: every manufacturer that had already quoted, or been named on
-- a schedule, without ever reaching the vendor list.
insert into vendors (name, categories, auto_added, notes)
select trim(m.name), jsonb_build_array(m.category), true,
       'Added automatically from a pricing submission.'
from (
  select distinct on (lower(trim(manufacturer_name)))
         manufacturer_name as name, category
  from submissions
  where coalesce(trim(manufacturer_name), '') <> ''
  order by lower(trim(manufacturer_name)), submitted_at
) m
where not exists (
  select 1 from vendors v where lower(trim(v.name)) = lower(trim(m.name))
);

insert into vendors (name, categories, auto_added, notes)
select trim(m.name), jsonb_build_array(m.category), true,
       'Added automatically from a project schedule.'
from (
  select distinct on (lower(trim(manufacturer)))
         manufacturer as name, category
  from schedules
  where coalesce(trim(manufacturer), '') <> ''
  order by lower(trim(manufacturer)), created_at
) m
where not exists (
  select 1 from vendors v where lower(trim(v.name)) = lower(trim(m.name))
);
