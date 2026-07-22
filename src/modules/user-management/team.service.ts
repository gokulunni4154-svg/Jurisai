// src/modules/user-management/team.service.ts

import { BaseService } from '@/core/services/base.service';
import { AuthorizationError } from '@/core/errors/app-error';
import type { AuthUser, FirmRole } from '@/core/auth/types';
import type { Database } from '@/core/supabase/database.types';
import type { TeamRepository } from './team.repository';
import type { FirmMemberRepository } from './firm-member.repository';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

type TeamRow = Database['public']['Tables']['teams']['Row'];

/**
 * FirmRoles permitted to manage teams (create / delete) for a firm.
 * Same MANAGE_ROLES set FirmMemberService already uses — no separate
 * team-management role exists (decision #4: teams have no role concept
 * of their own; authorization is entirely firm-level).
 */
const MANAGE_ROLES: readonly FirmRole[] = ['owner', 'admin'];

/**
 * TeamService
 * -----------
 * Phase 4 — Enterprise & Collaboration. Wraps TeamRepository with the
 * authorization and audit-logging FirmMemberService's own class doc
 * comment establishes as this project's Repository/Service split.
 *
 * Teams have no role of their own (decision #4) — there is no
 * "team-level FirmRole" to resolve here. Authorization for create/delete
 * is entirely firm-level: the caller's FirmRole within the team's
 * PARENT FIRM, resolved via FirmMemberRepository (already built, Admin
 * Tooling module) and passed into BaseService's requireFirmRole(), same
 * pattern FirmMemberService#requireManageAccess() establishes — this
 * Service depends on FirmMemberRepository the same way for the
 * identical reason.
 */
export class TeamService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly teamRepository: TeamRepository,
    private readonly firmMemberRepository: FirmMemberRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {
    super(currentUser);
  }

  /**
   * Resolves the caller's FirmRole for the given firm and asserts it's
   * one of MANAGE_ROLES. Structural mirror of
   * FirmMemberService#requireManageAccess() — same gate, same
   * reasoning, reused here because team creation/deletion is
   * firm-owner/admin-only (decision #5), not gated by any
   * team-specific role (none exists).
   */
  private async requireManageAccess(firmId: string): Promise<AuthUser> {
    const user = this.requireAuthentication();
    const callerRole = await this.firmMemberRepository.findByFirmAndProfile(firmId, user.id);
    return this.requireFirmRole(callerRole, MANAGE_ROLES);
  }

  /**
   * Creates a new team within a firm. Owner/admin only.
   */
  async createTeam(firmId: string, name: string): Promise<TeamRow> {
    const user = await this.requireManageAccess(firmId);

    const team = await this.teamRepository.create({
      firm_id: firmId,
      name,
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId,
      action: 'team.create',
      resourceType: 'team',
      resourceId: team.id,
      metadata: { name },
    });

    return team;
  }

  /**
   * Deletes a team. Owner/admin only. Resolves the team's own firm_id
   * first (not passed by the caller) — FLAGGED, NEW DECISION: this
   * means a caller invoking deleteTeam(teamId) does not need to
   * separately know which firm the team belongs to. Mirrors the route
   * shape a single :teamId param implies (same as firm-member routes
   * taking :id/:profileId without a separate firmId param when a
   * resource id already implies it).
   */
  async deleteTeam(teamId: string): Promise<void> {
    const team = await this.teamRepository.findByIdOrThrow(teamId);

    const user = await this.requireManageAccess(team.firm_id);

    await this.teamRepository.delete(team.id);

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: team.firm_id,
      action: 'team.delete',
      resourceType: 'team',
      resourceId: team.id,
      metadata: { name: team.name },
    });
  }

  /**
   * Returns every team in a firm. Any authenticated member of the firm
   * may list it — mirrors teams_select_firm_member RLS's own firm-wide
   * reasoning (decision #7). Uses AuthorizationError for a non-member
   * caller, matching FirmMemberService#listMembers()'s own choice for
   * the identical "authenticated but not a member of this firm" case.
   */
  async listTeams(firmId: string): Promise<TeamRow[]> {
    const user = this.requireAuthentication();
    const callerRole = await this.firmMemberRepository.findByFirmAndProfile(firmId, user.id);

    if (!callerRole) {
      throw new AuthorizationError('You are not a member of this firm.', { firmId });
    }

    return this.teamRepository.findByFirmId(firmId);
  }
}