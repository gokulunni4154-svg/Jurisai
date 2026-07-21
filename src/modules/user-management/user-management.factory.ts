// src/modules/user-management/user-management.factory.ts
// Admin Tooling — User & Org Management module.

import { createClient } from '@/core/supabase/server';
import { createAdminClient } from '@/core/supabase/admin';
import { getCurrentUser } from '@/core/auth/session';
import { ProfileRepository } from '@/modules/profiles/profile.repository';
import { AuthUserRepository } from '@/modules/user-management/auth-user.repository';
import { UserManagementService } from '@/modules/user-management/user-management.service';

/**
 * buildUserManagementService
 * -----------------------------
 * NEW. Async factory constructing a request-scoped UserManagementService.
 *
 * FLAGGED, IMPORTANT SOURCE NOTE: the equivalent factory for the
 * Observability module (buildObservabilityService, imported by both
 * observability route.ts files this session) was never itself pasted —
 * only its CALL SITE (`await buildObservabilityService()`, no args) was
 * visible. This file mirrors only that thin, visible pattern — an async
 * function, no arguments, returning a constructed Service — not any
 * internal detail of that file, which remains unconfirmed. If
 * buildObservabilityService does something materially different
 * internally (e.g. a different client-selection strategy), this file
 * should be reconciled against it once it's actually pasted.
 *
 * TWO Supabase clients are constructed here, deliberately different from
 * each other, per each repository's own documented requirement:
 *   - server.ts (RLS-respecting, carries the calling user's session) for
 *     ProfileRepository. This is deliberately NOT admin.ts even though
 *     this is an admin-only path: ProfileRepository#findAllForAdmin's own
 *     doc comment already notes profiles_select_admin's RLS policy
 *     itself grants full-table read to a caller whose JWT role is
 *     'admin'/'support' — so the RLS-respecting client works correctly
 *     here specifically BECAUSE the caller has already been confirmed
 *     admin/support (by UserManagementService#listUsers's own
 *     requireRole() call, which runs before this repository is ever
 *     queried). Using admin.ts instead would work too, but would be
 *     reaching for the RLS-bypassing client for a call that doesn't
 *     need it — server.ts is the more conservative, correct-scope
 *     choice per admin.ts's own "reaching for this file...should be a
 *     deliberate, reviewable decision" guidance.
 *   - admin.ts (service-role, RLS-bypassing) for AuthUserRepository —
 *     NOT optional here, per that class's own doc comment: the
 *     supabase.auth.admin.* namespace it calls is only available on the
 *     service-role client, full stop, regardless of the caller's own
 *     role.
 *
 * `getCurrentUser()` is called once here and passed into the Service's
 * constructor as `currentUser` — the Service itself never fetches its
 * own session, consistent with BaseService's constructor-injection
 * convention already visible in UserManagementService's own signature.
 */
export async function buildUserManagementService(): Promise<UserManagementService> {
  const currentUser = await getCurrentUser();

  const rlsScopedClient = await createClient();
  const adminClient = createAdminClient();

  const profileRepository = new ProfileRepository(rlsScopedClient);
  const authUserRepository = new AuthUserRepository(adminClient);

  return new UserManagementService(currentUser, profileRepository, authUserRepository);
}