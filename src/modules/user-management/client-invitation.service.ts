// src/modules/user-management/client-invitation.service.ts

import 'server-only';
import { randomBytes } from 'crypto';

import { BaseService } from '@/core/services/base.service';
import type { AuthUser } from '@/core/auth/types';
import { ConflictError } from '@/core/errors/app-error';
import { clientEnv } from '@/core/config/env';

import { ClientInvitationRepository } from './client-invitation.repository';
import { ClientRepository } from './client.repository';
import { FirmMemberRepository } from './firm-member.repository';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

const INVITATION_EXPIRY_DAYS = 7;

/**
 * FLAGGED, JUDGMENT CALL: same resolveAppUrl() pattern
 * firm-invitation.service.ts's own comment confirms against
 * auth.service.ts's real requestPasswordReset() usage
 * (clientEnv.NEXT_PUBLIC_APP_URL, not a raw process.env read). Reused
 * directly rather than duplicated logic diverging over time.
 */
function resolveAppUrl(): string {
  return clientEnv.NEXT_PUBLIC_APP_URL;
}

/**
 * CONFIRMED THIS SESSION — `/client-signup` is the final, decided path
 * segment for the client-portal signup route, confirmed by Gokul
 * directly (previously this file's own best-guess naming, flagged as
 * unconfirmed against real source). The actual frontend route/page at
 * this path has not been built yet — that remains open — but the path
 * itself is no longer a guess and should not be second-guessed further.
 */
const CLIENT_SIGNUP_PATH = '/client-signup';

interface CreateClientInvitationInput {
  readonly clientId: string;
}

/**
 * ClientInvitationService
 * ----------------------
 * Client Management. Structural mirror of FirmInvitationService,
 * scoped down to match client_invitations' real, smaller shape (see
 * client-invitation.repository.ts's own doc comment) and this table's
 * TOKEN-LINK-ONLY acceptance path (migration deviation #2 — no
 * acceptFromList()-equivalent exists here, and none should be added
 * unless that product decision changes).
 *
 * Constructed with ClientInvitationRepository (this feature's own
 * table), ClientRepository (to resolve the target client's row — id,
 * firm_id — and confirm it exists via findByIdOrThrow()'s built-in
 * NotFoundError, same role FirmMemberRepository plays for
 * FirmInvitationService's authorization resolution), FirmMemberRepository
 * (to resolve the CALLER's FirmRole within the client's firm, for
 * requireFirmRole() — same pattern, different subject), and
 * AuditLogRepository (every membership/invitation-changing operation in
 * this project writes an audit entry).
 *
 * Deliberately has NO AuthUserRepository dependency, unlike
 * FirmInvitationService — that repository exists solely to resolve
 * Decision #2's "does this email already match an existing user"
 * check, which has no client analog: a client_invitations row always
 * targets an existing `clients` row (deviation #1), and per deviation
 * #2 a client never has a pre-existing profile before their invite —
 * so there is no existing-profile branch to resolve here at all.
 *
 * Acceptance (redeeming the token, creating the client's profiles row,
 * setting clients.profile_id) is NOT implemented in this class —
 * belongs on AuthService#signUpAsClient(), confirmed and built this
 * session, mirroring how firm_invitations' own token-link acceptance
 * lives inside AuthService.signUp(), not FirmInvitationService.
 */
