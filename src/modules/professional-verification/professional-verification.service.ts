import { BaseService } from '@/core/services/base.service';
import type { AuthUser, UserRole } from '@/core/auth/types';
import type { Database } from '@/core/supabase/database.types';
import { AuthorizationError, ConflictError } from '@/core/errors/app-error';
import {
  ProfessionalVerificationRepository,
  type VerificationStatus,
} from '@/modules/professional-verification/professional-verification.repository';

type ProfessionalVerificationRow =
  Database['public']['Tables']['professional_verifications']['Row'];

/**
 * Roles allowed to submit a verification. Subset of the
 * `professional_verifications_role_check` DB constraint
 * ('individual','lawyer','law_firm','business','admin','support'):
 * staff roles never need verification, and 'client' is not in the
 * constraint at all. The DB guard trigger
 * (20261016000000_harden_professional_verification_lifecycle.sql)
 * enforces the same list as a backstop.
 */
const VERIFIABLE_ROLES: readonly UserRole[] = ['individual', 'lawyer', 'law_firm', 'business'];

/**
 * ProfessionalVerificationService
 * ----------------------------------
 * #43 — Professional account verification. Built as its own standalone
 * service, deliberately NOT layered on top of `UserManagementService`,
 * per an earlier session's decision (that file carried a real, now-fixed
 * bug at the time, and this feature has no functional dependency on it
 * anyway).
 *
 * FLAGGED ASSUMPTION, load-bearing for every method below: this service
 * assumes `professional_verifications.profile_id` is matched against
 * `AuthUser.id` directly — i.e. that a profile's id IS the same id as
 * the authenticated user's id. RESOLVED, CLOSED (earlier session):
 * confirmed real via full pasted `20260711120000_create_profiles_table.sql`
 * — `id uuid primary key references auth.users (id) on delete cascade`.
 * `profiles.id` IS `auth.users.id`. Every `requireOwnership`/`profile_id`
 * match against `user.id` in this file is confirmed correct.
 *
 * All writes to `professional_verifications` MUST go through this
 * service — no client route may issue a raw `.update()` against this
 * table, per the migration's own documented RLS limitation (RLS alone
 * cannot enforce "rejected -> resubmitted only"; that transition rule
 * is enforced here, in `submit()`, and nowhere else).
 *
 * RESOLVED, CLOSED THIS SESSION: `repository.create(data)` and
 * `repository.update(id, data)` signatures were previously assumed by
 * convention only. Now confirmed real via full pasted `base.repository.ts`:
 * `create(input: Insert): Promise<Row>` and
 * `update(id: string, input: Update): Promise<Row>` — exactly the shape
 * already assumed below. No code change needed; this flag is closed.
 *
 * RESOLVED, CLOSED THIS SESSION: both business-rule rejections below
 * previously threw a plain `Error`. `core/errors/app-error.ts` and
 * `core/errors/error-handler.ts` are now confirmed real via full pasted
 * source. Per `error-handler.ts`'s `normalizeError()`, anything that
 * isn't an `AppError` or a `ZodError` gets wrapped in
 * `InternalServerError` (HTTP 500) — meaning both rejections below were
 * silently surfacing as fake server errors instead of the correct
 * status. Both now throw `ConflictError` (HTTP 409, `RESOURCE_CONFLICT`)
 * — the state-transition-rejected-by-current-status shape is exactly
 * what `ConflictError` models; `ValidationError` (400) was considered
 * and rejected here since the input itself isn't malformed, only
 * disallowed given the row's current state.
 */
