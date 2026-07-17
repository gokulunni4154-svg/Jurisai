import { BaseService } from '@/core/services/base.service';
import type { AuthUser } from '@/core/auth/types';
import { paginationSchema } from '@/core/validation/common.schemas';
import type { Database } from '@/core/supabase/database.types';
import { ProfileRepository } from './profile.repository';
import { updateProfileSchema } from './profile.schemas';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export interface ListProfilesResult {
  profiles: ProfileRow[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * ProfileService
 * ---------------
 * Business logic and authorization for the profiles module. Combines
 * ProfileRepository (File 26, pure data access) with BaseService's
 * authorization guards (File 23) and updateProfileSchema (File 27, input
 * validation) into the operations Route Handlers actually call.
 *
 * Authorization here deliberately mirrors the RLS policies defined in
 * supabase/migrations/20260711120000_create_profiles_table.sql (File 25):
 * a user may read/update their own profile; an admin may read any profile.
 * Keeping the service layer and the RLS layer in agreement is intentional
 * defense-in-depth -- if this service is ever invoked with an
 * RLS-bypassing admin client (File 17) instead of the RLS-respecting
 * server client (File 14), this service's own checks are still what
 * prevent one regular user from reading or modifying another's data.
 */
export class ProfileService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly profileRepository: ProfileRepository
  ) {
    super(currentUser);
  }

  /**
   * Returns the current user's own profile. There is no `id` parameter to
   * accept, and therefore nothing to authorize against another user's id
   * by construction -- the id always comes from the verified session, not
   * from caller-supplied input.
   *
   * Throws AuthenticationError if nobody is logged in. Throws NotFoundError
   * if the row is missing -- this should not happen given File 25's
   * auto-create trigger on auth.users insert, but findByIdOrThrow surfaces
   * that honestly as a real error rather than assuming the invariant holds
   * and returning something misleading if it doesn't.
   */
  async getOwnProfile() {
    const user = this.requireAuthentication();
    return this.profileRepository.findByIdOrThrow(user.id);
  }

  /**
   * Returns any single profile by id. Restricted to that profile's owner
   * or an admin -- see the class-level comment on why this matches File
   * 25's RLS policies exactly rather than being looser.
   *
   * Known, deliberate limitation: this does NOT support one regular user
   * viewing another's profile, which will be a real need once the Lawyer
   * Marketplace module exists (a lawyer's public name/photo should be
   * visible to prospective clients). That is a genuinely different access
   * pattern -- public marketplace-facing data belongs in its own table/view
   * with its own RLS policy, not a loosened version of this method.
   */
  async getProfileById(id: string) {
    this.requireOwnership(id, { allowRoles: ['admin'] });
    return this.profileRepository.findByIdOrThrow(id);
  }

  /**
   * NEW — Amendment #14. Lists all profiles, paginated. Admin-only: there
   * is no ownership fallback here (unlike getProfileById/updateProfile),
   * since nobody "owns" the full list -- requireRole('admin') is the
   * correct primitive, not requireOwnership() with an allowRoles escape
   * hatch meant for single-resource access.
   *
   * This method's existence resolves a real, previously-shipped defect:
   * GET /api/profiles (File 32) has been calling this method since it was
   * written, despite it never having existed until now -- see
   * PROJECT_PROGRESS.md's Amendments Log #9 and the Known Issues entry
   * logged this session for the full history. Every prior call to that
   * route has been throwing a TypeError, caught and reshaped into a 500
   * by handleApiError.
   *
   * `rawPagination` is parsed with the same shared paginationSchema
   * (File 24) Documents' listDocumentsQuerySchema also builds on --
   * profiles have no soft-delete or other Profiles-specific pagination
   * concern, so there's no reason for a Profiles-specific wrapper schema
   * to exist the way listDocumentsQuerySchema wraps paginationSchema with
   * `includeDeleted`.
   *
   * Response shape is flat -- { profiles, total, limit, offset } --
   * deliberately matching DocumentService.listDocuments()'s shape (File
   * 48), NOT the nested `{ profiles, pagination }` shape File 32's
   * original (broken) call site implied. That nested shape was never
   * real; there is no prior working convention to preserve, so this
   * resolves the flagged Profiles-vs-Documents drift by picking one
   * shape rather than perpetuating an assumption. File 32 must be
   * updated to match this method's actual return shape -- tracked as a
   * required, linked amendment, not optional cleanup.
   *
   * profileRepository.findMany()/count() are the plain BaseRepository
   * (File 22) implementations, unmodified -- ProfileRepository overrides
   * neither, since `profiles` has no soft-delete concept the way
   * `documents` does.
   */
  async listProfiles(rawPagination: unknown): Promise<ListProfilesResult> {
    this.requireRole('admin');
    const { limit, offset } = paginationSchema.parse(rawPagination);

    const [profiles, total] = await Promise.all([
      this.profileRepository.findMany({ limit, offset }),
      this.profileRepository.count(),
    ]);

    return { profiles, total, limit, offset };
  }

  /**
   * Updates the given profile.
   *
   * Authorization runs BEFORE input validation, deliberately: `id` comes
   * from the route param, not the request body, so requireOwnership() can
   * run using only currentUser and id, before any work is spent parsing
   * caller-supplied input. This means an unauthorized caller is rejected
   * immediately with a 403 (or 401 if unauthenticated), without a Zod
   * validation error ever running on their payload or potentially
   * revealing the update schema's shape to someone who shouldn't be
   * touching this resource at all.
   *
   * `rawInput` is deliberately typed `unknown`, not UpdateProfileInput --
   * this makes it a compile error to skip updateProfileSchema.parse() by
   * passing in an already-typed value; every caller is forced through
   * runtime validation, not just encouraged to use it by convention.
   */
  async updateProfile(id: string, rawInput: unknown) {
    this.requireOwnership(id, { allowRoles: ['admin'] });
    const input = updateProfileSchema.parse(rawInput);
    return this.profileRepository.update(id, input);
  }

  /**
   * Updates the current user's own profile. Convenience wrapper around
   * updateProfile() for the common case where the caller already knows
   * "self" is the target -- avoids a route handler needing separate
   * access to the current user's id just to satisfy updateProfile()'s
   * signature (currentUser is `protected`, not exposed outside the
   * BaseService hierarchy, by design -- see File 23).
   */
  async updateOwnProfile(rawInput: unknown) {
    const user = this.requireAuthentication();
    return this.updateProfile(user.id, rawInput);
  }
}