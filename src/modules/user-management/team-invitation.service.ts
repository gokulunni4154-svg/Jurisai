// src/modules/user-management/team-invitation.service.ts

import 'server-only';

import { BaseService } from '@/core/services/base.service';
import type { AuthUser, FirmRole } from '@/core/auth/types';
import { AuthorizationError, ConflictError, ValidationError } from '@/core/errors/app-error';

import { TeamInvitationRepository } from './team-invitation.repository';
import { TeamRepository } from './team.repository';
import { FirmMemberRepository } from './firm-member.repository';
import type { TeamMemberRepository } from './team-member.repository';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import type { FirmRepository } from '@/modules/billing/firm.repository';
import type { ProfileRepository } from '@/modules/profiles/profile.repository';

const INVITATION_EXPIRY_DAYS = 7;

interface CreateTeamInvitationInput {
  readonly teamId: string;
  readonly profileId: string;
}

/**
 * NEW — My Invitations task, this session. Enriched shape returned by
 * listPendingForCurrentUser() below, mirroring
 * PendingFirmInvitation (firm-invitation.service.ts) — same reasoning:
 * a frontend rendering this list needs teamName/firmName/
 * invitedByName, not bare UUIDs. team_invitations has no
 * email/role/token columns at all (Decisions #11/#12, see class doc
 * comment), so this shape is narrower than PendingFirmInvitation by
 * construction, not by omission.
 */
export interface PendingTeamInvitation {
  readonly id: string;
  readonly team_id: string;
  readonly teamName: string;
  readonly firm_id: string;
  readonly firmName: string;
  readonly status: string;
  readonly invited_by: string;
  readonly invitedByName: string | null;
  readonly expires_at: string;
  readonly created_at: string;
}

/**
 * TeamInvitationService
 * ----------------------
 * Phase 4 — Enterprise & Collaboration, Invitation System.
 *
 * Structural mirror of FirmInvitationService, with three real
 * differences forced by Decisions #11/#12, not stylistic choices:
 *
 *   1. No email/token anywhere -- every method takes a `profileId`
 *      directly, since a team invitation can only ever target an
 *      existing firm member (Decision #11/#12). There is no new-user
 *      path to support, so there's nothing for AuthUserRepository or a
 *      token to do here -- this class deliberately has no dependency
 *      on it, unlike FirmInvitationService.
 *   2. Authorization is resolved against the team's FIRM role, not a
 *      team-specific one. team_invitations has no firm_id column of
 *      its own -- only team_id -- so every method here first resolves
 *      teamId -> firm_id via TeamRepository#findByIdOrThrow() (teams
 *      rows carry firm_id, confirmed via team.repository.ts's real
 *      findByFirmId() query this session), THEN resolves the caller's
 *      FirmRole against that firm_id, THEN calls requireFirmRole().
 *      This order matters: accepting a firmId as an input parameter
 *      instead of deriving it from the team row would let a caller who
 *      is owner/admin of one firm supply that firm's id while acting on
 *      a team that actually belongs to a different firm -- an
 *      authorization bypass, not a style choice. Every method below
 *      derives firm_id from the real team row, never from caller input.
 *      This matches the already-confirmed pattern of TeamService itself
 *      resolving FirmRole via FirmMemberRepository before calling
 *      requireFirmRole() (see base.service.ts's own doc comment,
 *      confirmed in the prior session).
 *   3. Decision #11's precondition (target must already be a firm
 *      member of the SAME firm the team belongs to) is checked
 *      explicitly in createInvitation() below, via the same
 *      FirmMemberRepository#findByFirmAndProfile() FirmInvitationService
 *      already uses -- not re-derived, not assumed, the identical
 *      confirmed method.
 *
 * Constructed with TeamInvitationRepository (this feature's own table),
 * TeamRepository (for the team -> firm_id resolution above),
 * FirmMemberRepository (both for firm-role resolution and Decision #11's
 * precondition check), TeamMemberRepository (the accept-time write --
 * see this class's own note on that dependency below), and
 * AuditLogRepository (same project-wide convention every other service
 * here follows).
 *
 * FLAGGED / FIXED — session 55 (tsc pass): all three audit writes below
 * (createInvitation, revokeInvitation, acceptInvitation) previously
 * called the inherited auditLogRepository.create() directly with
 * `actor_type: 'profile'` (not a valid audit_log_actor_type value —
 * confirmed real enum is 'user' | 'system' | 'webhook') and a
 * `target_id` field that, per firm-invitation.service.ts's own header
 * comment (which already fixed the identical pattern there), is NOT a
 * real column on audit_log at all — the real columns are
 * resource_type/resource_id. Switched to the repository's
 * recordUserAction() wrapper, matching FirmInvitationService's already-
 * fixed convention exactly: actor_type is implicitly 'user' (correct
 * for an authenticated-caller-initiated event), resourceType/resourceId
 * replace the non-existent target_id. Not an independent guess — this
 * mirrors a fix already proven correct in the sibling file this same
 * session.
 */
