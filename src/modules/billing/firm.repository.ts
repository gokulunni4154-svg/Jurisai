// src/modules/billing/firm.repository.ts
// Structural mirror of PlanRepository/SubscriptionRepository against
// BaseRepository<'firms'>. No new pattern introduced.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';

type FirmRow = Database['public']['Tables']['firms']['Row'];

/**
 * Billing module's firm repository. Extends BaseRepository<'firms'> and
 * inherits findById/findByIdOrThrow/create/update/delete as-is.
 *
 * No firm-creation flow exists in this project yet (scoping it is
 * explicitly out of this file's scope — see BillingService's own
 * flagged limitation). This repository only supports the read path
 * checkout needs today: resolving a firm by id to check ownership
 * before creating a firm subscription.
 */
export class FirmRepository extends BaseRepository<'firms'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'firms');
  }

  /**
   * NEW. Finds the firm currently owned by a given profile, if any.
   * Deliberately does not assume a profile owns at most one firm at the
   * DB level (no unique constraint enforces that on `firms.owner_id`) —
   * `.maybeSingle()` will throw if Supabase itself finds more than one
   * row, which is the right failure mode until/unless a real product
   * decision says a profile may own multiple firms.
   */
  async findByOwnerId(ownerId: string): Promise<FirmRow | null> {
    const { data, error } = await this.supabase
      .from('firms')
      .select('*')
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to find firm by owner id', error, {
        table: this.tableName,
        ownerId,
      });
    }

    return data as FirmRow | null;
  }
}