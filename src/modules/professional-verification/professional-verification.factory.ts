// src/modules/professional-verification/professional-verification.factory.ts
// #43 — Professional account verification.

import { createClient } from '@/core/supabase/server';
import type { AuthUser } from '@/core/auth/types';
import { ProfessionalVerificationRepository } from '@/modules/professional-verification/professional-verification.repository';
import { ProfessionalVerificationService } from '@/modules/professional-verification/professional-verification.service';

/**
 * createProfessionalVerificationService
 * ---------------------------------------
 * RECONCILED THIS SESSION (open item #4 — the two coexisting
 * service-construction patterns). Previously
 * `buildProfessionalVerificationService()`, which resolved
 * `getCurrentUser()` INTERNALLY — the only service in the project doing
 * so. Every other service (Firm, Team, Billing, both Invitation
 * services) resolves the session in the ROUTE, then passes it into the
 * factory as a parameter (Pattern 1) — the majority convention, and the
 * smaller change to converge on versus rewriting four already-wired
 * services the other way. `currentUser` is now a parameter here too,
 * and renamed with the `create`-prefix to match
 * `createFirmInvitationService()`'s naming convention, since every call
 * site was already being touched for the parameter change anyway.
 *
 * STILL ASYNC, DELIBERATELY, NOT PART OF THIS RECONCILIATION: unlike
 * `createFirmInvitationService()`, which is fully sync because
 * `createAdminClient()` itself is sync, this factory still needs
 * `await createClient()` below — the RLS-scoped `server.ts` client
 * construction was already `await`ed before this session's change, most
 * likely because it reads cookies internally. The Pattern 1/Pattern 2
 * distinction is about WHERE the session gets resolved, not sync vs.
 * async as a blanket rule — forcing this factory to drop its `await`
 * entirely would just break the `createClient()` call for an unrelated
 * reason. Call sites therefore still `await` this factory, same as
 * before, just with `currentUser` now supplied rather than resolved
 * inside.
 *
 * ONE Supabase client only, unlike `buildUserManagementService()`'s two
 * — unrelated to this reconciliation, unchanged. `professional_verifications`
 * uses the RLS-scoped `server.ts` client, not `admin.ts` — this is a
 * separate, already-justified per-table choice (RLS coverage is
 * sufficient here, unlike `findIdByEmail()`'s service-role-only RPC),
 * not part of the construction-pattern question being reconciled. Left
 * untouched.
 *
 * FLAGGED (carried forward, unchanged by this session's edit): this
 * assumes `professional_verifications`' RLS policies are sufficient for
 * every method this Service calls (`findByProfileId`, `create`,
 * `update`, and the admin-facing `findAllForAdminReview` across ALL
 * rows regardless of `profile_id`). The migration's admin policy was
 * described as "admin read/update" — if the real RLS definition for
 * admin only permits row-by-row access (not an unfiltered
 * `select * where status in (...)` across every profile's row),
 * `findAllForAdminReview()` could return fewer rows than expected under
 * `server.ts`. Not independently re-verified against the actual applied
 * RLS policy text — if the admin review queue comes back empty or
 * incomplete in testing, this is the first place to check, and
 * `admin.ts` may need to be substituted in for that one method's
 * underlying client instead.
 */
export async function createProfessionalVerificationService(
  currentUser: AuthUser | null,
): Promise<ProfessionalVerificationService> {
  const rlsScopedClient = await createClient();

  const repository = new ProfessionalVerificationRepository(rlsScopedClient);

  return new ProfessionalVerificationService(currentUser, repository);
}