export class TeamInvitationService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly teamInvitationRepository: TeamInvitationRepository,
    private readonly teamRepository: TeamRepository,
    private readonly firmMemberRepository: FirmMemberRepository,
    private readonly teamMemberRepository: TeamMemberRepository,
    private readonly auditLogRepository: AuditLogRepository,
    // NEW — My Invitations task, this session. Read-only, used only by
    // listPendingForCurrentUser()'s enrichment below — see that
    // method's own doc comment and PendingTeamInvitation's. Same
    // reasoning as FirmInvitationService's identical addition.
    private readonly firmRepository: FirmRepository,
    private readonly profileRepository: ProfileRepository,
  ) {
    super(currentUser);
  }

  /**
   * Resolves a team's real firm_id from the team row itself -- never
   * accepted as caller input, see this class's own doc comment above
   * for why that distinction is an authorization requirement, not a
   * style preference.
   */
  private async resolveTeamFirmId(teamId: string): Promise<string> {
    const team = await this.teamRepository.findByIdOrThrow(teamId);
    return team.firm_id;
  }

  private async resolveCallerFirmRole(firmId: string, userId: string): Promise<FirmRole | null> {
    return this.firmMemberRepository.findByFirmAndProfile(firmId, userId);
  }

  /**
   * Creates a new team invitation. Owner/admin of the team's OWNING
   * FIRM only -- resolved via resolveTeamFirmId(), not caller input
   * (see class doc comment).
   *
   * Enforces Decision #11 explicitly: the target profile must already
   * be a member of that same firm, via the same
   * FirmMemberRepository#findByFirmAndProfile() FirmInvitationService
   * uses -- if that returns null, this throws rather than creating an
   * invitation that could never be legitimately accepted (Decision #12:
   * there is no new-user path here to fall back to).
   *
   * Handles re-invite the same way FirmInvitationService#createInvitation()
   * does: an existing pending invitation for this (teamId, profileId) is
   * revoked before the new one is created, keeping "old one invalidated"
   * an explicit auditable step rather than an implicit side effect of
   * the partial unique index.
   */
  async createInvitation(input: CreateTeamInvitationInput): Promise<{
    invitation: NonNullable<Awaited<ReturnType<TeamInvitationRepository['findPendingByTeamAndProfile']>>>;
  }> {
    const user = this.requireAuthentication();

    const firmId = await this.resolveTeamFirmId(input.teamId);
    const callerFirmRole = await this.resolveCallerFirmRole(firmId, user.id);
    this.requireFirmRole(callerFirmRole, ['owner', 'admin']);

    // Decision #11: the target must already be a member of this firm.
    const targetFirmRole = await this.firmMemberRepository.findByFirmAndProfile(firmId, input.profileId);

    if (targetFirmRole === null) {
      throw new ValidationError(
        'Cannot invite a profile to this team: the profile is not a member of the team\'s firm.',
        { teamId: input.teamId, firmId, profileId: input.profileId },
      );
    }

    // Re-invite: invalidate any existing pending invite to this
    // profile for this team before issuing a new one (Decision #10's
    // firm-invitation behavior, applied identically here).
    const existingPending = await this.teamInvitationRepository.findPendingByTeamAndProfile(
      input.teamId,
      input.profileId,
    );

    if (existingPending) {
      await this.teamInvitationRepository.update(existingPending.id, {
        status: 'revoked',
        revoked_at: new Date().toISOString(),
      });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await this.teamInvitationRepository.create({
      team_id: input.teamId,
      profile_id: input.profileId,
      status: 'pending',
      invited_by: user.id,
      expires_at: expiresAt.toISOString(),
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId,
      action: 'team_invitation.create',
      resourceType: 'team_invitations',
      resourceId: invitation.id,
      metadata: { teamId: input.teamId, profileId: input.profileId },
    });

    return { invitation };
  }

  /**
   * Revokes a pending invitation. Owner/admin of the team's owning firm
   * only, resolved the same firm_id-derivation way as createInvitation().
   */
  async revokeInvitation(invitationId: string): Promise<void> {
    const user = this.requireAuthentication();

    const invitation = await this.teamInvitationRepository.findByIdOrThrow(invitationId);
    const firmId = await this.resolveTeamFirmId(invitation.team_id);

    const callerFirmRole = await this.resolveCallerFirmRole(firmId, user.id);
    this.requireFirmRole(callerFirmRole, ['owner', 'admin']);

    if (invitation.status !== 'pending') {
      throw new ConflictError('Only a pending invitation can be revoked.', {
        currentStatus: invitation.status,
      });
    }

    await this.teamInvitationRepository.update(invitationId, {
      status: 'revoked',
      revoked_at: new Date().toISOString(),
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId,
      action: 'team_invitation.revoke',
      resourceType: 'team_invitations',
      resourceId: invitationId,
      metadata: { teamId: invitation.team_id },
    });
  }

  /**
   * Accepts a pending invitation. This is the ONLY acceptance path that
   * can ever apply to a team invitation (Decision #12 -- no token/
   * new-user path exists for teams at all), unlike FirmInvitationService
   * which has two.
   *
   * Write step uses teamMemberRepository.create() -- inherited
   * BaseRepository behavior, now confirmed directly against real
   * team-member.repository.ts source this session (it extends
   * BaseRepository<'team_members'> plainly, no override), rather than
   * merely assumed as it was before this session's paste.
   *
   * FIXED THIS SESSION, together with FirmInvitationService#acceptFromList()'s
   * identical gap: no check for whether `user` is ALREADY a
   * team_members row for this team before the create() call below.
   * Guarded via teamMemberRepository.findRowByTeamAndProfile() --
   * confirmed against real team-member.repository.ts source this
   * session (open item #3, now closed): that method exists exactly for
   * this purpose, per its own doc comment ("exists purely for delete()'s
   * id requirement" -- this is the second real use of it, an existence
   * check, not a delete-id lookup, but the same method serves both).
   *
   * FLAGGED / FIXED — session 55: audit write below switched to
   * recordUserAction(), same class-level fix as createInvitation()/
   * revokeInvitation() above. NOTE: unlike those two, this method never
   * resolves firmId (acceptInvitation() only has invitation.team_id in
   * scope, and resolving firmId would mean an extra
   * teamRepository.findByIdOrThrow() call solely for audit metadata) —
   * recordUserAction()'s firmId parameter is optional elsewhere in this
   * project (e.g. notification.service.ts's calls omit it too), so it's
   * left out here rather than adding a new DB round-trip just to
   * populate an optional audit field. Revisit if firmId on this
   * specific audit entry turns out to matter.
   */
  async acceptInvitation(invitationId: string): Promise<void> {
    const user = this.requireAuthentication();

    const invitation = await this.teamInvitationRepository.findByIdOrThrow(invitationId);

    if (invitation.profile_id !== user.id) {
      throw new AuthorizationError('This invitation is not addressed to you.');
    }

    if (invitation.status !== 'pending') {
      throw new ConflictError('This invitation is no longer pending.', {
        currentStatus: invitation.status,
      });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      await this.teamInvitationRepository.update(invitationId, { status: 'expired' });
      throw new ConflictError('This invitation has expired.');
    }

    // CORRECTED against real team-member.repository.ts source (this
    // session): the method is findRowByTeamAndProfile(), not
    // findByTeamAndProfile() as guessed when this check was first
    // added -- table has no role column (decision #4), so this returns
    // the full TeamMemberRow (or null), not a role value. Same
    // .maybeSingle()-backed existence check either way.
    const existingMembership = await this.teamMemberRepository.findRowByTeamAndProfile(
      invitation.team_id,
      user.id,
    );

    if (existingMembership !== null) {
      throw new ConflictError('You are already a member of this team.', {
        teamId: invitation.team_id,
      });
    }

    await this.teamMemberRepository.create({
      team_id: invitation.team_id,
      profile_id: user.id,
    });

    await this.teamInvitationRepository.update(invitationId, {
      status: 'accepted',
      accepted_at: new Date().toISOString(),
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      action: 'team_invitation.accept',
      resourceType: 'team_invitations',
      resourceId: invitationId,
      metadata: { teamId: invitation.team_id },
    });
  }

  /**
   * Lists every invitation (pending + historical) for a team. Owner/
   * admin of the team's owning firm only -- same reasoning as
   * FirmInvitationService#listForFirm().
   */
  async listForTeam(teamId: string) {
    const user = this.requireAuthentication();

    const firmId = await this.resolveTeamFirmId(teamId);
    const callerFirmRole = await this.resolveCallerFirmRole(firmId, user.id);
    this.requireFirmRole(callerFirmRole, ['owner', 'admin']);

    return this.teamInvitationRepository.findByTeamId(teamId);
  }

  /**
   * Lists the current user's own pending team invitations.
   *
   * ENRICHED THIS SESSION (My Invitations task) — same reasoning as
   * FirmInvitationService#listPendingForCurrentUser()'s identical
   * change: raw rows carry only team_id/invited_by as bare UUIDs.
   * Resolves teamName (via resolveTeamFirmId()'s own teamRepository,
   * which also yields firm_id for firmName), and invitedByName, per
   * invitation, in parallel via Promise.all. Same defensive
   * findById-with-fallback posture, same reasoning: team_invitations.
   * team_id/invited_by both cascade-delete (migration header,
   * assumptions A/C — applied identically to team_invitations,
   * confirmed same migration file), so a dangling reference shouldn't
   * be reachable in practice, but the fallback costs nothing.
   */
  async listPendingForCurrentUser(): Promise<PendingTeamInvitation[]> {
    const user = this.requireAuthentication();

    const invitations = await this.teamInvitationRepository.findPendingByProfileId(user.id);

    return Promise.all(
      invitations.map(async (invitation) => {
        const team = await this.teamRepository.findById(invitation.team_id);

        const [firm, inviter] = await Promise.all([
          team ? this.firmRepository.findById(team.firm_id) : Promise.resolve(null),
          this.profileRepository.findById(invitation.invited_by),
        ]);

        return {
          id: invitation.id,
          team_id: invitation.team_id,
          teamName: team?.name ?? 'Unknown team',
          firm_id: team?.firm_id ?? '',
          firmName: firm?.name ?? 'Unknown firm',
          status: invitation.status,
          invited_by: invitation.invited_by,
          invitedByName: inviter?.full_name ?? null,
          expires_at: invitation.expires_at,
          created_at: invitation.created_at,
        };
      }),
    );
  }
}