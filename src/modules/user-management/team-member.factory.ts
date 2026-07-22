// src/modules/user-management/team-member.factory.ts

import { createAdminClient } from '@/core/supabase/admin';
import type { AuthUser } from '@/core/auth/types';

import { TeamRepository } from './team.repository';
import { TeamMemberRepository } from './team-member.repository';
import { TeamMemberService } from './team-member.service';
import { FirmMemberRepository } from './firm-member.repository';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

/**
 * Phase 4 — Enterprise & Collaboration. Same admin-client reasoning as
 * team.factory.ts and firm-member.factory.ts: team_members has no
 * client-writable RLS policy, so every write here goes through the
 * admin client, gated by TeamMemberService's own requireFirmRole()
 * checks instead.
 */
export function createTeamMemberService(currentUser: AuthUser | null): TeamMemberService {
  const adminClient = createAdminClient();

  const teamRepository = new TeamRepository(adminClient);
  const teamMemberRepository = new TeamMemberRepository(adminClient);
  const firmMemberRepository = new FirmMemberRepository(adminClient);
  const auditLogRepository = new AuditLogRepository(adminClient);

  return new TeamMemberService(
    currentUser,
    teamRepository,
    teamMemberRepository,
    firmMemberRepository,
    auditLogRepository,
  );
}