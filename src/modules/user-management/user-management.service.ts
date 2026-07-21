import { BaseService } from '@/core/services/base.service';
import type { AuthUser } from '@/core/auth/types';
import type { Database } from '@/core/supabase/database.types';
import type { ProfileRepository } from '@/modules/profiles/profile.repository';
import type { AuthUserRepository, AuthUserSummary } from '@/modules/user-management/auth-user.repository';
import type { UserRole } from '@/core/auth/types';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

/**
 * AdminUserListItem
 * -------------------
 * The admin "view users" page's actual row shape.
 *
 * AMENDMENT (naming-mismatch fix): this is now a hand-declared camelCase
 * shape, NOT `extends ProfileRow`. The previous version extended
 * `ProfileRow` and spread `...row` directly into it — but `ProfileRow`
 * (confirmed via database_types.ts this session: `avatar_url`,
 * `created_at`, `firm_id`, `full_name`, `id`, `phone`, `updated_at`) is
 * snake_case, while page.tsx's `AdminUserRow` has always expected
 * camelCase (`fullName`, `firmId`, `avatarUrl`, `createdAt`). Spreading
 * the raw row silently sent snake_case keys to a frontend reading
 * camelCase ones — every row would have rendered blank Name/Firm/Joined
 * columns.
 *
 * Decision (user's call, not inferred): map to camelCase here in the
 * Service, not in page.tsx — keeps ONE consistent wire convention across
 * every field in the response, including the four enriched auth fields
 * (`email`/`role`/`emailVerified`/`lastSignInAt`), which were already
 * camelCase and unaffected by this bug.
 *
 * `updatedAt` was on `ProfileRow` but has no consumer in page.tsx today
 * (AdminUserRow doesn't declare it) — included here anyway, since
 * omitting a real DB field from this mapping would be a new, silent
 * narrowing of the row, not something page.tsx asked for.
 */
export interface AdminUserListItem {
  readonly id: string;
  readonly fullName: string | null;
  readonly phone: string | null;
  readonly firmId: string | null;
  readonly avatarUrl: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly email: string | null;
  readonly role: UserRole | null;
  readonly emailVerified: boolean | null;
  readonly lastSignInAt: string | null;
}

/**
 * NEW. Maps a raw ProfileRow (snake_case, per database_types.ts) plus an
 * optional AuthUserSummary into the camelCase AdminUserListItem the
 * frontend expects. Isolated as its own function so the field-by-field
 * mapping is visible in one place, not interleaved into listUsers()'s
 * pagination/join logic.
 */
function toAdminUserListItem(
  row: ProfileRow,
  summary: AuthUserSummary | undefined,
): AdminUserListItem {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    firmId: row.firm_id,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    email: summary?.email ?? null,
    role: summary?.role ?? null,
    emailVerified: summary?.emailVerified ?? null,
    lastSignInAt: summary?.lastSignInAt ?? null,
  };
}

/**
 * UserManagementService
 * ----------------------
 * Admin Tooling — User & Org Management module.
 *
 * Depends on TWO repositories: ProfileRepository and AuthUserRepository
 * (imported from @/modules/user-management/auth-user.repository, its
 * real location, built directly in this module folder unlike
 * ProfileRepository which stays cross-module-imported from
 * @/modules/profiles/profile.repository — CORRECTED this pass; the
 * previous import path (`@/modules/billing/profile.repository`) was
 * wrong and confirmed as a real bug against the real file's project
 * path this session).
 *
 * FLAGGED, CONSTRUCTOR CONTRACT (unchanged from prior version):
 * AuthUserRepository's own doc comment requires it be constructed with
 * the admin.ts service-role client specifically. Not enforceable at the
 * type level — whatever call site constructs UserManagementService
 * (user-management.factory.ts, confirmed this session) MUST pass an
 * AuthUserRepository instance built with admin.ts, not server.ts.
 *
 * requireRole('admin', 'support') used directly here — unchanged
 * convention from before this file's amendment.
 */
