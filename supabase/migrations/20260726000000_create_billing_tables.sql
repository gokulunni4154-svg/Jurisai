-- ============================================================================
-- Migration: create_billing_tables
-- ============================================================================
-- Creates `plans` and `subscriptions` for Cashfree-backed subscription
-- billing. Built against real `profiles` table source (see
-- 20260711120000_create_profiles_table.sql) for the FK target and the RLS
-- pattern (own-row access via auth.uid(), admin access via the JWT
-- app_metadata role claim -- same authoritative source as
-- src/core/auth/mapper.ts).
--
-- FLAGGED ASSUMPTIONS -- none of these are drawn from pasted source:
--   1. Subscriptions are scoped to `profiles.id` (an individual user), not
--      to a firm/organization. No org/business table exists yet in this
--      project (profiles' own migration comment says role-specific tables
--      like `business_profiles` are future work). If billing should
--      eventually be per-firm rather than per-seat, this FK target changes
--      and this migration should NOT be treated as final until that's
--      decided.
--   2. `plans` is a real table (not a hardcoded enum/const) so tiers can be
--      priced/toggled without a code deploy. Trade-off: one more table to
--      join, and it needs to be seeded before `subscriptions` can reference
--      a row -- seeding is NOT done here, deliberately left as a separate
--      concern (likely a seed script or an admin UI, not this migration).
--   3. `subscriptions.status` is a plain `text` column with a permissive
--      CHECK, not a Postgres enum. Cashfree's real subscription lifecycle
--      status strings have NOT been verified against their actual API docs
--      or a real webhook payload in this project -- the values below
--      (active/pending/on_hold/cancelled/expired) are a reasonable guess
--      at a typical recurring-billing lifecycle, not a confirmed contract.
--      Revisit this CHECK constraint once the Cashfree webhook handler is
--      built against their real, verified payload shape -- do not treat
--      these values as authoritative until then.
--   4. Reuses `public.set_updated_at()`, already created in the profiles
--      migration, rather than redefining it -- confirmed safe since
--      `create function` for that trigger function already ran once.
--   5. One active subscription per profile is enforced via a partial
--      unique index (only one non-terminal-status row per profile). This
--      is a design choice, not confirmed with you -- if a user should ever
--      be allowed multiple concurrent subscriptions (e.g. add-ons), this
--      constraint is wrong and needs to come out.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: plans
-- ----------------------------------------------------------------------------
create table public.plans (
  id uuid primary key default gen_random_uuid(),

  -- Internal stable key for referencing a plan from code (e.g. 'free',
  -- 'pro', 'enterprise'), separate from the human-facing name so the
  -- display name can change without breaking references.
  slug text not null unique
    constraint plans_slug_format check (slug ~ '^[a-z0-9_-]+$'),

  name text not null
    constraint plans_name_length check (char_length(trim(name)) > 0),

  description text,

  -- Smallest currency unit (paise), not rupees, to avoid float rounding.
  -- Matches how Cashfree's own API expresses amounts.
  price_paise integer not null
    constraint plans_price_non_negative check (price_paise >= 0),

  billing_interval text not null default 'monthly'
    constraint plans_billing_interval_valid check (
      billing_interval in ('monthly', 'yearly')
    ),

  -- Cashfree-side plan identifier, created via their Subscriptions API.
  -- Nullable because a plan can exist in our DB (e.g. 'free') without any
  -- corresponding Cashfree plan -- a free tier has nothing to bill.
  cashfree_plan_id text unique,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.plans is
  'Billing plan definitions (tiers/pricing). Seeded separately; not all plans require a Cashfree-side plan (e.g. a free tier).';

comment on column public.plans.price_paise is
  'Price in paise (1/100 rupee), not rupees, to avoid float rounding in currency math.';

comment on column public.plans.cashfree_plan_id is
  'Cashfree Subscriptions API plan_id. Null for plans with no billing event (e.g. free tier).';

create trigger plans_set_updated_at
  before update on public.plans
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Table: subscriptions
-- ----------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),

  profile_id uuid not null references public.profiles (id) on delete cascade,

  plan_id uuid not null references public.plans (id),

  -- Cashfree-side subscription identifier. Nullable until the Cashfree
  -- Subscriptions API call that creates it succeeds -- a row can exist in
  -- a transient pre-creation state (see `status` below) before this is set.
  cashfree_subscription_id text unique,

  status text not null default 'pending'
    constraint subscriptions_status_valid check (
      status in ('pending', 'active', 'on_hold', 'cancelled', 'expired')
    ),

  current_period_start timestamptz,
  current_period_end timestamptz,

  cancelled_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.subscriptions is
  'Per-profile subscription state, mirroring a Cashfree Subscriptions API subscription. Status values are NOT yet verified against a real Cashfree webhook payload -- see migration header.';

comment on column public.subscriptions.cashfree_subscription_id is
  'Cashfree Subscriptions API subscription_id. Null until subscription creation succeeds on Cashfree''s side.';

comment on column public.subscriptions.status is
  'Lifecycle status. Values are a reasonable guess at Cashfree''s real lifecycle, NOT confirmed against their docs or a real webhook payload -- see migration header, assumption #3.';

-- At most one non-terminal subscription per profile.
create unique index subscriptions_one_active_per_profile
  on public.subscriptions (profile_id)
  where status in ('pending', 'active', 'on_hold');

create index subscriptions_profile_id_idx on public.subscriptions (profile_id);
create index subscriptions_plan_id_idx on public.subscriptions (plan_id);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;

-- Any authenticated user may read active plans (needed to render a
-- pricing/upgrade page). No insert/update/delete policy for
-- `authenticated` -- plan management is an admin/service-role operation.
create policy plans_select_active
  on public.plans
  for select
  to authenticated
  using (is_active = true);

-- Admins may read all plans, including inactive ones.
create policy plans_select_admin
  on public.plans
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- A user may read only their own subscription.
create policy subscriptions_select_own
  on public.subscriptions
  for select
  to authenticated
  using (profile_id = auth.uid());

-- Admins may read any subscription.
create policy subscriptions_select_admin
  on public.subscriptions
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- No insert/update/delete policy for `authenticated` on `subscriptions`:
-- subscription state is written only by the application's service layer
-- (webhook handler, checkout flow) via a real Cashfree event or a real API
-- call -- never directly by a user's own RLS-scoped session. This mirrors
-- profiles' own reasoning for why `role` isn't user-writable: subscription
-- status is not something a client should ever be able to self-assign.