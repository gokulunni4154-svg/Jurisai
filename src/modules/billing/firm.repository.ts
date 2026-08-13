// src/modules/billing/firm.repository.ts
// Structural mirror of PlanRepository/SubscriptionRepository against
// BaseRepository<'firms'>. No new pattern introduced.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';
import type { OrganizationType } from '@/core/auth/types';

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
   *
   * AMENDED, FOUNDATION TASK 1: takes an `organizationType` param,
   * defaulting to `'firm'` — every existing call site (createFirm()'s
   * conflict guard, getMyFirm()) is asking specifically "does this
   * profile own a paid Lawyer-Firms-plan firm", not "does this profile
   * own any `firms` row at all". Defaulting to `'firm'` preserves both
   * call sites' exact prior behavior unchanged. This distinction is now
   * load-bearing, not cosmetic: once a profile can also own a
   * `'personal'`-type row (via getOrCreatePersonalOrganization() below),
   * an unfiltered `.maybeSingle()` query would throw as soon as both
   * exist for the same owner_id, which is an expected, valid state, not
   * a data-integrity violation.
   */
  async findByOwnerId(
    ownerId: string,
    organizationType: OrganizationType = 'firm',
  ): Promise<FirmRow | null> {
    const { data, error } = await this.supabase
      .from('firms')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('organization_type', organizationType)
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to find firm by owner id', error, {
        table: this.tableName,
        ownerId,
        organizationType,
      });
    }

    return data as FirmRow | null;
  }

  /**
   * NEW, FOUNDATION TASK 1. Thin, self-documenting wrapper over
   * findByOwnerId() scoped to `'personal'` — the method
   * FirmService#getOrCreatePersonalOrganization() uses to check for an
   * existing personal organization before creating one. Kept as a named
   * method (not just an inline `findByOwnerId(id, 'personal')` call at
   * the one call site) so a future second call site doesn't have to
   * remember which literal to pass — same reasoning findPersonalOrgByOwnerId's
   * sibling, findByOwnerId's own default parameter, already establishes.
   */
  async findPersonalOrgByOwnerId(ownerId: string): Promise<FirmRow | null> {
    return this.findByOwnerId(ownerId, 'personal');
  }
}