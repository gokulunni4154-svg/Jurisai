// src/modules/billing/subscription.repository.ts
// Phase 3 File 6 — Billing module.
// AMENDMENT #1: adds findActiveByFirmId(), mirroring findActiveByProfileId
// exactly, now that subscriptions can be owned by a firm as well as a
// profile (20260726000003_add_firm_billing_support.sql). Nothing else in
// this file changed from the real version you pasted.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';

type SubscriptionRow = Database['public']['Tables']['subscriptions']['Row'];

/**
 * Status values that count as "still in play" for a profile OR a firm —
 * must exactly match 20260726000001_fix_subscription_status_values.sql's
 * partial unique indexes (subscriptions_one_active_per_profile AND, as of
 * 20260726000003, subscriptions_one_active_per_firm — both use the
 * identical status list). Duplicated here rather than derived from the
 * DB, same flagged trade-off as before.
 */
const NON_TERMINAL_STATUSES = [
  'INITIALIZED',
  'ACTIVE',
  'ON_HOLD',
  'CUSTOMER_PAUSED',
  'BANK_APPROVAL_PENDING',
] as const;

export class SubscriptionRepository extends BaseRepository<'subscriptions'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'subscriptions');
  }

  /**
   * Finds the current non-terminal subscription for a profile, if any.
   * Unchanged from the real pasted version.
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
   * NEW, Amendment #1. Finds the current non-terminal subscription for a
   * firm, if any — the firm-side equivalent of findActiveByProfileId,
   * checked against the same non-terminal status list and mirroring the
   * new subscriptions_one_active_per_firm partial unique index added in
   * 20260726000003_add_firm_billing_support.sql. Same null-returning,
   * non-throwing shape — "no active firm subscription" is a normal case
   * (never subscribed, or lapsed), not an error.
   */
  async findActiveByFirmId(firmId: string): Promise<SubscriptionRow | null> {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .select('*')
      .eq('firm_id', firmId)
      .in('status', NON_TERMINAL_STATUSES)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to find active subscription by firm id',
        error,
        { table: this.tableName, firmId },
      );
    }

    return data as SubscriptionRow | null;
  }

  /**
   * Finds a subscription by its Cashfree-side subscription id. Unchanged
   * from the real pasted version — still flagged unresolved which
   * Cashfree ID field (subscription_id vs cf_subscription_id) is
   * authoritative for a real webhook lookup.
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
   * Overrides BaseRepository#delete to forbid it outright. Unchanged from
   * the real pasted version.
   */
  override async delete(): Promise<void> {
    throw new Error(
      'SubscriptionRepository.delete() is intentionally unsupported — subscriptions are ' +
        "never removed, only transitioned via update() to a terminal status (e.g. " +
        "CUSTOMER_CANCELLED) with cancelled_at set. This preserves billing history.",
    );
  }
}