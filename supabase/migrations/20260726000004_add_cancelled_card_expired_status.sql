-- ============================================================================
-- Migration: add_cancelled_card_expired_status
-- ============================================================================
-- Adds 'CANCELLED' and 'CARD_EXPIRED' to public.subscriptions.status's CHECK
-- constraint. Both are real Cashfree webhook status values (per the same
-- SUBSCRIPTION_STATUS_CHANGE event docs referenced in
-- 20260726000001_fix_subscription_status_values.sql) that billing.schemas.ts's
-- webhook schema already accepts, but the DB constraint from that prior
-- migration was never updated to match -- so a real webhook carrying either
-- value would currently fail the DB write.
--
-- ASSUMPTION, NOT CONFIRMED AGAINST CASHFREE DOCS: this migration treats both
-- new values as terminal states (subscription is over, profile is free to
-- start a new one), by analogy with the existing terminal set
-- (COMPLETED, CUSTOMER_CANCELLED, EXPIRED, LINK_EXPIRED):
--   - CANCELLED is assumed parallel to CUSTOMER_CANCELLED (cancelled by a
--     different actor -- merchant/system -- rather than the customer).
--   - CARD_EXPIRED is assumed terminal because the subscription can no
--     longer renew.
-- Worth a real sanity check against Cashfree's docs/sandbox before relying
-- on this. If either turns out to be non-terminal, the partial index below
-- needs to be re-migrated to include it.
-- ============================================================================

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
      'BANK_APPROVAL_PENDING',
      'CANCELLED',
      'CARD_EXPIRED'
    )
  );

-- Terminal states remain excluded from the partial index; CANCELLED and
-- CARD_EXPIRED are assumed terminal per this migration's header, so no
-- change is needed to the "still in play" list itself -- but the index is
-- dropped and recreated anyway to keep this migration self-contained and
-- to make the terminal/non-terminal decision auditable at this point in
-- the migration history.
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
  'Cashfree subscription lifecycle status. INITIALIZED, ACTIVE, ON_HOLD, COMPLETED, CUSTOMER_CANCELLED, CUSTOMER_PAUSED, EXPIRED, LINK_EXPIRED, BANK_APPROVAL_PENDING confirmed from Cashfree webhook docs. CANCELLED and CARD_EXPIRED added in 20260726000004 -- also real Cashfree values, but their terminal/non-terminal classification here is an assumption pending a real sandbox check.';