export class UserManagementService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly profileRepository: ProfileRepository,
    private readonly authUserRepository: AuthUserRepository,
  ) {
    super(currentUser);
  }

  /**
   * Paginated, optionally-searched listing of every profile on the
   * platform, enriched with email/role/verification/last-sign-in.
   *
   * Sequence (unchanged from prior version):
   *   1. `profileRepository.findAllForAdmin(options)` — one page of
   *      ProfileRow + total count.
   *   2. Extract that page's ids, pass to
   *      `authUserRepository.findSummariesByIds()` — respects that
   *      method's "one bounded page only" constraint.
   *   3. Join in memory by id (Map keyed by AuthUserSummary.id).
   *
   * AMENDMENT: the join step now goes through `toAdminUserListItem()`
   * instead of an inline `{ ...row, ... }` spread, so the snake_case →
   * camelCase mapping happens in exactly one place. A profile with no
   * matching summary still gets all four enriched fields set to null —
   * same "keep the row, null the gap" reasoning as before.
   *
   * Still role-gated via requireRole('admin', 'support'), still two
   * sequential (not parallelized) round trips, same reasoning as before.
   */
  async listUsers(options: {
    readonly limit: number;
    readonly offset: number;
    readonly search?: string;
  }): Promise<{ readonly rows: readonly AdminUserListItem[]; readonly total: number }> {
    this.requireRole('admin', 'support');

    const { rows, total } = await this.profileRepository.findAllForAdmin(options);

    const ids = rows.map((row) => row.id);
    const summaries = await this.authUserRepository.findSummariesByIds(ids);

    const summaryById = new Map<string, AuthUserSummary>(
      summaries.map((summary) => [summary.id, summary]),
    );

    const enrichedRows: readonly AdminUserListItem[] = rows.map((row) =>
      toAdminUserListItem(row, summaryById.get(row.id)),
    );

    return { rows: enrichedRows, total };
  }

  /**
   * Suspends a user via Supabase's Auth Admin API (`auth.admin` /
   * AuthUserRepository.setBanned()) — never a `profiles` column, per this
   * module's earlier decision that ban state shouldn't sit on a table with
   * a client-writable RLS policy.
   *
   * `findByIdOrThrow()` is called first purely to turn "no such profile"
   * into a clean not-found error before touching the Auth Admin API.
   * (Previously flagged as unconfirmed inference from BaseRepository —
   * now a closed, confirmed item: #42, `base_repository.ts` pasted and
   * read in an earlier session, `findByIdOrThrow()` confirmed real.)
   *
   * AMENDED, FLAGGED CHANGE: `AuthUserRepository.setBanned()`'s real,
   * confirmed signature (per `auth-user.repository.ts`, pasted and read
   * this session) is `setBanned(id: string, banned: boolean):
   * Promise<void>` — it no longer takes a caller-supplied duration
   * string and no longer returns an `AuthUserSummary`. This method's own
   * public return type (`Promise<AuthUserSummary>`) is preserved here as
   * an explicit, flagged assumption — no route/caller file was pasted
   * this session to confirm what callers actually expect back, so rather
   * than silently changing this method's external contract to `void`,
   * the previously-fetched-and-discarded pattern is extended: after
   * `setBanned()` resolves, the fresh summary is re-fetched via the
   * already-used `findSummariesByIds()` and returned. If no summary
   * comes back (shouldn't happen for a userId that just passed
   * `findByIdOrThrow()`, but the Auth Admin API is a separate system), a
   * `DatabaseError`-style failure is surfaced rather than returning
   * `undefined` silently.
   *
   * The `ban_duration` string values ('876000h' / 'none') that used to
   * live in THIS file are gone — that mapping now lives entirely inside
   * `AuthUserRepository.setBanned()` (confirmed constant:
   * `PERMANENT_BAN_DURATION = '87600h'`, ~10 years — NOTE this is the
   * real value, still off by one zero from the stale `'876000h'` this
   * file previously called with, and still not independently verified
   * against a real Supabase Admin API response — that part of #41
   * stays open regardless of this fix).
   */
  async suspendUser(userId: string): Promise<AuthUserSummary> {
    this.requireRole('admin', 'support');

    await this.profileRepository.findByIdOrThrow(userId);

    await this.authUserRepository.setBanned(userId, true);

    const [summary] = await this.authUserRepository.findSummariesByIds([userId]);

    if (!summary) {
      throw new Error(`Failed to load auth user summary for ${userId} after suspending.`);
    }

    return summary;
  }

  /**
   * Reverses suspendUser() via the same Auth Admin API path.
   *
   * AMENDED, FLAGGED CHANGE: same reasoning as suspendUser() above —
   * `setBanned(userId, false)` now returns `void`, so the summary is
   * re-fetched to preserve this method's existing `Promise<AuthUserSummary>`
   * return contract.
   */
  async reactivateUser(userId: string): Promise<AuthUserSummary> {
    this.requireRole('admin', 'support');

    await this.profileRepository.findByIdOrThrow(userId);

    await this.authUserRepository.setBanned(userId, false);

    const [summary] = await this.authUserRepository.findSummariesByIds([userId]);

    if (!summary) {
      throw new Error(`Failed to load auth user summary for ${userId} after reactivating.`);
    }

    return summary;
  }
}