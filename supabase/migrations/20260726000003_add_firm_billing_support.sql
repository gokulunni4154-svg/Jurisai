-- ============================================================================
-- Migration: add_firm_billing_support
-- ============================================================================
-- Extends `plans` and `subscriptions` (20260726000000_create_billing_tables.sql,
-- corrected by 20260726000001_fix_subscription_status_values.sql) to support
-- the Lawyer Firms plan, which bills a firms.id, not a profiles.id.
-- Individuals and Lawyers plans are unaffected -- they continue to bill
-- profiles.id exactly as before.
--
-- Never edits either prior migration directly, per this project's own
-- migration convention (never edit an already-applied migration) -- this is
-- a pure additive follow-up, same pattern as 20260726000001's own header.
--
-- FLAGGED ASSUMPTIONS -- new decisions made this session:
--   1. `subscriptions.profile_id` is now nullable and `subscriptions.firm_id`
--      is added, with a CHECK enforcing exactly one of the two is set. This
--      is the minimal shape supporting dual ownership without a full
--      polymorphic-association pattern (no `owner_type`/`owner_id` pair) --
--      chosen because there are only ever two possible owner tables here,
--      not an open-ended set.
--   2. `plans.billing_target` (individual/lawyer/firm) is being added so
--      checkout logic can determine which ownership path (profile_id vs
--      firm_id) a given plan resolves to. Defaults existing/new rows to
--      'individual' -- flagged because whether any `plans` rows already
--      exist and were seeded under a different assumption was not
--      confirmed this session; verify no seeded plan silently ends up
--      mis-tagged before this ships.
--   3. `plans.max_seats` is added as a plain nullable integer, data-only --
--      it is NOT enforced anywhere (no trigger blocking a firm from adding
--      more members than its plan allows). Deferred to the
--      checkout/member-invite application logic, consistent with this
--      migration's sibling (create_firms_table) not enforcing it at the DB
--      level either.
--   4. The partial unique index for "one active subscription per profile"
--      from 20260726000001 is left as-is (a null profile_id simply never
--      matches it, per standard Postgres unique-index null handling -- nulls
--      are never considered equal to each other). A new sibling index is
--      added for "one active subscription per firm" using the same real
--      non-terminal status list confirmed in 20260726000001.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- plans: billing_target + max_seats
-- ----------------------------------------------------------------------------
alter table public.plans
  add column billing_target text not null default 'individual'
    constraint plans_billing_target_valid check (
      billing_target in ('individual', 'lawyer', 'firm')
    );

comment on column public.plans.billing_target is
  'Which entity this plan bills: individual/lawyer plans resolve to subscriptions.profile_id, firm plans resolve to subscriptions.firm_id. Determines checkout ownership path.';

alter table public.plans
  add column max_seats integer
    constraint plans_max_seats_positive check (max_seats is null or max_seats > 0);

comment on column public.plans.max_seats is
  'Seat cap for firm plans (billing_target = firm). Null for individual/lawyer plans. NOT enforced at the DB level -- see migration header, assumption #3.';

-- ----------------------------------------------------------------------------
-- subscriptions: dual ownership (profile_id OR firm_id)
-- ----------------------------------------------------------------------------
alter table public.subscriptions
  alter column profile_id drop not null;

alter table public.subscriptions
  add column firm_id uuid references public.firms (id) on delete cascade;

alter table public.subscriptions
  add constraint subscriptions_owner_exactly_one check (
    (profile_id is not null and firm_id is null)
    or (profile_id is null and firm_id is not null)
  );

comment on column public.subscriptions.profile_id is
  'Owning profile for Individuals/Lawyers plans. Null for firm subscriptions -- see subscriptions_owner_exactly_one.';

comment on column public.subscriptions.firm_id is
  'Owning firm for the Lawyer Firms plan. Null for individual/lawyer subscriptions -- see subscriptions_owner_exactly_one.';

create index subscriptions_firm_id_idx on public.subscriptions (firm_id);

-- At most one non-terminal subscription per firm, mirroring
-- subscriptions_one_active_per_profile from 20260726000001 -- same real
-- non-terminal status list.
create unique index subscriptions_one_active_per_firm
  on public.subscriptions (firm_id)
  where status in (
    'INITIALIZED',
    'ACTIVE',
    'ON_HOLD',
    'CUSTOMER_PAUSED',
    'BANK_APPROVAL_PENDING'
  );

-- ----------------------------------------------------------------------------
-- Row Level Security: allow a firm owner to read their firm's subscription
-- ----------------------------------------------------------------------------
create policy subscriptions_select_firm_owner
  on public.subscriptions
  for select
  to authenticated
  using (
    firm_id is not null
    and firm_id in (select id from public.firms where owner_id = auth.uid())
  );

-- Deliberately NOT adding a policy letting firm *members* (non-owner
-- lawyers under a firm) read the firm's subscription -- only the owner can
-- currently see billing status. Flagged as a real product decision, not a
-- default: revisit if all firm members should see their firm's plan/status.