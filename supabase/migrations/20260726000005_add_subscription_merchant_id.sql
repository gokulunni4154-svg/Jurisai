-- ============================================================================
-- Migration: add_subscription_merchant_id
-- ============================================================================
-- Adds `subscription_id` to public.subscriptions: the merchant-generated ID
-- (billing.service.ts's createCheckoutSession() already generates one as
-- `sub_${owner.type}_${owner.id}_${Date.now()}` and sends it to Cashfree as
-- the real subscription_id at creation time) -- but it was never persisted.
-- Only `cashfree_subscription_id` (Cashfree's own cf_subscription_id) was
-- being saved.
--
-- This is a real, load-bearing gap, not a naming nitpick: Cashfree's Manage
-- Subscription API (POST /pg/subscriptions/{subscription_id}/manage,
-- confirmed against their current docs) requires the MERCHANT subscription_id
-- in both the URL path and the request body -- cf_subscription_id doesn't
-- work there, per that endpoint's own parameter description ("the
-- Subscription ID using which the subscription was created"). Without this
-- column, there is no way to look up the ID needed to cancel/pause/activate
-- an existing subscription once cf_subscription_id is all that's on hand.
--
-- FLAGGED ASSUMPTION, NOT INDEPENDENTLY CONFIRMED VIA A ROW COUNT QUERY --
-- added as `not null unique` on the reasoning that this table cannot
-- currently contain any rows: subscriptions.plan_id is `not null` and
-- references plans.id, and plans is confirmed empty per this project's own
-- pending-work tracking (seed-plans.ts has never been run). No plan rows
-- exist yet => no subscriptions row could have been inserted yet => adding
-- a `not null` column here should be safe. Worth a real
-- `select count(*) from public.subscriptions` check before running this in
-- any environment where that logical chain might not hold (e.g. a shared
-- staging DB someone else has touched).
-- ============================================================================

alter table public.subscriptions
  add column subscription_id text;

alter table public.subscriptions
  add constraint subscriptions_subscription_id_unique unique (subscription_id);

alter table public.subscriptions
  alter column subscription_id set not null;

comment on column public.subscriptions.subscription_id is
  'Merchant-generated Cashfree subscription_id (set by billing.service.ts at checkout time, before the Cashfree API call). Required by Cashfree''s Manage Subscription API for cancel/pause/activate/change-plan actions -- cashfree_subscription_id (cf_subscription_id) cannot be used for that endpoint.';