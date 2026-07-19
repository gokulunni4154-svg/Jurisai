-- ============================================================================
-- Migration: add_cancelled_card_expired_statuses
-- ============================================================================
-- Closes pending item #8. Real Cashfree webhook docs (per
-- billing.schemas.ts's cashfreeSubscriptionStatusChangedSchema, and that
-- schema's own comment flagging this exact gap) list two
-- subscription_status values -- CANCELLED and CARD_EXPIRED -- that
-- 20260726000001_fix_subscription_status_values.sql's own CHECK
-- constraint (subscriptions_status_valid) does not currently allow,
-- alongside the nine it does. A real webhook reporting either status
-- would fail this constraint and the write would be rejected at the
-- database layer -- this is a fix for an existing, real gap, not a
-- speculative one.
--
-- Confirmed against 20260726000001_fix_subscription_status_values.sql's
-- own real, pasted source (not assumed): the current constraint allows
-- exactly INITIALIZED, ACTIVE, ON_HOLD, COMPLETED, CUSTOMER_CANCELLED,
-- CUSTOMER_PAUSED, EXPIRED, LINK_EXPIRED, BANK_APPROVAL_PENDING.
--
-- Both new values are terminal states (a cancelled or card-expired
-- subscription is not "still in play"), same category as the existing
-- COMPLETED, CUSTOMER_CANCELLED, EXPIRED, and LINK_EXPIRED values
-- already excluded from subscriptions_one_active_per_profile's partial
-- index. That index is therefore NOT touched by this migration -- it
-- already implicitly excludes any status not in its own explicit
-- "still in play" list, and neither new value is being added there.
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

comment on column public.subscriptions.status is
  'Cashfree subscription lifecycle status, confirmed from their real webhook docs (SUBSCRIPTION_STATUS_CHANGE event). CANCELLED and CARD_EXPIRED added this migration to match documented values that the prior constraint (20260726000001) did not yet allow.';