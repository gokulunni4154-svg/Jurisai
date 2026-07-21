// src/modules/professional-verification/professional-verification.factory.ts
// #43 — Professional account verification.

import { createClient } from '@/core/supabase/server';
import { getCurrentUser } from '@/core/auth/session';
import { ProfessionalVerificationRepository } from '@/modules/professional-verification/professional-verification.repository';
import { ProfessionalVerificationService } from '@/modules/professional-verification/professional-verification.service';

/**
 * buildProfessionalVerificationService
 * ---------------------------------------
 * Async factory constructing a request-scoped
 * ProfessionalVerificationService, mirroring the confirmed pattern in
 * `buildUserManagementService()` (`user-management.factory.ts`, pasted
 * this session): `getCurrentUser()` resolved once, passed into the
 * Service's constructor, Service never re-resolves its own session.
 *
 * ONE Supabase client only, unlike `buildUserManagementService()`'s two.
 * `AuthUserRepository` needed `admin.ts` specifically because
 * `supabase.auth.admin.*` is only available on the service-role client
 * — that constraint doesn't apply here. `professional_verifications` is
 * a regular Postgrest table, and the migration's own RLS policies
 * (confirmed this session, `20260726000002_create_professional_verifications_table.sql`)
 * already grant: own-row read/insert/update for a regular authenticated
 * user, and admin-role read/update for an admin. So the RLS-respecting
 * `server.ts` client is the correct, conservative choice for BOTH the
 * user-facing submission path and the admin review path — same
 * reasoning `buildUserManagementService()`'s own doc comment gives for
 * choosing `server.ts` over `admin.ts` for `ProfileRepository`: the
 * caller's role has already been (or will be) confirmed by the
 * Service's own `requireRole()`/`requireAuthentication()` calls before
 * any row is touched, so reaching for the RLS-bypassing client isn't
 * needed and would be the less conservative choice.
 *
 * FLAGGED: this assumes `professional_verifications`' RLS policies are
 * sufficient for every method this Service calls (`findByProfileId`,
 * `create`, `update`, and the admin-facing `findAllForAdminReview`
 * across ALL rows regardless of `profile_id`). The migration's admin
 * policy was described as "admin read/update" — if the real RLS
 * definition for admin only permits row-by-row access (not an
 * unfiltered `select * where status in (...)` across every profile's
 * row), `findAllForAdminReview()` could return fewer rows than expected
 * under `server.ts`. Not independently re-verified against the actual
 * applied RLS policy text this session (only the earlier summary of
 * it) — if the admin review queue comes back empty or incomplete in
 * testing, this is the first place to check, and `admin.ts` may need
 * to be substituted in for that one method's underlying client instead.
 */
export async function buildProfessionalVerificationService(): Promise<ProfessionalVerificationService> {
  const currentUser = await getCurrentUser();

  const rlsScopedClient = await createClient();

  const repository = new ProfessionalVerificationRepository(rlsScopedClient);

  return new ProfessionalVerificationService(currentUser, repository);
}