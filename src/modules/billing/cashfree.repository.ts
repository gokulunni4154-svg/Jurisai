// src/modules/billing/subscription.repository.ts
// Phase 3 File 6 — Billing module.
// Built against real base.repository.ts and document.repository.ts
// source (both pasted this session) for constructor shape, override
// conventions, and error-wrapping style.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';

type SubscriptionRow = Database['public']['Tables']['subscriptions']['Row'];

/**
 * Status values that count as "still in play" for a profile — must
 * exactly match `20260726000001_fix_subscription_status_values.sql`'s
 * partial unique index (`subscriptions_one_active_per_profile`).
 * Duplicated here rather than derived from the DB, same flagged
 * trade-off DocumentRepository's own `DOCUMENTS_BUCKET` constant already
 * accepts (a Repository-layer constant mirroring a migration's SQL,
 * flagged as duplication rather than silently kept in sync). If that
 * migration's partial index is ever changed, this list must be updated
 * to match — not automatically enforced by anything.
 */
const NON_TERMINAL_STATUSES = [
  'INITIALIZED',
  'ACTIVE',
  'ON_HOLD',
  'CUSTOMER_PAUSED',
  'BANK_APPROVAL_PENDING',
] as const;

/**
 * Billing module's repository. Extends BaseRepository<'subscriptions'>
 * and inherits findById/findByIdOrThrow/create/update as-is — none need
 * subscriptions-specific behavior beyond what's added below.
 *
 * FLAGGED, IMPORTANT — unlike DocumentRepository, this repository's
 * WRITE methods (create/update, inherited unchanged from BaseRepository)
 * can NEVER be called with an RLS-scoped (server.ts) client and succeed.
 * `20260726000000_create_billing_tables.sql`'s own RLS section is
 * explicit: there is no insert/update/delete policy for `authenticated`
 * on `subscriptions` at all — by design, so a user's own session can
 * never self-assign subscription state. This means whatever constructs
 * this repository for a write path (a future BillingService, or a
 * webhook handler) MUST inject the admin.ts service-role client, same
 * as the cron route's NotificationRepository usage — not a choice left
 * to the call site the way DocumentRepository's RLS-vs-admin choice is,
 * but a hard requirement enforced by Postgres RLS either way. A caller
 * that mistakenly injects server.ts here won't silently under-return
 * (as findDueForHearingReminder's own doc comment warns for a bad
 * client choice) — writes will outright fail with a Postgres RLS
 * rejection, surfaced here as a DatabaseError.
 *
 * Read methods (findById, findBySomething below) CAN use either client —
 * `subscriptions_select_own`'s RLS policy lets a user read their own row
 * under server.ts, which is exactly what a future "my subscription"
 * self-service view would want.
 */
export class SubscriptionRepository extends BaseRepository<'subscriptions'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'subscriptions');
  }

  /**
   * NEW. Finds the current non-terminal subscription for a profile, if
   * any — the row the partial unique index guarantees is at most one.
   * Returns `null` if the profile has no active/in-progress subscription
   * (e.g. never subscribed, or their only subscription already reached a
   * terminal state like CUSTOMER_CANCELLED).
   *
   * `.maybeSingle()` rather than `.single()`: zero matching rows is a
   * normal, expected case here (not an error condition the way a
   * missing-by-id lookup is), so this deliberately does NOT throw
   * NotFoundError the way findByIdOrThrow does — mirrors
   * DocumentRepository#findById's null-returning shape, not its
   * OrThrow variant.
   */
  async findActiveByProfileId(profileId: string): Promise<SubscriptionRow | null> {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .select('*')
      .eq('profile_id', profileId)
      .in('status', NON_TERMINAL_STATUSES)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to find active subscription by profile id',
        error,
        { table: this.tableName, profileId },
      );
    }

    return data as SubscriptionRow | null;
  }

  /**
   * NEW. Finds a subscription by its Cashfree-side subscription id —
   * the lookup a future webhook handler needs to resolve an incoming
   * event (which carries Cashfree's own subscription_id/
   * cf_subscription_id, not our internal `id`) back to the real row to
   * update.
   *
   * FLAGGED, NOT YET RESOLVED: takes a single `cashfreeSubscriptionId`
   * parameter matched against this table's `cashfree_subscription_id`
   * column. Whether a real Cashfree webhook payload's `subscription_id`
   * (the one WE generate and send when creating the subscription) or
   * `cf_subscription_id` (the one CASHFREE generates) is the more
   * reliable/present field to match on has not been confirmed against a
   * real webhook payload this session — cashfree.service.ts's own
   * createSubscription() flags the same uncertainty about which field
   * name is authoritative. This method's parameter name is deliberately
   * generic (not `cfSubscriptionId`) so it isn't misleading either way;
   * revisit once a real webhook payload is seen.
   */
  async findByCashfreeSubscriptionId(
    cashfreeSubscriptionId: string,
  ): Promise<SubscriptionRow | null> {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .select('*')
      .eq('cashfree_subscription_id', cashfreeSubscriptionId)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to find subscription by Cashfree subscription id',
        error,
        { table: this.tableName, cashfreeSubscriptionId },
      );
    }

    return data as SubscriptionRow | null;
  }

  /**
   * Overrides BaseRepository#delete to forbid it outright. A
   * subscription row is a billing record — hard-deleting it would
   * destroy history a real product almost certainly needs (disputes,
   * "when did this user's plan change", support queries). Documents
   * solved the equivalent problem with a `deleted_at` soft-delete column
   * (see DocumentRepository#delete's real doc comment); this table has
   * no such column, but it DOES have `cancelled_at` and a real
   * `CUSTOMER_CANCELLED`/`EXPIRED`/etc. status vocabulary already —
   * "deleting" a subscription should always mean transitioning its
   * status via `update()`, never removing the row. Reasoned fresh, no
   * direct precedent for "delete is forbidden, not soft" existed in this
   * codebase before now; flagged as a considered decision.
   */
  override async delete(): Promise<void> {
    throw new Error(
      'SubscriptionRepository.delete() is intentionally unsupported — subscriptions are ' +
        "never removed, only transitioned via update() to a terminal status (e.g. " +
        "CUSTOMER_CANCELLED) with cancelled_at set. This preserves billing history.",
    );
  }
}