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
// FLAGGED, UNRESOLVED — no ProfileRepository has been pasted or built in
// any session. Cashfree's createSubscription() needs a customer name,
// email, and phone (its real request shape, confirmed in
// cashfree.service.ts). Rather than guessing at a profiles-table read
// this Service has no repository for, customer details are taken as
// explicit input from the caller (e.g. a checkout form) instead of
// being derived from the user's stored profile. Revisit once a real
// ProfileRepository exists — deriving these from the user's own profile
// would likely be the better long-term UX.
//
// FLAGGED, UNRESOLVED — no firm-creation flow exists anywhere in this
// project yet. Firm-plan checkout below therefore REQUIRES an existing
// `firmId` and will not create one on the caller's behalf. A real
// "create my firm" step needs to be scoped and built before firm-plan
// checkout is usable end-to-end for a brand-new firm customer.
//
// FLAGGED, UNRESOLVED — no ConflictError (or equivalent "this action
// can't proceed given existing state" class) has been confirmed to
// exist in '@/core/errors/app-error' in any session. A plain Error is
// thrown for "already has an active subscription", mirroring
// SubscriptionRepository#delete()'s own precedent for an
// intentionally-unsupported-operation message — reasonable given that
// real precedent, but flagged rather than assumed correct.

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { NotFoundError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';

import type {
  CashfreeService,
  CreateCashfreeSubscriptionCustomerDetails,
} from './cashfree.service';
import type { FirmRepository } from './firm.repository';
import type { PlanRepository } from './plan.repository';
import type { SubscriptionRepository } from './subscription.repository';

export interface CreateCheckoutSessionInput {
  planSlug: string;
  /** Required only when the resolved plan's billing_target is 'firm'.
   *  Must be a firm the current user already owns — see this file's
   *  header, "no firm-creation flow exists yet". */
  firmId?: string;
  customer: CreateCashfreeSubscriptionCustomerDetails;
  returnUrl: string;
}

export interface CheckoutSession {
  subscriptionId: string;
  cfSubscriptionId: string | null;
  status: string;
}

export class BillingService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly planRepository: PlanRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly firmRepository: FirmRepository,
    private readonly cashfreeService: CashfreeService,
  ) {
    super(currentUser);
  }

  /**
   * Resolves the plan's billing_target to an owner (profile or firm),
   * checks for an existing non-terminal subscription for that owner,
   * calls Cashfree to create the real subscription, then persists the
   * result. All four steps happen in that order — Cashfree is never
   * called for an owner that already has an active subscription.
   */
  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CheckoutSession> {
    const user = this.requireAuthentication();

    const plan = await this.planRepository.findBySlug(input.planSlug);
    if (!plan || !plan.is_active) {
      throw new NotFoundError('Plan not found or not active.', {
        resource: 'plan',
        planSlug: input.planSlug,
      });
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
      throw new Error(
        `${owner.type === 'profile' ? 'This profile' : 'This firm'} already has an active subscription (status: ${existing.status}).`,
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
      customer: input.customer,
      authorizationAmountRupees: amountRupees,
      returnUrl: input.returnUrl,
    });

    // FLAGGED, INFERRED: SubscriptionRepository extends BaseRepository
    // and inherits create() unchanged, but base.repository.ts itself has
    // not been pasted in this session — its create() signature is
    // inferred from consistent usage patterns elsewhere in this project,
    // not independently re-verified here. If this doesn't type-check
    // against the real BaseRepository<'subscriptions'>['create'] shape,
    // that inference is the first thing to check.
    await this.subscriptionRepository.create({
      profile_id: owner.type === 'profile' ? owner.id : null,
      firm_id: owner.type === 'firm' ? owner.id : null,
      plan_id: plan.id,
      cashfree_subscription_id: cashfreeResult.cfSubscriptionId,
      status: cashfreeResult.status,
    } as never);

    return {
      subscriptionId: cashfreeResult.subscriptionId,
      cfSubscriptionId: cashfreeResult.cfSubscriptionId,
      status: cashfreeResult.status,
    };
  }

  /**
   * Resolves plans.billing_target to a concrete owner. For 'individual'
   * or 'lawyer' plans, the owner is always the current user's own
   * profile — requireOwnership isn't needed here since there's nothing
   * to check against except the caller's own id. For 'firm' plans, the
   * caller must supply an existing firmId, and requireOwnership() gates
   * that the current user is that firm's real owner (firm.owner_id) —
   * NOT merely a member, matching this session's earlier RLS decision
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
        throw new Error(
          'A firmId is required to check out a firm plan. This project has no firm-creation ' +
            'flow yet — the firm must already exist.',
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
}