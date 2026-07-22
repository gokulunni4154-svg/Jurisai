// src/modules/user-management/team-invitation.factory.ts

import { createAdminClient } from '@/core/supabase/admin';
import type { AuthUser } from '@/core/auth/types';

import { TeamInvitationRepository } from './team-invitation.repository';
import { TeamRepository } from './team.repository';
import { FirmMemberRepository } from './firm-member.repository';
import { TeamMemberRepository } from './team-member.repository';
import { TeamInvitationService } from './team-invitation.service';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

/**
 * Phase 4 — Enterprise & Collaboration, Invitation System. Same
 * confirmed single-admin-client shape as firm-invitation.factory.ts/
 * team.factory.ts/firm.factory.ts. No AuthUserRepository here, unlike
 * firm-invitation.factory.ts — team invitations have no email/token
 * path at all (Decisions #11/#12), so there's nothing for it to do.
 *
 * team_invitations has no client-writable RLS policy either, same
 * "service-layer operations only" reasoning every other membership-
 * adjacent table in this project already carries — TeamInvitationService's
 * own requireFirmRole()-based checks (resolved against the team's real
 * firm_id, not caller input — see that service's own doc comment) stand
 * in for RLS on this table's write path.
 *
 * TeamRepository and TeamMemberRepository are both included per
 * TeamInvitationService's constructor: the former resolves a team's
 * real firm_id for authorization, the latter is the accept-time write
 * target. TeamMemberRepository's real shape has not been independently
 * pasted this session — constructed here on the same trusted
 * BaseRepository-inheritance basis team-invitation.service.ts's own doc
 * comment already flags, not a fresh confirmation.
 */
export function createTeamInvitationService(currentUser: AuthUser | null): TeamInvitationService {
  const adminClient = createAdminClient();

  const teamInvitationRepository = new TeamInvitationRepository(adminClient);
  const teamRepository = new TeamRepository(adminClient);
  const firmMemberRepository = new FirmMemberRepository(adminClient);
  const teamMemberRepository = new TeamMemberRepository(adminClient);
  const auditLogRepository = new AuditLogRepository(adminClient);

  return new TeamInvitationService(
    currentUser,
    teamInvitationRepository,
    teamRepository,
    firmMemberRepository,
    teamMemberRepository,
    auditLogRepository,
  );
}