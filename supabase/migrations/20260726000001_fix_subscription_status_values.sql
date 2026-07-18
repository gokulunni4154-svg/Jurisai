-- ============================================================================
-- Migration: fix_subscription_status_values
-- ============================================================================
-- Corrects public.subscriptions.status's CHECK constraint. The original
-- migration (20260726000000_create_billing_tables.sql) guessed at a
-- generic recurring-billing lifecycle (pending/active/on_hold/cancelled/
-- expired) because Cashfree's real status values had not been verified at
-- the time -- flagged explicitly in that migration's own header as
-- unconfirmed.
--
-- Real values below are confirmed from Cashfree's own webhook documentation
-- (SUBSCRIPTION_STATUS_CHANGE event) for the current API version
-- (2023-08-01 / 2025-01-01), not guessed:
--   INITIALIZED, ACTIVE, ON_HOLD, COMPLETED, CUSTOMER_CANCELLED,
--   CUSTOMER_PAUSED, EXPIRED, LINK_EXPIRED, BANK_APPROVAL_PENDING
--
-- FLAGGED, STILL NOT FULLY VERIFIED: 'INITIALIZED' is Cashfree's documented
-- state for "subscription created, awaiting customer authorization" per
-- their own prose description, but was not seen as a literal string in the
-- same webhook payload example the other values came from -- included here
-- because it is the only sensible default for a freshly-created row before
-- any webhook has fired, but worth a real sanity check against an actual
-- sandbox subscription creation response if you want to be certain of its
-- exact casing/spelling.
--
-- 'pending' (the old default) is dropped in favor of 'INITIALIZED' to match
-- Cashfree's real casing. This changes the default value AND requires any
-- existing row (there should be none yet -- this module was just created)
-- with status='pending' to be migrated. A defensive UPDATE is included
-- below in case a row was inserted between the two migrations.
-- ============================================================================

-- Defensive: remap any row created under the old guessed value before the
-- CHECK constraint is replaced (should be a no-op on a fresh module).
update public.subscriptions
set status = 'INITIALIZED'
where status = 'pending';

alter table public.subscriptions
  drop constraint subscriptions_status_valid;

alter table public.subscriptions
  add constraint subscriptions_status_valid check (
    status in (
      'INITIALIZED',
      'ACTIVE',
      'ON_HOLD',
      'COMPLETED',
      'CUSTOMER_CANCELLED',
      'CUSTOMER_PAUSED',
      'EXPIRED',
      'LINK_EXPIRED',
      'BANK_APPROVAL_PENDING'
    )
  );

alter table public.subscriptions
  alter column status set default 'INITIALIZED';

-- The partial unique index (one non-terminal subscription per profile)
-- also needs its status list updated to match the new real values.
-- Terminal states are COMPLETED, CUSTOMER_CANCELLED, EXPIRED, LINK_EXPIRED
-- -- everything else is "still in play" for that profile.
drop index public.subscriptions_one_active_per_profile;

create unique index subscriptions_one_active_per_profile
  on public.subscriptions (profile_id)
  where status in (
    'INITIALIZED',
    'ACTIVE',
    'ON_HOLD',
    'CUSTOMER_PAUSED',
    'BANK_APPROVAL_PENDING'
  );

comment on column public.subscriptions.status is
  'Cashfree subscription lifecycle status, confirmed from their real webhook docs (SUBSCRIPTION_STATUS_CHANGE event). INITIALIZED is the pre-authorization default; still worth a sandbox sanity check per this migration''s header.';