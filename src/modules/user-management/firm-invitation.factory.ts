// src/modules/user-management/firm-invitation.factory.ts

import { createAdminClient } from '@/core/supabase/admin';
import type { AuthUser } from '@/core/auth/types';

import { FirmInvitationRepository } from './firm-invitation.repository';
import { FirmMemberRepository } from './firm-member.repository';
import { FirmInvitationService } from './firm-invitation.service';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import { AuthUserRepository } from './auth-user.repository';
import { FirmRepository } from '@/modules/billing/firm.repository';
import { ProfileRepository } from '@/modules/profiles/profile.repository';

/**
 * Phase 4 — Enterprise & Collaboration, Invitation System. Mirrors
 * firm.factory.ts/team.factory.ts's confirmed shape exactly: single
 * createAdminClient() instance, every repository constructed against
 * it, no per-repository client variation.
 *
 * firm_invitations has no client-writable RLS policy either (same
 * "membership changes are service-layer operations" reasoning
 * firm.factory.ts's own doc comment already gives for firms/
 * firm_members) — every write here goes through FirmInvitationService's
 * own requireFirmRole()-based checks instead, standing in for RLS the
 * same way this project's other membership-adjacent tables already do.
 *
 * AuthUserRepository is included here (unlike team-invitation.factory.ts,
 * which doesn't need it) because it MUST be admin-client-backed —
 * findIdByEmail() calls a security-definer RPC whose EXECUTE grant is
 * restricted to service_role (see
 * 20260807000000_create_find_auth_user_by_email_function.sql). Reusing
 * the same adminClient instance already in scope for this, rather than
 * constructing a second client, matches this factory's own established
 * one-client convention.
 *
 * FirmRepository and ProfileRepository — NEW, My Invitations task, this
 * session — back listPendingForCurrentUser()'s firmName/invitedByName
 * enrichment (see that method's own doc comment). Same adminClient
 * reuse: the caller viewing their own pending invitation is, by
 * definition, not yet a firm_members row for that firm, so an
 * RLS-respecting client would fail to read the firm name at all (firms
 * SELECT is owner/admin-only — see firms/[id]/route.ts's own doc
 * comment) or the inviter's profile (profiles SELECT is
 * owner-or-admin-only). Same "service-layer read stands in for
 * visibility RLS doesn't grant" reasoning
 * ProfileService#getPublicDisplayName() already established for Case
 * Timeline, applied here via direct repository composition rather than
 * a cross-Service call (this project's established no-cross-Service-
 * calls convention).
 */
export function createFirmInvitationService(currentUser: AuthUser | null): FirmInvitationService {
  const adminClient = createAdminClient();

  const firmInvitationRepository = new FirmInvitationRepository(adminClient);
  const firmMemberRepository = new FirmMemberRepository(adminClient);
  const auditLogRepository = new AuditLogRepository(adminClient);
  const authUserRepository = new AuthUserRepository(adminClient);
  const firmRepository = new FirmRepository(adminClient);
  const profileRepository = new ProfileRepository(adminClient);

  return new FirmInvitationService(
    currentUser,
    firmInvitationRepository,
    firmMemberRepository,
    auditLogRepository,
    authUserRepository,
    firmRepository,
    profileRepository,
  );
}