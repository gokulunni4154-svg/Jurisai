import { BaseRepository } from '@/core/repositories/base.repository';
import { DatabaseError } from '@/core/errors/app-error';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/core/supabase/database.types';

type ProfessionalVerificationRow =
  Database['public']['Tables']['professional_verifications']['Row'];
type ProfessionalVerificationInsert =
  Database['public']['Tables']['professional_verifications']['Insert'];
type ProfessionalVerificationUpdate =
  Database['public']['Tables']['professional_verifications']['Update'];

/**
 * VerificationStatus
 * --------------------
 * FLAGGED, REAL DISCREPANCY (carried forward from this session's
 * check of `database.types.ts`): the generated `status` column type is
 * plain `string`, not a literal union — there is no
 * `professional_verification_status` enum registered in
 * `Constants.public.Enums` either. This means the four-state contract
 * (pending / verified / rejected / resubmitted, per last session's
 * product decision) has NO database-level type safety today. This
 * union is declared here, in the Repository layer, as the single
 * source of truth for the shape TypeScript will enforce — but it is
 * NOT enforced by a real DB constraint unless one was added directly
 * in the migration SQL as a plain CHECK (unconfirmed either way this
 * session).
 */
export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'resubmitted';

/**
 * ProfessionalVerificationRepository
 * ------------------------------------
 * Typed data access for the `professional_verifications` table.
 * Inherits findById, findByIdOrThrow, findMany, count, create, update,
 * delete from BaseRepository — same inheritance pattern confirmed this
 * session via `profile.repository.ts`'s real, pasted usage of
 * `BaseRepository<'profiles', ProfileRow, ProfileInsert, ProfileUpdate>`.
 * `BaseRepository` itself was not re-pasted this session; this class
 * follows that confirmed pattern rather than introducing anything new
 * about its shape.
 *
 * As with ProfileRepository, the caller decides which SupabaseClient to
 * inject (server.ts vs admin.ts) — this class has no opinion on that.
 *
 * DELIBERATELY THIN: this repository does NOT enforce the
 * "rejected -> resubmitted only" status-transition rule. Per last
 * session's decision (documented in the migration's own RLS
 * limitation), RLS alone cannot enforce that transition, and the
 * decision was that the Service layer is responsible for it — not this
 * repository, and not a client-issued raw `.update()`. This file only
 * provides typed read/write primitives; no client route may ever call
 * `update()` on this table directly (Service-layer-only rule, same
 * requirement the migration's own doc comment states).
 */
export class ProfessionalVerificationRepository extends BaseRepository<
  'professional_verifications',
  ProfessionalVerificationRow,
  ProfessionalVerificationInsert,
  ProfessionalVerificationUpdate
> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'professional_verifications');
  }

  /**
   * Looks up the single verification row belonging to a given profile.
   * `profile_id` is 1:1 on `profiles.id` (confirmed via
   * `database.types.ts`: `isOneToOne: true` on
   * `professional_verifications_profile_id_fkey`), so this returns at
   * most one row, or `null` if the profile has never submitted a
   * verification.
   *
   * NOT `findByIdOrThrow`-style: a missing row here is an expected,
   * normal state (most profiles won't have submitted yet), not an
   * error condition — the same "null is a valid outcome" reasoning
   * `BaseService.currentUser` documents for a different case.
   */
  async findByProfileId(profileId: string): Promise<ProfessionalVerificationRow | null> {
    const { data, error } = await this.supabase
      .from('professional_verifications')
      .select('*')
      .eq('profile_id', profileId)
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to look up professional verification by profile_id', error, {
        table: this.tableName,
        profileId,
      });
    }

    return data as ProfessionalVerificationRow | null;
  }

  /**
   * Paginated, optionally status-filtered listing for the admin review
   * queue. Same shape as `ProfileRepository.findAllForAdmin()` (pasted
   * and confirmed this session): one round trip via
   * `{ count: 'exact' }`, `created_at` ordering, offset/limit paging.
   *
   * FLAGGED ASSUMPTIONS, new to this method, no direct prior precedent:
   *   1. Default ordering is `created_at asc` (oldest submission
   *      first) — the opposite default of `findAllForAdmin()`'s
   *      "newest first," because a review queue is naturally a FIFO
   *      worklist, not a browse-all list. Not specified anywhere
   *      last session; a genuinely new, flagged choice.
   *   2. `statuses` filter accepts a list (not a single value) so the
   *      queue can show `['pending', 'resubmitted']` together as "needs
   *      review," while still allowing a narrower single-status query.
   *      Omitting it returns every row regardless of status.
   *
   * AUTHORIZATION IS NOT THIS METHOD'S CONCERN — same division of
   * responsibility `ProfileRepository`'s admin methods already
   * document. The Service layer calling this must already have
   * confirmed the caller holds 'admin' (or whichever role is decided)
   * before this is ever invoked.
   */
  async findAllForAdminReview(options: {
    readonly limit: number;
    readonly offset: number;
    readonly statuses?: readonly VerificationStatus[];
  }): Promise<{ readonly rows: ProfessionalVerificationRow[]; readonly total: number }> {
    let query = this.supabase
      .from('professional_verifications')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: true })
      .range(options.offset, options.offset + options.limit - 1);

    if (options.statuses && options.statuses.length > 0) {
      query = query.in('status', options.statuses);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new DatabaseError('Failed to list professional verifications for admin review', error, {
        table: this.tableName,
        limit: options.limit,
        offset: options.offset,
        statuses: options.statuses,
      });
    }

    return {
      rows: (data ?? []) as ProfessionalVerificationRow[],
      total: count ?? 0,
    };
  }
}