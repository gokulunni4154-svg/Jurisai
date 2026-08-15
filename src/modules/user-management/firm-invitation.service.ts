// src/modules/user-management/firm-invitation.service.ts
//
// FIXED THIS SESSION: all three auditLogRepository writes
// (createInvitation, revokeInvitation, acceptFromList) previously
// called the inherited create() directly with actor_type: 'profile' —
// NOT a valid value of the real audit_log_actor_type enum
// ('user' | 'system' | 'webhook', confirmed via the real, pasted
// audit-log.repository.ts). This would fail TypeScript's type check
// against the real enum, and/or fail at the database level as an
// invalid enum value at runtime. Replaced with the repository's own
// purpose-built recordUserAction() wrapper (actor_type: 'user',
// confirmed correct for an authenticated-caller-initiated event),
// which also has a real resourceType/resourceId shape instead of the
// non-existent target_id column this file was previously writing to.
//
// FLAGGED / FIXED — session 55 (tsc pass): `NotFoundError` was imported
// but never thrown anywhere in this file (every error path here uses
// ValidationError/AuthorizationError/ConflictError instead) — dropped
// from the import. No other change.

import 'server-only';
import { randomBytes } from 'crypto';

import { BaseService } from '@/core/services/base.service';
import type { AuthUser, FirmRole } from '@/core/auth/types';
import { AuthorizationError, ConflictError, ValidationError } from '@/core/errors/app-error';
import { clientEnv } from '@/core/config/env';

import { FirmInvitationRepository } from './firm-invitation.repository';
import { FirmMemberRepository } from './firm-member.repository';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import type { AuthUserRepository } from './auth-user.repository';
import type { FirmRepository } from '@/modules/billing/firm.repository';
import type { ProfileRepository } from '@/modules/profiles/profile.repository';

/**
 * NEW — My Invitations task, this session. Enriched shape returned by
 * listPendingForCurrentUser() below: the raw FirmInvitationRow plus
 * firmName/invitedByName, resolved server-side so the (as-yet
 * nonexistent) Lawyer Terminal frontend consuming this has something
 * human-readable to render, rather than bare firm_id/invited_by UUIDs.
 * Neither field existed on this method's return type before this
 * session -- confirmed via full-repo search that GET
 * /api/invitations/firm/pending (this method's only route caller) had
 * zero frontend consumers anywhere in the project prior to this task.
 */
export interface PendingFirmInvitation {
  readonly id: string;
  readonly firm_id: string;
  readonly firmName: string;
  readonly email: string;
  readonly role: FirmRole;
  readonly status: string;
  readonly invited_by: string;
  readonly invitedByName: string | null;
  readonly expires_at: string;
  readonly created_at: string;
}

const INVITATION_EXPIRY_DAYS = 7;

const ALLOWED_INVITE_ROLES: readonly FirmRole[] = ['owner', 'admin', 'employee', 'lawyer'];

interface CreateFirmInvitationInput {
  readonly firmId: string;
  readonly email: string;
  readonly role: FirmRole;
}

/**
 * FIXED THIS SESSION: previously read `process.env.NEXT_PUBLIC_APP_URL`
 * directly, flagged as an unconfirmed new requirement since no prior
 * module in this project built an absolute app URL server-side.
 * `auth.service.ts` (pasted in full this session) confirms the real
 * convention: `clientEnv.NEXT_PUBLIC_APP_URL` from
 * `@/core/config/env`, already used by `requestPasswordReset()` for the
 * exact same kind of link-building. Corrected to match rather than
 * remaining a standalone raw `process.env` read.
 */
function resolveAppUrl(): string {
  return clientEnv.NEXT_PUBLIC_APP_URL;
}

/**
 * FirmInvitationService
 * ----------------------
 * Phase 4 — Enterprise & Collaboration, Invitation System.
 *
 * Constructed with FirmInvitationRepository (this feature's own table),
 * FirmMemberRepository (needed to resolve the caller's FirmRole for
 * requireFirmRole() -- same pattern TeamService already establishes,
 * per base.service.ts's own doc comment on requireFirmRole()),
 * AuditLogRepository (every membership-changing operation in this
 * project writes an audit entry -- see firm.factory.ts's own comment on
 * why FirmService needed one), and AuthUserRepository (Decision #2's
 * email-to-existing-user resolution, via its findIdByEmail() method --
 * see that method's own doc comment for why this couldn't live on
 * ProfileRepository: profiles has no email column at all).
 */