export class ClientInvitationService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly clientInvitationRepository: ClientInvitationRepository,
    private readonly clientRepository: ClientRepository,
    private readonly firmMemberRepository: FirmMemberRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {
    super(currentUser);
  }

  /**
   * Same small private helper firm-invitation.service.ts's own
   * resolveCallerFirmRole() is, reused here rather than duplicating
   * FirmMemberRepository's call shape three times in this file.
   */
  private async resolveCallerFirmRole(firmId: string, userId: string) {
    return this.firmMemberRepository.findByFirmAndProfile(firmId, userId);
  }

  private generateToken(): string {
    // Same 32-byte hex convention as
    // FirmInvitationService#generateToken() — generated here, not read
    // back from a DB default, so the raw value is in hand to build the
    // signup URL returned to the caller.
    return randomBytes(32).toString('hex');
  }

  /**
   * Creates a new client-portal invitation for an EXISTING clients row.
   * Owner/admin only, scoped to the client's own firm (mirrors
   * FirmInvitationService#createInvitation()'s owner/admin gate).
   *
   * Loads the target client via findByIdOrThrow() first — this both
   * confirms the client exists (NotFoundError otherwise, for free) and
   * resolves firmId from the row itself, rather than trusting a
   * separately-supplied firmId from caller input. This mirrors the
   * authorization-safety reasoning
   * team-invitation.service.ts's class doc comment gives for resolving
   * firm_id from the row rather than the URL/body — a caller cannot
   * invite a client into a firm they merely claim the client belongs
   * to.
   *
   * Handles re-invite the same explicit way
   * FirmInvitationService#createInvitation() handles Decision #10: any
   * existing pending invitation for this client is revoked first, as
   * an auditable step, before the new one is created — backstopped by
   * client_invitations_client_pending_unique either way. Mirrors the
   * migration's own flagged, not-independently-confirmed assumption
   * that re-invite should re-issue; correct this method if that
   * assumption turns out wrong.
   *
   * No email-match / existing-profile branch (Decision #2's client
   * analog) — see this class's own doc comment for why that check has
   * no equivalent here. The invite URL is therefore ALWAYS returned
   * (never null), unlike FirmInvitationService#createInvitation()'s
   * conditional inviteUrl.
   */
  async createInvitation(input: CreateClientInvitationInput): Promise<{
    invitation: NonNullable<Awaited<ReturnType<ClientInvitationRepository['findByToken']>>>;
    inviteUrl: string;
  }> {
    const user = this.requireAuthentication();

    const client = await this.clientRepository.findByIdOrThrow(input.clientId);

    const callerFirmRole = await this.resolveCallerFirmRole(client.firm_id, user.id);
    this.requireFirmRole(callerFirmRole, ['owner', 'admin']);

    const existingPending = await this.clientInvitationRepository.findPendingByClientId(client.id);

    if (existingPending) {
      await this.clientInvitationRepository.update(existingPending.id, {
        status: 'revoked',
        revoked_at: new Date().toISOString(),
      });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const token = this.generateToken();

    const invitation = await this.clientInvitationRepository.create({
      client_id: client.id,
      firm_id: client.firm_id,
      token,
      status: 'pending',
      invited_by: user.id,
      expires_at: expiresAt.toISOString(),
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: client.firm_id,
      action: 'client_invitation.create',
      resourceType: 'client_invitations',
      resourceId: invitation.id,
      metadata: {
        clientId: client.id,
      },
    });

    const inviteUrl = `${resolveAppUrl()}${CLIENT_SIGNUP_PATH}?invite=${token}`;

    return { invitation, inviteUrl };
  }

  /**
   * Revokes a pending client invitation. Owner/admin only, scoped to
   * the invitation's own firm — direct mirror of
   * FirmInvitationService#revokeInvitation(), same
   * "resolve firm from the row, not caller input" reasoning.
   */
  async revokeInvitation(invitationId: string): Promise<void> {
    const user = this.requireAuthentication();

    const invitation = await this.clientInvitationRepository.findByIdOrThrow(invitationId);

    const callerFirmRole = await this.resolveCallerFirmRole(invitation.firm_id, user.id);
    this.requireFirmRole(callerFirmRole, ['owner', 'admin']);

    if (invitation.status !== 'pending') {
      throw new ConflictError('Only a pending invitation can be revoked.', {
        currentStatus: invitation.status,
      });
    }

    await this.clientInvitationRepository.update(invitationId, {
      status: 'revoked',
      revoked_at: new Date().toISOString(),
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: invitation.firm_id,
      action: 'client_invitation.revoke',
      resourceType: 'client_invitations',
      resourceId: invitationId,
      metadata: { clientId: invitation.client_id },
    });
  }

  /**
   * Lists every client invitation (pending + historical) for a firm.
   * Owner/admin only — direct mirror of
   * FirmInvitationService#listForFirm().
   */
  async listForFirm(firmId: string) {
    const user = this.requireAuthentication();

    const callerFirmRole = await this.resolveCallerFirmRole(firmId, user.id);
    this.requireFirmRole(callerFirmRole, ['owner', 'admin']);

    return this.clientInvitationRepository.findByFirmId(firmId);
  }

  // NOTE: no acceptInvitation()/acceptFromList()-equivalent method
  // exists on this class — see class doc comment. Acceptance belongs
  // on AuthService#signUpAsClient(), not here.
}