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
}