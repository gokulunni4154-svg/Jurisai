// src/modules/user-management/firm-member.service.ts

import { BaseService } from '@/core/services/base.service';
import { AuthorizationError, ConflictError, NotFoundError } from '@/core/errors/app-error';
import type { AuthUser, FirmRole } from '@/core/auth/types';
import type { Database } from '@/core/supabase/database.types';
import type { FirmMemberRepository } from './firm-member.repository';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

type FirmMemberRow = Database['public']['Tables']['firm_members']['Row'];

/**
 * FirmRoles permitted to manage membership (add / change role / remove)
 * for a firm. Plain 'employee'/'lawyer' FirmRoles may still read the
 * roster (see listMembers()) but not mutate it.
 */
const MANAGE_ROLES: readonly FirmRole[] = ['owner', 'admin'];

/**
 * FirmMemberService
 * -------------------
 * NEW, Phase 4 — Enterprise & Collaboration. Wraps FirmMemberRepository
 * with the authorization and business rules that repository's own doc
 * comment deliberately left out — its `create()`/`update()`/`delete()`
 * (inherited from BaseRepository) are the raw read/write surface; this
 * Service is what layers "is this caller allowed to do this" and audit
 * logging on top, matching every other module's Repository/Service split
 * in this project.
 *
 * Product decisions this session, both carried in from Phase 4 scoping,
 * not re-litigated here:
 *   - Direct-add membership: no invitation/accept step. An owner or admin
 *     adds a member directly by profileId.
 *   - Multi-firm: a profile may be a MEMBER of several firms, but OWN at
 *     most one. Ownership-uniqueness is firm.service.ts's concern (its
 *     amended createFirm(), this session) — this Service does not
 *     re-check it; a profile being added here as a member of a second,
 *     third, etc. firm is an expected, valid state, not a conflict.
 *
 * FLAGGED, NEW DECISION — last-owner protection: changeRole() and
 * removeMember() both reject an operation that would leave a firm with
 * zero 'owner'-role firm_members rows. No product requirement was given
 * for this explicitly, but allowing that would recreate exactly the seam
 * 20260802000001_create_firm_members_table.sql's own migration assumption
 * #5 already flagged as undesirable (a firm with no enforced owner) —
 * except reachable through membership management instead of firm
 * creation. Enforced here via an extra read (counting current
 * 'owner'-role rows before allowing a demotion/removal away from
 * 'owner'), not a database constraint — none exists for this.
 */
export class FirmMemberService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly firmMemberRepository: FirmMemberRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {
    super(currentUser);
  }

  /**
   * Resolves the caller's own FirmRole for the given firm, then asserts
   * it's one of MANAGE_ROLES. Follows BaseService#requireVerified()'s
   * established pattern: the caller-specific data (FirmRole) is fetched
   * here — this Service has FirmMemberRepository, BaseService doesn't —
   * and passed into requireFirmRole(), not resolved inside BaseService
   * itself.
   */
  private async requireManageAccess(firmId: string): Promise<AuthUser> {
    const user = this.requireAuthentication();
    const callerRole = await this.firmMemberRepository.findByFirmAndProfile(firmId, user.id);
    return this.requireFirmRole(callerRole, MANAGE_ROLES);
  }

  /**
   * Adds a profile to a firm with the given role. Direct add, no
   * invitation step (product decision, this session — see class-level
   * doc comment).
   *
   * FLAGGED, NEW DECISION: does not pre-check whether targetProfileId
   * already belongs to some OTHER firm — multi-firm membership is
   * supported (this session), so that's expected, not a conflict. The
   * firm_members table's own unique constraint on (firm_id, profile_id)
   * is what rejects a duplicate add to the SAME firm; that violation
   * surfaces as a DatabaseError from the repository layer, not a
   * pre-checked ConflictError here. Revisit if a friendlier pre-check
   * error is wanted.
   */
  async addMember(
    firmId: string,
    targetProfileId: string,
    role: FirmRole,
  ): Promise<FirmMemberRow> {
    const user = await this.requireManageAccess(firmId);

    const member = await this.firmMemberRepository.create({
      firm_id: firmId,
      profile_id: targetProfileId,
      role,
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId,
      action: 'firm.member.add',
      resourceType: 'firm_member',
      resourceId: member.id,
      metadata: { targetProfileId, role },
    });

    return member;
  }

  /**
   * Changes an existing member's role. See class-level doc comment for
   * the last-owner protection this method enforces.
   */
  async changeRole(
    firmId: string,
    targetProfileId: string,
    newRole: FirmRole,
  ): Promise<FirmMemberRow> {
    const user = await this.requireManageAccess(firmId);

    const target = await this.firmMemberRepository.findRowByFirmAndProfile(firmId, targetProfileId);

    if (!target) {
      throw new NotFoundError('firm_members', `${firmId}:${targetProfileId}`);
    }

    if (target.role === 'owner' && newRole !== 'owner') {
      await this.assertNotLastOwner(firmId, targetProfileId);
    }

    const updated = await this.firmMemberRepository.update(target.id, { role: newRole });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId,
      action: 'firm.member.role_change',
      resourceType: 'firm_member',
      resourceId: target.id,
      metadata: { targetProfileId, previousRole: target.role, newRole },
    });

    return updated;
  }

  /**
   * Removes a member from a firm. See class-level doc comment for the
   * last-owner protection this method enforces.
   */
  async removeMember(firmId: string, targetProfileId: string): Promise<void> {
    const user = await this.requireManageAccess(firmId);

    const target = await this.firmMemberRepository.findRowByFirmAndProfile(firmId, targetProfileId);

    if (!target) {
      throw new NotFoundError('firm_members', `${firmId}:${targetProfileId}`);
    }

    if (target.role === 'owner') {
      await this.assertNotLastOwner(firmId, targetProfileId);
    }

    await this.firmMemberRepository.delete(target.id);

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId,
      action: 'firm.member.remove',
      resourceType: 'firm_member',
      resourceId: target.id,
      metadata: { targetProfileId, removedRole: target.role },
    });
  }

  /**
   * Returns the full membership roster for a firm. Any authenticated
   * member of the firm may list it — mirrors
   * firm_members_select_same_firm RLS's own reasoning ("any member of a
   * firm may read the full member list") — deliberately NOT gated to
   * MANAGE_ROLES like the write operations above.
   */
  async listMembers(firmId: string): Promise<FirmMemberRow[]> {
    const user = this.requireAuthentication();
    const callerRole = await this.firmMemberRepository.findByFirmAndProfile(firmId, user.id);

    if (!callerRole) {
      throw new AuthorizationError('You are not a member of this firm.', { firmId });
    }

    return this.firmMemberRepository.findByFirmId(firmId);
  }

  /**
   * Shared last-owner-protection check for changeRole()/removeMember().
   * Throws if the firm currently has exactly one 'owner'-role row (i.e.
   * targetProfileId's own row, about to be demoted or removed, is the
   * only one). A real extra read (findByFirmId(), not a database
   * constraint) — see class-level doc comment.
   */
  private async assertNotLastOwner(firmId: string, targetProfileId: string): Promise<void> {
    const roster = await this.firmMemberRepository.findByFirmId(firmId);
    const ownerCount = roster.filter((m) => m.role === 'owner').length;

    if (ownerCount <= 1) {
      throw new ConflictError('A firm must have at least one owner.', {
        firmId,
        targetProfileId,
      });
    }
  }
}