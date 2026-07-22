// src/modules/user-management/team.factory.ts

import { createAdminClient } from '@/core/supabase/admin';
import type { AuthUser } from '@/core/auth/types';

import { TeamRepository } from './team.repository';
import { TeamService } from './team.service';
import { FirmMemberRepository } from './firm-member.repository';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

/**
 * Phase 4 — Enterprise & Collaboration. Constructed against
 * createAdminClient(), same reasoning firm.factory.ts and
 * firm-member.factory.ts both already establish: teams has no
 * client-writable RLS policy (see that table's own migration header —
 * "No insert/update/delete policy for authenticated: team creation and
 * deletion are service-layer, owner/admin-only operations"), so every
 * write here must go through the admin client regardless of which user
 * is acting. TeamService's own requireFirmRole()-based checks are what
 * stand in for RLS on this table's write path — same division of
 * responsibility firm-member.factory.ts already establishes.
 */
export function createTeamService(currentUser: AuthUser | null): TeamService {
  const adminClient = createAdminClient();

  const teamRepository = new TeamRepository(adminClient);
  const firmMemberRepository = new FirmMemberRepository(adminClient);
  const auditLogRepository = new AuditLogRepository(adminClient);

  return new TeamService(currentUser, teamRepository, firmMemberRepository, auditLogRepository);
}