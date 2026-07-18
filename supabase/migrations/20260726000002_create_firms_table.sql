-- ============================================================================
-- Migration: create_firms_table
-- ============================================================================
-- Adds `firms`, the paying/organizational entity behind the Lawyer Firms
-- plan (Individuals and Lawyers plans stay per-profile; only Firms is
-- multi-seat). Built against real `profiles` table source
-- (20260711120000_create_profiles_table.sql) for the RLS pattern (own-row
-- via auth.uid(), admin via the JWT app_metadata role claim) and against
-- 20260726000000_create_billing_tables.sql for reuse of
-- public.set_updated_at().
--
-- FLAGGED ASSUMPTIONS -- none drawn from pasted source, all new decisions
-- made this session:
--   1. A firm has exactly one `owner_id` (a profiles.id) -- the person who
--      controls the firm's subscription. Firm-internal roles beyond
--      owner/member (e.g. billing admin distinct from firm owner) are NOT
--      modeled -- out of scope until a real permissions requirement shows
--      up. If firms need multiple billing-capable admins, this is wrong.
--   2. `owner_id` uses `on delete restrict`, not cascade: deleting a
--      profile that owns a firm is blocked at the DB level rather than
--      silently orphaning the firm or cascading into deleting it (and its
--      subscription/members). No product decision exists yet for
--      "what happens to a firm when its owner's account is deleted" --
--      this makes that case fail loudly instead of guessing.
--   3. `profiles.firm_id` is nullable and uses `on delete set null`: a
--      profile can belong to at most one firm, and deleting a firm detaches
--      its members rather than deleting their profiles. Multi-firm
--      membership (a lawyer under two firms) is NOT supported -- flagged
--      as out of scope, not silently assumed acceptable.
--   4. No seat-count enforcement lives here (no trigger capping members per
--      firm against a plan's max_seats). `plans.max_seats` is being added
--      in the next migration as a data column only -- enforcing it is
--      deferred to the checkout/member-invite application logic, not the
--      database.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: firms
-- ----------------------------------------------------------------------------
create table public.firms (
  id uuid primary key default gen_random_uuid(),

  name text not null
    constraint firms_name_length check (
      char_length(trim(name)) > 0 and char_length(name) <= 255
    ),

  owner_id uuid not null references public.profiles (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.firms is
  'Paying/organizational entity for the Lawyer Firms plan. Individuals and Lawyers plans remain per-profile and never reference this table.';

comment on column public.firms.owner_id is
  'The profile that controls this firm''s subscription. on delete restrict: deleting an owner profile while it still owns a firm is blocked, not silently cascaded -- see migration header, assumption #2.';

create trigger firms_set_updated_at
  before update on public.firms
  for each row
  execute function public.set_updated_at();

create index firms_owner_id_idx on public.firms (owner_id);

-- ----------------------------------------------------------------------------
-- profiles.firm_id -- links a member profile to at most one firm
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column firm_id uuid references public.firms (id) on delete set null;

comment on column public.profiles.firm_id is
  'Optional firm membership for the Lawyer Firms plan. Null for individual/lawyer-plan users. A profile may belong to at most one firm -- see migration header, assumption #3.';

create index profiles_firm_id_idx on public.profiles (firm_id);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.firms enable row level security;

-- The firm owner may read their own firm.
create policy firms_select_owner
  on public.firms
  for select
  to authenticated
  using (owner_id = auth.uid());

-- A member profile may read the firm it belongs to (not just the owner) --
-- needed so a non-owner lawyer at a firm can see which firm they're under.
create policy firms_select_member
  on public.firms
  for select
  to authenticated
  using (
    id in (select firm_id from public.profiles where id = auth.uid())
  );

-- Admins may read any firm.
create policy firms_select_admin
  on public.firms
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- No insert/update/delete policy for `authenticated`: firm creation (part
-- of the firm-plan checkout flow) and membership changes are service-layer
-- operations, not something a client session should be able to do directly
-- -- same reasoning profiles.md gives for why `role` isn't user-writable.