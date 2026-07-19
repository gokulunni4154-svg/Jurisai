// src/modules/billing/plan.repository.ts
// Built as a structural mirror of SubscriptionRepository (this session's
// other Billing repository) against BaseRepository<'plans'> instead of
// BaseRepository<'subscriptions'> — same constructor shape, same
// override conventions. No new pattern introduced.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';

type PlanRow = Database['public']['Tables']['plans']['Row'];

/**
 * Billing module's plan repository. Extends BaseRepository<'plans'> and
 * inherits findById/findByIdOrThrow/create/update/delete as-is.
 *
 * Unlike SubscriptionRepository, `delete()` is NOT overridden here —
 * `plans` has no billing-history concern the way `subscriptions` does;
 * an admin retiring a plan is a legitimate operation, and `is_active`
 * already exists for the more common "stop offering this plan without
 * destroying history" case. No override needed unless a real
 * requirement to forbid hard-deletes on `plans` surfaces later.
 *
 * `plans_select_active`/`plans_select_admin` RLS (from
 * `20260726000000_create_billing_tables.sql`) means an RLS-scoped
 * client CAN read active plans directly — findBySlug below works under
 * either client for an is_active=true plan, but will only see an
 * inactive plan under the admin.ts service-role client (or a session
 * carrying the admin role claim).
 */
export class PlanRepository extends BaseRepository<'plans'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'plans');
  }

  /**
   * NEW. Finds a plan by its stable `slug` (the internal reference key
   * checkout flows use, e.g. 'individual-monthly', 'firm-yearly') rather
   * than its uuid `id`. Returns `null` if no plan matches — same
   * null-returning shape as SubscriptionRepository#findActiveByProfileId,
   * not an OrThrow variant, since "no plan with this slug" is a normal
   * caller-side validation case (bad/stale slug from a client), not an
   * unexpected-state error.
   */
  async findBySlug(slug: string): Promise<PlanRow | null> {
    const { data, error } = await this.supabase
      .from('plans')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to find plan by slug', error, {
        table: this.tableName,
        slug,
      });
    }

    return data as PlanRow | null;
  }

  /**
   * NEW, added to back GET /api/billing/plans (pricing page). Lists all
   * plans with is_active = true, ordered by price_paise ascending —
   * FLAGGED, JUDGMENT CALL: ordering wasn't discussed anywhere; cheapest
   * first is a reasonable default for a pricing page but not something
   * this repository's prior source ever specified.
   *
   * FLAGGED, DELIBERATE REDUNDANCY: this filters explicitly with
   * `.eq('is_active', true)` even though plans_select_active RLS (see
   * this class's own header comment) means an RLS-scoped caller
   * physically cannot see inactive rows regardless. Filtering explicitly
   * here too means this method's behavior is correct by its own query,
   * not only correct because of a policy defined elsewhere — if this
   * repository is ever constructed with the admin.ts service-role client
   * for some future admin use case, this method still only returns
   * active plans rather than silently changing behavior under a
   * different client.
   *
   * No pagination (no `FindManyOptions`-style limit/offset): a plan
   * catalog is expected to be a small, fully-enumerable list rendered in
   * one page load, not something a caller pages through. Revisit if the
   * catalog grows large enough that this assumption stops holding.
   */
  async findActive(): Promise<PlanRow[]> {
    const { data, error } = await this.supabase
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('price_paise', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list active plans', error, {
        table: this.tableName,
      });
    }

    return (data ?? []) as PlanRow[];
  }
}