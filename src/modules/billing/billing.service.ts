// src/modules/billing/billing.service.ts
// Extends the real, pasted BaseService — currentUser injected via
// constructor, requireAuthentication()/requireOwnership() used exactly
// as documented in base.service.ts, no re-guessed shape.
//
// FLAGGED, IMPORTANT — write-client requirement inherited from
// SubscriptionRepository's own doc comment: `subscriptions` has no
// insert/update RLS policy for `authenticated` at all. The
// `subscriptionRepository` instance passed into this Service's
// constructor MUST already be constructed with the admin.ts
// service-role client by whatever factory builds this Service — this
// class has no way to enforce that itself, same hard requirement
// SubscriptionRepository's own file already documents.
//
// FLAGGED — `planRepository` and `firmRepository`, by contrast, CAN be
// constructed with the ordinary RLS-scoped server.ts client:
// plans_select_active lets any authenticated user read active plans,
// and firms_select_owner/firms_select_member let a user read a firm
// they own or belong to. Whether the factory actually passes the same
// or different client instances for each repository is a factory-layer
// decision, not resolved here — flag if that factory ends up injecting
// server.ts for subscriptionRepository, since it will fail RLS on write.
//
// RESOLVED, THIS SESSION — closes pending item #7 AND a separate, real
// schema/service mismatch discovered while investigating it (see
// billing.schemas.ts's own amended comment on createCheckoutSchema for
// the full account of the mismatch). `profiles`' real column names are
// now confirmed (20260711120000_create_profiles_table.sql: full_name,
// avatar_url, phone — no email column), and AuthUser.email is confirmed
// via src/core/auth/types.ts. `input.customer` is REMOVED from this
// Service's public input type — createCheckoutSession() now derives the
// Cashfree customer object itself, from a fresh ProfileRepository lookup
// (full_name -> customerName, phone -> customerPhone) plus the
// authenticated AuthUser's own email (customerEmail). A client can no
// longer supply arbitrary checkout customer details for itself, only
// trigger the use of its own real account data. NEW constructor
// dependency: ProfileRepository (6th param) — same
// findByIdOrThrow()-returns-a-Row interface already confirmed via the
// real, pasted firm.service.ts's own usage of it.
//
// FLAGGED, NEW BEHAVIOR FROM THIS FIX: both `full_name` and `phone` are
// NULLABLE columns on `profiles` (per the real migration). Cashfree
// requires all three customer fields as non-empty strings. If either is
// missing, createCheckoutSession() now throws a ValidationError BEFORE
// calling Cashfree or resolving the plan/owner, rather than either
// sending Cashfree a blank/undefined field (which would likely fail
// there instead, with a less useful error) or silently defaulting to a
// placeholder value. This is a new product-facing behavior — a user
// with an incomplete profile cannot check out until they fill in a name
// and phone number — not previously possible to hit before this session
// since these fields used to come from the client's own request body,
// always present because the schema required them there.
//
// FLAGGED — the import path for ProfileRepository below
// (./profile.repository) is inferred from firm.service.ts's own real,
// confirmed import of the same class at that exact path — not
// independently re-verified in this file's own session.
//
// FLAGGED, NOT DONE THIS SESSION: billing.factory.ts (whatever builds
// this Service) also needs updating to construct and inject a
// ProfileRepository instance as this constructor's new 6th argument —
// this file's own source has not been pasted in any session, so that
// change is NOT made here. Without it, whatever calls `new
// BillingService(...)` will be missing a required constructor argument
// and fail to compile. Flagged rather than guessed at.
//
// RESOLVED — a firm-creation flow now exists (FirmService.createFirm(),
// src/modules/billing/firm.service.ts + POST /api/billing/firms).
// Firm-plan checkout below still REQUIRES an existing `firmId` and will
// not create one inline as part of checkout — that's a deliberate
// two-step flow (create firm, then check out a firm plan against it),
// not a missing feature.
//
// RESOLVED — ConflictError is real (confirmed via pasted app-error.ts:
// statusCode 409, code RESOURCE_CONFLICT).
//
// RESOLVED — subscriptionRepository.create()'s call below is confirmed:
// BaseRepository.create(input: Insert): Promise<Row>, and
// SubscriptionRepository extends BaseRepository<'subscriptions'>, so the
// call type-checks against the real Insert shape without needing an
// `as never` cast.
//
// RESOLVED — updateSubscriptionStatusFromWebhook()'s call to
// subscriptionRepository.findByCashfreeSubscriptionId() is confirmed:
// the real, pasted subscription.repository.ts already has this method.
//
// FIXED — the NotFoundError thrown below for a missing/inactive plan
// previously called `new NotFoundError('Plan not found or not active.',
// { resource: 'plan', planSlug: input.planSlug })`. Once the real
// app-error.ts was pasted and verified, this turned out to be wrong:
// NotFoundError's real constructor is `(resource: string, identifier?:
// string | number)` — it builds its own message internally and does not
// accept a free-form message + context object. The old call wouldn't
// type-check against the real class. Corrected below to
// `new NotFoundError('plan', input.planSlug)`, matching
// base.repository.ts's own correct usage pattern
// (`new NotFoundError(String(this.tableName), id)`).
//
// FLAGGED, NEW TRADEOFF FROM THAT FIX: the real NotFoundError's message
// is always "plan with identifier "..." was not found" — it can no
// longer distinguish "plan doesn't exist" from "plan exists but
// is_active is false" the way the old (broken) call's custom message
// attempted to. If that distinction needs to reach the client
// differently, the inactive case would need a different AppError (e.g.
// ConflictError) rather than NotFoundError stretched to cover both —
// not decided here, just flagged.
//
// NEW, a prior session — getCurrentSubscription() added below to back
// GET /api/billing/subscription. Reuses resolveOwner()'s firm-ownership
// rule (requireOwnership(firm.owner_id)) rather than inventing a
// separate read-only authorization rule — flagged in that method's own
// doc comment that this means a firm MEMBER (not owner) currently gets
// an AuthorizationError trying to view their firm's subscription status,
// which was never explicitly discussed either way.
//
// NEW, a prior session — cancelSubscription() added, calling the real
// Cashfree Manage Subscription API (cashfreeService.manageSubscription(),
// action 'CANCEL') via a new shared private resolver
// (resolveActiveSubscriptionForCaller()) that getCurrentSubscription()
// now also uses, rather than duplicating the firm-ownership logic twice.
// See cancelSubscription()'s own doc comment for the synchronous-update
// design decision and the NotFoundError-vs-null distinction from
// getCurrentSubscription().
//
// FIXED, a prior session — createCheckoutSession() generates its own
// merchant-side `subscriptionId` and sends it to Cashfree, but was never
// persisting it — only `cashfree_subscription_id` (Cashfree's
// cf_subscription_id) was saved. Confirmed via the real, pasted
// database.types.ts that no column existed for it at all (not just a
// naming mismatch). Cashfree's real Manage Subscription API
// (POST /pg/subscriptions/{subscription_id}/manage) requires this
// merchant ID, not cf_subscription_id, to cancel/pause/activate/
// change-plan an existing subscription. Fixed by
// 20260726000005_add_subscription_merchant_id.sql (new `subscription_id`
// column) plus persisting it below.
//
// NEW, a prior session — AuditLogRepository injected as a constructor
// dependency. Deliberately NOT AuditLogService: BillingService already
// extends BaseService and already resolves/guards currentUser itself,
// so wrapping a second BaseService-derived instance around the same
// actor would be redundant layering. This mirrors the cron route's own
// precedent (confirmed via PROJECT_PROGRESS.md Item #48 as an explicit
// user decision, not just an inferred pattern) of calling a repository
// directly once the actor/context is already established at the call
// site, rather than always routing through a Service wrapper.
// cancelSubscription() writes a 'billing.subscription.cancel' audit
// entry as its last step, after both the Cashfree call and the local DB
// update have succeeded — see that method's own doc comment for the
// ordering rationale.
//
// NEW, a prior session — updateSubscriptionStatusFromWebhook() now ALSO
// writes an audit entry, as its last step, after the local
// subscriptionRepository.update() call has already succeeded. Uses
// recordWebhookAction() (actor_type: 'webhook', actor_id: null) rather
// than recordUserAction() or recordSystemAction() — see that method's
// own doc comment for why 'webhook' is a distinct actor_type from
// 'system'.
//
// FIXED, a prior session — the audit write above initially had no
// error handling, which (confirmed against the real, pasted webhook route
// handler) would have let a transient audit-write failure surface as an
// uncaught 500 and cause Cashfree to retry an already-successful status
// update. recordWebhookAction()'s call is wrapped in a narrow try/catch
// (logged, swallowed) inside the method itself —
// subscriptionRepository.update()'s own errors are untouched and still
// propagate normally. See the method's own doc comment for the full
// reasoning.
//
// FIXED, a prior session — resolveOwner()'s missing-firmId case (for
// billing_target === 'firm' with no firmId supplied) previously threw a
// plain `new Error(...)`. This was the exact same bug pattern that
// firm/route.ts's own fix already corrected on the route side. Per the
// already-confirmed error-handler.ts behavior, a plain Error is not an
// AppError and gets wrapped in InternalServerError -> 500, so a client
// omitting firmId for a firm-plan checkout was getting a fake 500
// instead of a 400. Corrected below to throw the same ValidationError
// class firm/route.ts uses, with the same context-object shape
// (param + explanatory detail) — this is bad client input, not a server
// fault. NOT applied to the unreachable defensive Error a few lines
// below (unrecognized billing_target) — that branch guards an internal
// invariant (the CHECK constraint should make it impossible to reach at
// all), not a client-supplied value, so a 500 if it's ever somehow hit
// is arguably the correct signal that something is actually broken
// server-side. Flagged rather than changed without being asked.
//
// NEW, a prior session — createCheckoutSession() now ALSO writes a
// 'billing.subscription.checkout' audit entry, as its last step, after
// both the Cashfree createSubscription() call and the local
// subscriptionRepository.create() have already succeeded — same
// last-step-after-success ordering cancelSubscription() already
// established, applied here for the first time to a CREATE rather than
// an UPDATE. Naming: 'billing.subscription.checkout', NOT '...create' —
// deliberate, since this step only initiates a Cashfree subscription
// pending the customer's own authorization step (see CheckoutSession's
// own "OPEN TODO" comment on the missing redirect URL); the local row's
// status reflects Cashfree's initial response status, not necessarily an
// activated subscription.

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { ConflictError, NotFoundError, ValidationError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';
import type { Database } from '@/core/supabase/database.types';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

import type { CashfreeService } from './cashfree.service';
import type { FirmRepository } from './firm.repository';
import type { PlanRepository } from './plan.repository';
import type { ProfileRepository } from './profile.repository';
import type { SubscriptionRepository } from './subscription.repository';

// subscription.repository.ts defines this same alias locally but doesn't
// export it, so it's redeclared here the same way — both files
// independently indexing Database['public']['Tables']['subscriptions']
// ['Row'], not a duplicated source of truth, just a duplicated
// type-level convenience (same trade-off already accepted for that
// file's NON_TERMINAL_STATUSES).
type SubscriptionRow = Database['public']['Tables']['subscriptions']['Row'];

// Same local-alias convention as SubscriptionRow above, for
// listActivePlans()'s return type.
type PlanRow = Database['public']['Tables']['plans']['Row'];

export interface CreateCheckoutSessionInput {
  planSlug: string;
  /** Required only when the resolved plan's billing_target is 'firm'.
   *  Must be a firm the current user already owns. If they don't own a
   *  firm yet, create one first via POST /api/billing/firms
   *  (FirmService.createFirm()), then check out a firm plan against the
   *  returned firm's id. */
  firmId?: string;
  /**
   * REMOVED, THIS SESSION — this type previously had a `customer:
   * CreateCashfreeSubscriptionCustomerDetails` field, client-supplied.
   * Customer details are now derived internally by
   * createCheckoutSession() itself, from the caller's own profile and
   * AuthUser — see this file's header comment and that method's own
   * doc comment. A client cannot supply customer details for itself
   * anymore, only trigger the use of its own real account data.
   */
  returnUrl: string;
}

export interface CheckoutSession {
  subscriptionId: string;
  cfSubscriptionId: string | null;
  status: string;
  // OPEN TODO, flagged in a prior session — there is currently NO
  // redirect / payment-authorization URL field anywhere in this type or
  // in CashfreeService#createSubscription()'s typed
  // CashfreeSubscriptionResponse. Real Cashfree checkout requires
  // sending the customer to a hosted page to authorize the subscription
  // mandate; that link's real field name is unconfirmed because
  // Cashfree sandbox/production credentials haven't been configured yet
  // — there is no real API response to check it against. It may already
  // be present, unparsed, inside createSubscription()'s untyped `raw`
  // response. DO NOT guess a field name here. Once real credentials
  // exist and a live sandbox response can be inspected: (1) add the
  // confirmed field to CashfreeSubscriptionResponse in cashfree.service.ts,
  // (2) surface it here as e.g. `redirectUrl: string | null`, (3) update
  // src/app/billing/checkout/page.tsx's "awaiting redirect" state (see
  // that file's own matching TODO) to actually redirect.
}

export class BillingService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly planRepository: PlanRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly firmRepository: FirmRepository,
    private readonly cashfreeService: CashfreeService,
    private readonly auditLogRepository: AuditLogRepository,
    // NEW, THIS SESSION — see file header. FLAGGED: billing.factory.ts
    // has not been updated to pass this; whatever builds this Service
    // will fail to compile until it is.
    private readonly profileRepository: ProfileRepository,
  ) {
    super(currentUser);
  }

  /**
   * Backs GET /api/billing/plans (pricing page). Deliberately does NOT
   * call requireAuthentication(): a pricing page must be viewable by a
   * logged-out visitor deciding whether to sign up at all, same
   * reasoning plans_select_active RLS already encodes at the database
   * layer (see PlanRepository's own header comment). Thin passthrough
   * to planRepository.findActive() — no additional logic here, kept for
   * consistency with every other public method on this Service going
   * through a Service-layer method rather than routes calling
   * repositories directly.
   */
  async listActivePlans(): Promise<PlanRow[]> {
    return this.planRepository.findActive();
  }

  /**
   * Resolves the plan's billing_target to an owner (profile or firm),
   * checks for an existing non-terminal subscription for that owner,
   * calls Cashfree to create the real subscription, then persists the
   * result. All steps happen in that order — Cashfree is never called
   * for an owner that already has an active subscription.
   *
   * AMENDED, THIS SESSION — closes pending item #7. No longer accepts
   * customer details from the caller. Immediately after authentication,
   * fetches the caller's own profile and validates it has both
   * `full_name` and `phone` set — both are nullable columns on
   * `profiles`, but Cashfree requires all three customer fields as
   * non-empty strings, so an incomplete profile now fails fast with a
   * ValidationError, before any plan lookup or Cashfree call, rather
   * than reaching Cashfree with a blank field or silently defaulting to
   * a placeholder. `customerEmail` comes from `user.email`
   * (AuthUser.email, confirmed real) — `profiles` has no email column
   * at all, so there was never a choice to make there.
   *
   * AMENDED, a prior session — writes a 'billing.subscription.checkout'
   * audit entry as a final step, after the local
   * subscriptionRepository.create() call has already succeeded. Same
   * non-transactional posture already accepted for cancelSubscription()'s
   * audit write applies here too: if the audit write itself throws, the
   * Cashfree subscription and the local DB row both already exist — the
   * thrown error still propagates to the caller as if checkout failed
   * outright, which is misleading but consistent with every other
   * post-mutation audit write in this project (flagged, not solved,
   * same as the others).
   */
  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CheckoutSession> {
    const user = this.requireAuthentication();

    // NEW, THIS SESSION — see method doc comment. Fetched and validated
    // before any other work, so an incomplete profile fails fast.
    const profile = await this.profileRepository.findByIdOrThrow(user.id);

    if (!profile.full_name || !profile.phone) {
      throw new ValidationError(
        'Your profile is missing information required to check out.',
        {
          missingFields: [
            ...(!profile.full_name ? ['full_name'] : []),
            ...(!profile.phone ? ['phone'] : []),
          ],
          hint: 'Update your profile with a full name and phone number before checking out.',
        },
      );
    }

    const plan = await this.planRepository.findBySlug(input.planSlug);
    if (!plan || !plan.is_active) {
      throw new NotFoundError('plan', input.planSlug);
    }

    if (!plan.cashfree_plan_id) {
      // Deliberately not silently handled — a plan with no Cashfree-side
      // plan (e.g. a free tier) has nothing for this checkout flow to
      // bill. Assigning a free plan is a different, unbuilt operation.
      throw new Error(
        `Plan '${plan.slug}' has no cashfree_plan_id and cannot go through paid checkout.`,
      );
    }

    const owner = await this.resolveOwner(plan.billing_target, user.id, input.firmId);

    const existing =
      owner.type === 'profile'
        ? await this.subscriptionRepository.findActiveByProfileId(owner.id)
        : await this.subscriptionRepository.findActiveByFirmId(owner.id);

    if (existing) {
      throw new ConflictError(
        `${owner.type === 'profile' ? 'This profile' : 'This firm'} already has an active subscription.`,
        {
          ownerType: owner.type,
          ownerId: owner.id,
          existingSubscriptionStatus: existing.status,
        },
      );
    }

    // plans.price_paise -> rupees, closing the conversion gap flagged in
    // cashfree.service.ts's own header ("the conversion is left to
    // whatever calls this Service"). Done here, once, at the boundary
    // where a plans row meets the Cashfree client.
    const amountRupees = plan.price_paise / 100;

    // Cashfree requires a caller-generated subscription_id. Prefixed
    // with the owner type/id for human debuggability in the Cashfree
    // dashboard — a fresh, undiscussed convention, flagged rather than
    // presented as an established pattern.
    const subscriptionId = `sub_${owner.type}_${owner.id}_${Date.now()}`;

    const cashfreeResult = await this.cashfreeService.createSubscription({
      subscriptionId,
      planId: plan.cashfree_plan_id,
      // NEW, THIS SESSION — derived from the caller's own profile/session
      // rather than taken from client input. profile.full_name/phone are
      // both confirmed non-null at this point (validated above).
      customer: {
        customerName: profile.full_name,
        customerEmail: user.email,
        customerPhone: profile.phone,
      },
      authorizationAmountRupees: amountRupees,
      returnUrl: input.returnUrl,
    });

    const createdSubscription = await this.subscriptionRepository.create({
      profile_id: owner.type === 'profile' ? owner.id : null,
      firm_id: owner.type === 'firm' ? owner.id : null,
      plan_id: plan.id,
      // Cashfree's Manage Subscription API requires this merchant-
      // generated id, not cf_subscription_id — see
      // 20260726000005_add_subscription_merchant_id.sql.
      subscription_id: subscriptionId,
      cashfree_subscription_id: cashfreeResult.cfSubscriptionId,
      status: cashfreeResult.status,
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: owner.type === 'firm' ? owner.id : null,
      action: 'billing.subscription.checkout',
      resourceType: 'subscription',
      resourceId: createdSubscription.id,
      metadata: {
        planSlug: plan.slug,
        ownerType: owner.type,
        status: cashfreeResult.status,
      },
    });

    return {
      subscriptionId: cashfreeResult.subscriptionId,
      cfSubscriptionId: cashfreeResult.cfSubscriptionId,
      status: cashfreeResult.status,
    };
  }

  /**
   * Shared by getCurrentSubscription() and cancelSubscription() — resolves
   * "the active subscription this caller is allowed to act on," gated the
   * same way for both reads and the cancel action. With no firmId: the
   * caller's own profile-owned subscription. With firmId: that firm's
   * subscription, but ONLY if the caller is the firm's owner — same
   * requireOwnership(firm.owner_id) gate createCheckoutSession's
   * resolveOwner() already uses for firm plans, reused here rather than
   * inventing a separate rule. A caller who is merely a firm MEMBER (not
   * owner) gets an AuthorizationError for either method, same as they
   * would trying to check out a firm plan — this mirrors the existing
   * write-side rule onto both reads and cancellation rather than deciding
   * independently whether members should be able to view/cancel firm
   * billing, which was never discussed.
   */
  private async resolveActiveSubscriptionForCaller(
    firmId?: string,
  ): Promise<SubscriptionRow | null> {
    const user = this.requireAuthentication();

    if (firmId) {
      const firm = await this.firmRepository.findByIdOrThrow(firmId);
      this.requireOwnership(firm.owner_id);
      return this.subscriptionRepository.findActiveByFirmId(firm.id);
    }

    return this.subscriptionRepository.findActiveByProfileId(user.id);
  }

  /**
   * Returns the current user's active (non-terminal) subscription, or
   * null if they don't have one — null is a normal result here, not an
   * error, matching findActiveByProfileId/findActiveByFirmId's own
   * "never subscribed, or lapsed" doc comments. Never returns a
   * cancelled/expired/etc. subscription; there is currently no method
   * anywhere in this Service to fetch subscription HISTORY, only the
   * single current non-terminal one, if any.
   */
  async getCurrentSubscription(firmId?: string): Promise<SubscriptionRow | null> {
    return this.resolveActiveSubscriptionForCaller(firmId);
  }

  /**
   * Cancels the caller's active subscription via Cashfree's real Manage
   * Subscription API (cashfreeService.manageSubscription() with action
   * 'CANCEL'), then persists the result locally.
   *
   * Uses subscription.subscription_id (the merchant-generated ID, added
   * in 20260726000005_add_subscription_merchant_id.sql) when calling
   * Cashfree — NOT cashfree_subscription_id — per that migration's own
   * reasoning.
   *
   * Throws NotFoundError if the caller has no active subscription to
   * cancel — unlike getCurrentSubscription()'s null-is-normal return,
   * "cancel a subscription that doesn't exist" is treated as an error
   * here, not a silent no-op, so a client can't mistake "nothing
   * happened" for "successfully cancelled."
   *
   * FLAGGED, DESIGN DECISION: updates the local `subscriptions` row
   * synchronously from the Manage Subscription API's own response,
   * rather than waiting for updateSubscriptionStatusFromWebhook() to
   * eventually reflect it. Manage Subscription is a direct, synchronous
   * merchant-initiated action (unlike checkout, which depends on an
   * async customer-side authorization step) — its response IS the
   * confirmed new state, not a tentative one. The webhook handler will
   * still fire separately and re-apply the same status; that's a
   * harmless, idempotent overwrite, not a conflict.
   *
   * FLAGGED, NOT INDEPENDENTLY CONFIRMED: builds the returned row by
   * spreading the already-fetched `subscription` object with the new
   * status/cancelled_at rather than trusting
   * subscriptionRepository.update()'s return value — update()'s return
   * type was never directly pasted/verified in the session that wrote
   * this method (only create() was explicitly confirmed as
   * Promise<Row> in this file's own header). Safer to construct the
   * return value from data already on hand than assume update()'s
   * shape.
   *
   * AMENDED, a prior session — audits the cancellation as the LAST step,
   * after both the Cashfree call and the local DB update have already
   * succeeded. re-derives `user` via requireAuthentication() rather than
   * threading it out of resolveActiveSubscriptionForCaller()'s private
   * return type — cheap (a null check against the already-resolved
   * this.currentUser, no re-fetch) and keeps that resolver's signature
   * untouched. If the audit write itself throws, the cancellation has
   * already genuinely happened (Cashfree + local DB both reflect it);
   * the thrown error still propagates to the caller either way — same
   * trade-off already flagged for the cron route's per-document audit
   * write, not solved differently here.
   */
  async cancelSubscription(firmId?: string): Promise<SubscriptionRow> {
    const subscription = await this.resolveActiveSubscriptionForCaller(firmId);

    if (!subscription) {
      throw new NotFoundError('active subscription');
    }

    const cashfreeResult = await this.cashfreeService.manageSubscription({
      subscriptionId: subscription.subscription_id,
      action: 'CANCEL',
    });

    const cancelledAt = new Date().toISOString();

    await this.subscriptionRepository.update(subscription.id, {
      status: cashfreeResult.status,
      cancelled_at: cancelledAt,
    });

    const user = this.requireAuthentication();

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: subscription.firm_id,
      action: 'billing.subscription.cancel',
      resourceType: 'subscription',
      resourceId: subscription.id,
      metadata: {
        previousStatus: subscription.status,
        newStatus: cashfreeResult.status,
      },
    });

    return {
      ...subscription,
      status: cashfreeResult.status,
      cancelled_at: cancelledAt,
    };
  }

  /**
   * Resolves plans.billing_target to a concrete owner. For 'individual'
   * or 'lawyer' plans, the owner is always the current user's own
   * profile — requireOwnership isn't needed here since there's nothing
   * to check against except the caller's own id. For 'firm' plans, the
   * caller must supply an existing firmId, and requireOwnership() gates
   * that the current user is that firm's real owner (firm.owner_id) —
   * NOT merely a member, matching this project's earlier RLS decision
   * that only a firm's owner can act on its subscription.
   */
  private async resolveOwner(
    billingTarget: string,
    userId: string,
    firmId: string | undefined,
  ): Promise<{ type: 'profile' | 'firm'; id: string }> {
    if (billingTarget === 'individual' || billingTarget === 'lawyer') {
      return { type: 'profile', id: userId };
    }

    if (billingTarget === 'firm') {
      if (!firmId) {
        // FIXED, a prior session — was a plain `new Error(...)`, which
        // error-handler.ts's normalizeError() wraps in InternalServerError
        // (fake 500) since it isn't an AppError. See this file's header
        // comment for the full reasoning; matches the ValidationError
        // fix firm/route.ts already applied to the same class of
        // problem.
        throw new ValidationError(
          'A firmId is required to check out a firm plan.',
          {
            param: 'firmId',
            hint: 'If you don\'t own a firm yet, create one first via POST /api/billing/firms, then check out a firm plan against the returned firm id.',
          },
        );
      }

      const firm = await this.firmRepository.findByIdOrThrow(firmId);
      this.requireOwnership(firm.owner_id);

      return { type: 'firm', id: firm.id };
    }

    // Defensive — billing_target's real CHECK constraint only allows the
    // three values above, so this should be unreachable in practice.
    throw new Error(`Unrecognized plans.billing_target value: ${billingTarget}`);
  }

  /**
   * Called by POST /api/billing/webhooks/cashfree, AFTER that route has
   * already verified the request's signature — this method does not
   * re-verify anything itself and must never be called with unverified
   * webhook data.
   *
   * Deliberately does NOT call requireAuthentication() or
   * requireOwnership() — a webhook has no concept of "the current
   * user." The webhook route constructs BillingService with
   * currentUser = null, same as any unauthenticated request; authenticity
   * here comes entirely from signature verification at the route layer.
   * This is a different trust model than every other method in this
   * class, flagged as intentional rather than an oversight.
   *
   * AMENDED, a prior session — audits the status change as the LAST step,
   * after the local subscriptionRepository.update() call has already
   * succeeded, via recordWebhookAction() (actor_type: 'webhook',
   * actor_id: null — there genuinely is no user or AuthUser behind a
   * webhook call, unlike recordUserAction(), and 'webhook' is
   * deliberately distinct from 'system').
   *
   * AMENDED AGAIN, a prior session — confirmed against the real, pasted
   * webhook route handler (src/app/api/billing/webhooks/cashfree/route.ts)
   * that it calls this method with no try/catch at all, and documents an
   * explicit "always 200 except signature failure" contract for exactly
   * the reason that Cashfree retries indefinitely on non-2xx. Unlike
   * cancelSubscription()'s and createCheckoutSession()'s audit writes
   * (whose callers are interactive clients, not a retrying webhook
   * sender), an uncaught throw here would propagate up through that
   * route as an uncaught exception -- Next.js turns that into a 500 --
   * which would cause Cashfree to retry a webhook whose actual status
   * update had already succeeded. So, deliberately narrower than the
   * other two methods' audit writes: ONLY the recordWebhookAction() call
   * is wrapped in try/catch below. subscriptionRepository.update()'s
   * errors are NOT caught here and still propagate normally -- those are
   * real failures a Cashfree retry could legitimately help with, and
   * swallowing them would break the route's existing, correct contract
   * for that case. A caught audit-write failure is logged via
   * console.error and otherwise silently dropped: the status update
   * itself already succeeded and is the source of truth; the audit trail
   * entry for this one event is lost, which is a real (small, and now
   * explicit rather than hidden) gap, not a solved problem.
   */
  async updateSubscriptionStatusFromWebhook(
    cfSubscriptionId: string,
    newStatus: string,
  ): Promise<void> {
    const subscription =
      await this.subscriptionRepository.findByCashfreeSubscriptionId(cfSubscriptionId);

    if (!subscription) {
      // Deliberately NOT thrown as an error that would surface as a
      // webhook delivery failure to Cashfree — an unrecognized
      // cf_subscription_id most likely means this webhook is for a
      // subscription created outside this flow (e.g. directly in the
      // Cashfree dashboard during testing), not a bug in this app. The
      // route handler still returns 200 either way, so Cashfree doesn't
      // retry indefinitely. Logging this is the route handler's job,
      // not this method's. No audit entry is written in this case either
      // — there is no local subscription row to attach resourceId to,
      // and (per the same reasoning) this isn't this app's own bug to
      // record.
      return;
    }

    await this.subscriptionRepository.update(subscription.id, {
      status: newStatus,
    });

    try {
      await this.auditLogRepository.recordWebhookAction({
        action: 'billing.subscription.status_update',
        firmId: subscription.firm_id,
        resourceType: 'subscription',
        resourceId: subscription.id,
        metadata: {
          previousStatus: subscription.status,
          newStatus,
        },
      });
    } catch (error) {
      // Deliberately swallowed -- see this method's doc comment. The
      // status update above already succeeded; letting this throw would
      // surface as a 500 to the calling route and cause Cashfree to
      // retry a webhook whose real effect already landed.
      console.error(
        'Failed to write audit log entry for webhook subscription status update',
        { subscriptionId: subscription.id, newStatus, error },
      );
    }
  }
}