// src/modules/user-management/team-member.service.ts

import { BaseService } from '@/core/services/base.service';
import { AuthorizationError, ConflictError, NotFoundError } from '@/core/errors/app-error';
import type { AuthUser, FirmRole } from '@/core/auth/types';
import type { Database } from '@/core/supabase/database.types';
import type { TeamRepository } from './team.repository';
import type { TeamMemberRepository } from './team-member.repository';
import type { FirmMemberRepository } from './firm-member.repository';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

type TeamMemberRow = Database['public']['Tables']['team_members']['Row'];

const MANAGE_ROLES: readonly FirmRole[] = ['owner', 'admin'];

/**
 * TeamMemberService
 * -------------------
 * Phase 4 — Enterprise & Collaboration. Structural mirror of
 * FirmMemberService, with two deliberate differences forced by the
 * teams migration's own decisions:
 *
 *   1. No role concept (decision #4) — addMember() takes no role
 *      parameter, and there is no changeRole() at all (nothing to
 *      change). No last-owner-style protection exists either, since
 *      that protection was specifically about roles.
 *   2. Authorization is entirely firm-level, not team-level — same
 *      reasoning TeamService's own class doc comment gives. Every
 *      write here resolves the team's PARENT FIRM first (via
 *      TeamRepository), then gates on the caller's FirmRole in that
 *      firm — never a team-specific role, since none exists.
 *
 * FLAGGED, NEW DECISION — addMember() enforces that targetProfileId
 * already holds a firm_members row for the team's firm before allowing
 * the team_members insert. This is the application-layer invariant the
 * teams migration's own assumption F named as deliberately NOT enforced
 * at the database level ("treated as an application-layer invariant...
 * not yet written") — this is that enforcement, now written. Uses
 * ConflictError, matching this project's existing convention for a
 * precondition violation that isn't "resource not found" and isn't a
 * raw authorization failure (same reasoning FirmMemberService's own
 * last-owner check uses ConflictError). Revisit the exact error class
 * if a real caller needs a more specific one — this is a new decision,
 * not sourced from precedent.
 */
export class TeamMemberService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly teamRepository: TeamRepository,
    private readonly teamMemberRepository: TeamMemberRepository,
    private readonly firmMemberRepository: FirmMemberRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {
    super(currentUser);
  }

  /**
   * Resolves the team's parent firm, then the caller's FirmRole within
   * it, then asserts MANAGE_ROLES. Structural mirror of
   * FirmMemberService#requireManageAccess() / TeamService's own private
   * method of the same name, extended one step to first resolve
   * teamId -> firm_id (FirmMemberService/TeamService both already have
   * firmId directly; this Service's callers only have teamId).
   */
  private async requireManageAccess(teamId: string): Promise<{ user: AuthUser; firmId: string }> {
    const team = await this.teamRepository.findByIdOrThrow(teamId);
    const user = this.requireAuthentication();
    const callerRole = await this.firmMemberRepository.findByFirmAndProfile(team.firm_id, user.id);
    const authorizedUser = this.requireFirmRole(callerRole, MANAGE_ROLES);

    return { user: authorizedUser, firmId: team.firm_id };
  }

  /**
   * Adds a profile to a team. Owner/admin (of the team's parent firm)
   * only. See class-level doc comment for the firm-membership
   * precondition this enforces.
   */
  async addMember(teamId: string, targetProfileId: string): Promise<TeamMemberRow> {
    const { user, firmId } = await this.requireManageAccess(teamId);

    const targetIsFirmMember = await this.firmMemberRepository.findByFirmAndProfile(
      firmId,
      targetProfileId,
    );

    if (!targetIsFirmMember) {
      throw new ConflictError(
        'A profile must be a member of the firm before joining one of its teams.',
        { teamId, firmId, targetProfileId },
      );
    }

    const member = await this.teamMemberRepository.create({
      team_id: teamId,
      profile_id: targetProfileId,
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId,
      action: 'team.member.add',
      resourceType: 'team_member',
      resourceId: member.id,
      metadata: { teamId, targetProfileId },
    });

    return member;
  }

  /**
   * Removes a profile from a team. Owner/admin (of the team's parent
   * firm) only.
   */
  async removeMember(teamId: string, targetProfileId: string): Promise<void> {
    const { user, firmId } = await this.requireManageAccess(teamId);

    const target = await this.teamMemberRepository.findRowByTeamAndProfile(teamId, targetProfileId);

    if (!target) {
      throw new NotFoundError('team_members', `${teamId}:${targetProfileId}`);
    }

    await this.teamMemberRepository.delete(target.id);

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId,
      action: 'team.member.remove',
      resourceType: 'team_member',
      resourceId: target.id,
      metadata: { teamId, targetProfileId },
    });
  }

  /**
   * Returns the full roster for a team. Any authenticated member of the
   * team's PARENT FIRM may list it — mirrors
   * team_members_select_firm_member RLS's own firm-wide reasoning
   * (decision #7), deliberately NOT scoped to "already on this team",
   * same as that policy.
   */
  async listMembers(teamId: string): Promise<TeamMemberRow[]> {
    const team = await this.teamRepository.findByIdOrThrow(teamId);
    const user = this.requireAuthentication();
    const callerRole = await this.firmMemberRepository.findByFirmAndProfile(team.firm_id, user.id);

    if (!callerRole) {
      throw new AuthorizationError('You are not a member of this firm.', { firmId: team.firm_id });
    }

    return this.teamMemberRepository.findByTeamId(teamId);
  }
}