export class FirmInvitationService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly firmInvitationRepository: FirmInvitationRepository,
    private readonly firmMemberRepository: FirmMemberRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly authUserRepository: AuthUserRepository,
    // NEW — My Invitations task, this session. Both read-only, both
    // used only by listPendingForCurrentUser()'s enrichment below (see
    // that method's own doc comment). Neither participates in any
    // write path, so adding them doesn't touch this class's existing
    // authorization behavior anywhere else.
    private readonly firmRepository: FirmRepository,
    private readonly profileRepository: ProfileRepository,
  ) {
    super(currentUser);
  }

  /**
   * Resolves the caller's FirmRole within the given firm, or null if
   * they have no firm_members row there. Small private helper so every
   * public method below doesn't repeat the same two-line lookup before
   * calling requireFirmRole() -- not a new pattern, just avoiding
   * duplicating TeamService's own established call shape five times in
   * this file.
   */
  private async resolveCallerFirmRole(firmId: string, userId: string): Promise<FirmRole | null> {
    return this.firmMemberRepository.findByFirmAndProfile(firmId, userId);
  }

  private generateToken(): string {
    // 32 bytes of randomness, hex-encoded -- generated here, not read
    // back from a DB default, per the migration's own assumption D
    // (the service needs the raw value in hand to build the
    // /signup?invite=<token> URL it returns to the caller).
    return randomBytes(32).toString('hex');
  }

  /**
   * Creates a new firm invitation. Owner/admin only within the target
   * firm (Decision #7's role-selection implies the inviter already has
   * standing to assign roles -- same requirement addMember() enforces).
   *
   * Handles Decision #10 (re-invite re-issues) explicitly: if a pending
   * invitation already exists for this (firmId, normalized email), it
   * is revoked here before the new one is created, rather than relying
   * solely on the partial unique index to reject the insert -- this
   * keeps the "old one invalidated" half of Decision #10 an explicit,
   * auditable step rather than an implicit side effect of a constraint
   * violation.
   *
   * Decision #2's existing-profile check uses
   * authUserRepository.findIdByEmail() (backed by the
   * find_auth_user_id_by_email security-definer RPC). A found id is used
   * directly as profile_id -- it IS profiles.id, per the confirmed
   * handle_new_user() trigger, so no separate profile lookup step is
   * needed beyond this one call.
   */
  async createInvitation(input: CreateFirmInvitationInput): Promise<{
    invitation: NonNullable<Awaited<ReturnType<FirmInvitationRepository['findByToken']>>>;
    inviteUrl: string | null;
  }> {
    const user = this.requireAuthentication();

    if (!ALLOWED_INVITE_ROLES.includes(input.role)) {
      throw new ValidationError('Invalid firm role for invitation.', { role: input.role });
    }

    const callerFirmRole = await this.resolveCallerFirmRole(input.firmId, user.id);
    this.requireFirmRole(callerFirmRole, ['owner', 'admin']);

    const normalizedEmail = input.email.trim().toLowerCase();

    // Decision #10: invalidate any existing pending invite to this
    // email for this firm before issuing a new one.
    const existingPending = await this.firmInvitationRepository.findPendingByFirmAndEmail(
      input.firmId,
      normalizedEmail,
    );

    if (existingPending) {
      await this.firmInvitationRepository.update(existingPending.id, {
        status: 'revoked',
        revoked_at: new Date().toISOString(),
      });
    }

    // Decision #2: does this email match an existing user?
    const matchingProfileId = await this.authUserRepository.findIdByEmail(normalizedEmail);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const token = this.generateToken();

    const invitation = await this.firmInvitationRepository.create({
      firm_id: input.firmId,
      email: normalizedEmail,
      profile_id: matchingProfileId,
      role: input.role,
      token,
      status: 'pending',
      invited_by: user.id,
      expires_at: expiresAt.toISOString(),
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: input.firmId,
      action: 'firm_invitation.create',
      resourceType: 'firm_invitations',
      resourceId: invitation.id,
      metadata: {
        email: normalizedEmail,
        role: input.role,
        existingProfile: matchingProfileId !== null,
      },
    });

    // The token-link URL is only meaningful for the new-user path
    // (Decision #3) -- an existing-profile invite is actioned through
    // the in-app pending-list instead.
    const inviteUrl = matchingProfileId === null ? `${resolveAppUrl()}/signup?invite=${token}` : null;

    return { invitation, inviteUrl };
  }

  /**
   * Revokes a pending invitation. Owner/admin only, scoped to the
   * invitation's own firm (Decision #9).
   */
  async revokeInvitation(invitationId: string): Promise<void> {
    const user = this.requireAuthentication();

    const invitation = await this.firmInvitationRepository.findByIdOrThrow(invitationId);

    const callerFirmRole = await this.resolveCallerFirmRole(invitation.firm_id, user.id);
    this.requireFirmRole(callerFirmRole, ['owner', 'admin']);

    if (invitation.status !== 'pending') {
      throw new ConflictError('Only a pending invitation can be revoked.', {
        currentStatus: invitation.status,
      });
    }

    await this.firmInvitationRepository.update(invitationId, {
      status: 'revoked',
      revoked_at: new Date().toISOString(),
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: invitation.firm_id,
      action: 'firm_invitation.revoke',
      resourceType: 'firm_invitations',
      resourceId: invitationId,
    });
  }

  /**
   * Accepts a pending invitation via the IN-APP PENDING-LIST path
   * (Decision #3's second acceptance mechanism) -- this is the
   * existing-profile path only. The token-link path for new-user
   * invites is handled inside AuthService.signUp() directly
   * (Decision #13, completed this session), NOT here -- this method
   * requires an already-authenticated caller, which a brand-new sign-up
   * by definition is not yet.
   *
   * Enforces Decision #8 (7-day expiration, enforced at accept time)
   * explicitly here: an expired-but-still-'pending' row is rejected
   * and transitioned to 'expired' on the way out, rather than silently
   * accepted.
   *
   * FIXED THIS SESSION: previously flagged as no check for whether
   * `user` is ALREADY a firm_members row for this firm before the
   * create() call below. Now guarded via resolveCallerFirmRole(),
   * fixed together with team-invitation.service.ts's identical gap per
   * the continuation prompt's own note.
   */
  async acceptFromList(invitationId: string): Promise<void> {
    const user = this.requireAuthentication();

    const invitation = await this.firmInvitationRepository.findByIdOrThrow(invitationId);

    if (invitation.profile_id !== user.id) {
      throw new AuthorizationError('This invitation is not addressed to you.');
    }

    if (invitation.status !== 'pending') {
      throw new ConflictError('This invitation is no longer pending.', {
        currentStatus: invitation.status,
      });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      await this.firmInvitationRepository.update(invitationId, { status: 'expired' });
      throw new ConflictError('This invitation has expired.');
    }

    // Previously flagged, now fixed: reuses the same
    // resolveCallerFirmRole() helper createInvitation()/revokeInvitation()
    // already call, so this isn't a new dependency -- just the same
    // confirmed firmMemberRepository.findByFirmAndProfile() lookup,
    // used here to guard against a duplicate firm_members row rather
    // than to resolve a FirmRole for requireFirmRole().
    const existingMembership = await this.resolveCallerFirmRole(invitation.firm_id, user.id);

    if (existingMembership !== null) {
      throw new ConflictError('You are already a member of this firm.', {
        firmId: invitation.firm_id,
      });
    }

    await this.firmMemberRepository.create({
      firm_id: invitation.firm_id,
      profile_id: user.id,
      role: invitation.role,
    });

    await this.firmInvitationRepository.update(invitationId, {
      status: 'accepted',
      accepted_at: new Date().toISOString(),
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: invitation.firm_id,
      action: 'firm_invitation.accept',
      resourceType: 'firm_invitations',
      resourceId: invitationId,
      metadata: { role: invitation.role },
    });
  }

  /**
   * Lists every invitation (pending + historical) for a firm. Owner/
   * admin only -- see migration header, assumption H, for why this is
   * scoped narrower than firm-wide team-roster visibility.
   */
  async listForFirm(firmId: string) {
    const user = this.requireAuthentication();

    const callerFirmRole = await this.resolveCallerFirmRole(firmId, user.id);
    this.requireFirmRole(callerFirmRole, ['owner', 'admin']);

    return this.firmInvitationRepository.findByFirmId(firmId);
  }

  /**
   * Lists the current user's own pending invitations -- the in-app
   * pending-list read path (Decision #3).
   *
   * ENRICHED THIS SESSION (My Invitations task): the raw repository
   * rows carry firm_id/invited_by as bare UUIDs only -- fine for the
   * accept-path methods above, which never need to display anything,
   * but useless to a frontend rendering an actual invitations list.
   * Resolves firmName (firmRepository.findById) and invitedByName
   * (profileRepository.findById) per invitation, in parallel via
   * Promise.all.
   *
   * DELIBERATELY uses findById (returns null), not findByIdOrThrow,
   * for both lookups, and falls back to a placeholder string rather
   * than letting one bad row 500 the entire list -- firms.owner_id and
   * firm_invitations.invited_by both cascade-delete their respective
   * invitation rows (see this table's migration header, assumptions A
   * and C), so a dangling reference shouldn't be reachable in practice,
   * but a defensive fallback costs nothing and keeps one edge case from
   * taking down every other pending invitation in the response.
   */
  async listPendingForCurrentUser(): Promise<PendingFirmInvitation[]> {
    const user = this.requireAuthentication();

    const invitations = await this.firmInvitationRepository.findPendingByProfileId(user.id);

    return Promise.all(
      invitations.map(async (invitation) => {
        const [firm, inviter] = await Promise.all([
          this.firmRepository.findById(invitation.firm_id),
          this.profileRepository.findById(invitation.invited_by),
        ]);

        return {
          id: invitation.id,
          firm_id: invitation.firm_id,
          firmName: firm?.name ?? 'Unknown firm',
          email: invitation.email,
          role: invitation.role as FirmRole,
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