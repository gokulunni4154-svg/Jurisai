// src/modules/user-management/firm-invitation.service.ts

import 'server-only';
import { randomBytes } from 'crypto';

import { BaseService } from '@/core/services/base.service';
import type { AuthUser, FirmRole } from '@/core/auth/types';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '@/core/errors/app-error';
import { clientEnv } from '@/core/config/env';

import { FirmInvitationRepository } from './firm-invitation.repository';
import { FirmMemberRepository } from './firm-member.repository';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import type { AuthUserRepository } from './auth-user.repository';

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

    await this.auditLogRepository.create({
      actor_id: user.id,
      actor_type: 'profile',
      action: 'firm_invitation.create',
      target_id: invitation.id,
      metadata: {
        firmId: input.firmId,
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

    await this.auditLogRepository.create({
      actor_id: user.id,
      actor_type: 'profile',
      action: 'firm_invitation.revoke',
      target_id: invitationId,
      metadata: { firmId: invitation.firm_id },
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

    await this.auditLogRepository.create({
      actor_id: user.id,
      actor_type: 'profile',
      action: 'firm_invitation.accept',
      target_id: invitationId,
      metadata: { firmId: invitation.firm_id, role: invitation.role },
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
   */
  async listPendingForCurrentUser() {
    const user = this.requireAuthentication();

    return this.firmInvitationRepository.findPendingByProfileId(user.id);
  }
}