export class ProfessionalVerificationService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly repository: ProfessionalVerificationRepository,
  ) {
    super(currentUser);
  }

  /**
   * Returns the caller's own verification row, or `null` if they've
   * never submitted one. `null` is a normal, expected outcome — not an
   * error — same reasoning the repository's own `findByProfileId()` doc
   * comment gives.
   */
  async getOwnVerification(): Promise<ProfessionalVerificationRow | null> {
    const user = this.requireAuthentication();

    return this.repository.findByProfileId(user.id);
  }

  /**
   * Submits (first time) or resubmits (after rejection) a professional
   * verification for the current user.
   *
   * Enforced transition rule (this is the method the migration's RLS
   * gap requires): resubmission is only permitted when the caller's
   * existing row has `status === 'rejected'`. Confirmed directly by the
   * user: the USER themselves triggers `resubmitted`, not an admin and
   * not an automatic new-submission-after-rejection rule.
   *
   *   - No existing row -> create one, `status: 'pending'`.
   *   - Existing row, `status === 'rejected'` -> update in place:
   *     new `registration_number`, `status: 'resubmitted'`.
   *     RESOLVED: this clears `reviewed_at`/`reviewed_by` on the live
   *     row, but the rejection is no longer lost -- the DB archive
   *     trigger (20261016000000) snapshots the closed decision into
   *     `professional_verification_history` before it is overwritten.
   *     `role` is re-stamped from the session too, which also repairs
   *     legacy rows that were rejected while role was still NULL.
   *   - Existing row, any other status (`pending`, `verified`,
   *     `resubmitted`) -> rejected with a `ConflictError`; there's
   *     nothing to resubmit from those states.
   */
  async submit(registrationNumber: string): Promise<ProfessionalVerificationRow> {
    const user = this.requireAuthentication();

    // Role comes ONLY from the authenticated session (app_metadata, the
    // source of truth) -- never from the request body. The DB guard trigger
    // re-derives it from the JWT, so a crafted direct write cannot differ.
    if (!VERIFIABLE_ROLES.includes(user.role)) {
      throw new AuthorizationError(
        `Accounts with role "${user.role}" cannot submit a professional verification.`,
        { actualRole: user.role, allowedRoles: VERIFIABLE_ROLES },
      );
    }

    const existing = await this.repository.findByProfileId(user.id);

    if (!existing) {
      return this.repository.create({
        profile_id: user.id,
        registration_number: registrationNumber,
        role: user.role,
        status: 'pending' satisfies VerificationStatus,
      });
    }

    if (existing.status !== 'rejected') {
      throw new ConflictError(
        `Cannot resubmit a professional verification with status "${existing.status}". ` +
          `Resubmission is only allowed after a rejection.`,
        { verificationId: existing.id, currentStatus: existing.status },
      );
    }

    return this.repository.update(existing.id, {
      registration_number: registrationNumber,
      role: user.role,
      status: 'resubmitted' satisfies VerificationStatus,
      reviewed_at: null,
      reviewed_by: null,
    });
  }

  /**
   * Admin review queue listing. Delegates straight to the repository's
   * `findAllForAdminReview()`, role-gated here first.
   *
   * FLAGGED ASSUMPTION (still open, unchanged by this edit): gated to
   * `requireRole('admin')` only, NOT `'admin', 'support'` like
   * `UserManagementService` uses elsewhere — scoping notes never
   * specified whether 'support' can review verifications, only that
   * review is "manual admin only." Narrowed to the literal word used
   * ("admin") rather than assuming parity with a different module's
   * role list. Widen this if 'support' should also have access.
   *
   * Defaults the queue to `['pending', 'resubmitted']` — the two
   * "needs a decision" states — rather than every row, since a review
   * queue showing already-`verified`/`rejected` rows isn't a queue.
   * Callers can still pass an explicit `statuses` override.
   */
  async listForReview(options: {
    readonly limit: number;
    readonly offset: number;
    readonly statuses?: readonly VerificationStatus[];
  }): Promise<{ readonly rows: ProfessionalVerificationRow[]; readonly total: number }> {
    this.requireRole('admin');

    return this.repository.findAllForAdminReview({
      limit: options.limit,
      offset: options.offset,
      statuses: options.statuses ?? ['pending', 'resubmitted'],
    });
  }

  /**
   * Admin decision on a single verification row: approve or reject.
   *
   * FLAGGED ASSUMPTION (still open, unchanged by this edit): only
   * permits deciding on rows currently `pending` or `resubmitted` —
   * deciding on an already-`verified` or already-`rejected` row is
   * rejected with a `ConflictError`, on the reasoning that re-deciding
   * a closed row silently would overwrite a prior admin decision with
   * no record of the original.
   *
   * Sets `reviewed_by` to the acting admin's own id (`user.id`) and
   * `reviewed_at` to the current time — both required together,
   * consistent with the migration's `professional_verifications`
   * schema.
   */
  async review(
    verificationId: string,
    decision: Extract<VerificationStatus, 'verified' | 'rejected'>,
  ): Promise<ProfessionalVerificationRow> {
    const user = this.requireRole('admin');

    const existing = await this.repository.findByIdOrThrow(verificationId);

    if (existing.profile_id === user.id) {
      throw new AuthorizationError('You cannot review your own verification request.', {
        verificationId: existing.id,
      });
    }

    if (existing.status !== 'pending' && existing.status !== 'resubmitted') {
      throw new ConflictError(
        `Cannot review a professional verification with status "${existing.status}". ` +
          `Only "pending" or "resubmitted" applications can be reviewed.`,
        { verificationId: existing.id, currentStatus: existing.status },
      );
    }

    // A verified row with no role would silently never appear in the
    // directory (and cannot be told apart from a non-lawyer). Refuse
    // instead of guessing; legacy rows are handled by the migration's
    // trusted backfill or by the applicant resubmitting.
    if (decision === 'verified' && !existing.role) {
      throw new ConflictError(
        'Cannot approve a verification request whose professional role is not established. ' +
          'Reject it so the applicant can resubmit, or have it backfilled from the account role.',
        { verificationId: existing.id },
      );
    }

    // `role` is deliberately NOT part of this update: approval preserves
    // whatever role the request was submitted with. reviewed_by /
    // reviewed_at are also re-set server-side by the DB guard trigger.
    return this.repository.update(verificationId, {
      status: decision,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    });
  }
}