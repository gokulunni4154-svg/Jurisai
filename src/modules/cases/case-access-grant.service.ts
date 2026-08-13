// src/modules/cases/case-access-grant.service.ts
//
// Split into its own Service, not folded into CaseService -- mirrors
// this project's real precedent of firm.service.ts / firm-member.service.ts
// being separate classes rather than one: grant issuance has its own
// authorization shape (team lead / firm admin / case owner, not "case
// owner" alone), its own audit actions, and its own dedicated repository
// (CaseAccessGrantRepository, admin-client-only -- see that file's
// header) distinct from CaseRepository's RLS-scoped client.
//
// UPDATED — Decision #60, confirmed: the case OWNER may always issue/
// revoke grants and list grants on their own case, regardless of
// firm/team role. Previously flagged: "case owner may always grant" was
// deliberately excluded, since the original confirmed decision named
// "team heads and firm admins" specifically. That gap is now closed.
// requireGrantManageAccess() was resigned to take the full CaseRow
// (not just firmId/teamId) so it can check ownership directly --
// issueGrant()/revokeGrant()/listGrantsForCase() all now fetch caseRow
// first and pass it in, rather than passing firmId/teamId separately.
//
// UPDATED AGAIN THIS SESSION — Client RLS scoping. Confirmed real
// finding: case_access_grants.grantee_id has no role distinction, so
// this mechanism already extends to clients once a client has a linked
// profile (via signUpAsClient()) -- no new schema/table needed. Two
// decisions made this session:
//   - Client-issued grants may be 'read_write', same as staff grants --
//     issueGrant() deliberately NOT restricted by grantee type. No
//     change was needed here since it already had no such restriction;
//     recorded here so this isn't mistaken for an oversight.
//   - Added listMyCases() -- the self-scoped "what cases do I have
//     access to" query a client-portal (or staff) dashboard needs.
//     findActiveGrantsForCase()/findActiveGrantForCaseAndProfile() are
//     both per-case; neither answers "all of my cases" across the
//     firm, which is the actual client-portal requirement.
//
// AMENDED, THIS SESSION — Case Timeline / Activity History. This file's
// own recordUserAction() calls (issueGrant/revokeGrant) were the ONLY
// confirmed audit_log writes anywhere in this project before this
// session's instrumentation pass -- see PROJECT_PROGRESS's own scoping
// discussion for that finding. Both calls now also pass `caseId`, so
// grant events actually show up on the case's own timeline
// (20260801000000_add_case_id_to_audit_log.sql), not just under
// firmId. No other behavior changed in this file.

import 'server-only';

import type { AuthUser, FirmRole } from '@/core/auth/types';
import { NotFoundError, ValidationError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';
import type { Database } from '@/core/supabase/database.types';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import type { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';
import type { TeamMemberRepository } from '@/modules/user-management/team-member.repository';

import type { CaseAccessGrantRepository } from './case-access-grant.repository';
import type { CaseRepository } from './case.repository';

type CaseRow = Database['public']['Tables']['cases']['Row'];
type CaseAccessGrantRow = Database['public']['Tables']['case_access_grants']['Row'];

const FIRM_MANAGE_ROLES: readonly FirmRole[] = ['owner', 'admin'];

export class CaseAccessGrantService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly caseAccessGrantRepository: CaseAccessGrantRepository,
    private readonly caseRepository: CaseRepository,
    private readonly teamMemberRepository: TeamMemberRepository,
    private readonly firmMemberRepository: FirmMemberRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {
    super(currentUser);
  }

  /**
   * Issues a grant. The case OWNER may always issue a grant on their own
   * case -- Decision #60, confirmed. Failing that, a team lead of the
   * case's team (if it has one) or a firm admin/owner may also issue --
   * unchanged from the original confirmed decision (scoping doc
   * sec3/sec4.3).
   *
   * accessLevel is caller-supplied and unrestricted -- 'read_write' is
   * permitted regardless of what kind of profile granteeId belongs to,
   * including a client's profile once linked. Confirmed this session,
   * not a new change (this method never restricted it).
   *
   * FLAGGED, NOT VALIDATED: this method does not check that granteeId
   * is an actual member of the case's firm/team before granting --
   * mirrors document_set_members' own precedent of leaving that kind of
   * cross-entity validation unenforced until a real requirement
   * surfaces. Revisit if granting to an unrelated profile turns out to
   * need blocking.
   *
   * AMENDED, THIS SESSION: recordUserAction() call now also passes
   * `caseId: input.caseId`.
   */
  async issueGrant(input: {
    caseId: string;
    granteeId: string;
    accessLevel: 'read' | 'read_write';
  }): Promise<CaseAccessGrantRow> {
    const caseRow = await this.caseRepository.findByIdOrThrow(input.caseId);
    const user = await this.requireGrantManageAccess(caseRow);

    // KNOWN FLAGGED MISMATCH, same idiom as every upstream module's
    // create() call: narrow input shape vs. the inherited create()'s
    // Database-derived Insert type.
    const grant = await this.caseAccessGrantRepository.create({
      case_id: input.caseId,
      grantee_id: input.granteeId,
      granted_by: user.id,
      access_level: input.accessLevel,
    } as never);

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: caseRow.firm_id,
      caseId: input.caseId,
      action: 'case.access_grant.issue',
      resourceType: 'case_access_grant',
      resourceId: grant.id,
      metadata: { caseId: input.caseId, granteeId: input.granteeId, accessLevel: input.accessLevel },
    });

    return grant;
  }

  /**
   * Revokes an active grant -- a soft update (revoked_at), not a hard
   * delete, per the migration's own soft-revoke design. Same
   * authorization shape as issueGrant() -- case owner, team lead, or
   * firm admin/owner (Decision #60).
   *
   * AMENDED, THIS SESSION: recordUserAction() call now also passes
   * `caseId`.
   */
  async revokeGrant(caseId: string, grantId: string): Promise<CaseAccessGrantRow> {
    const caseRow = await this.caseRepository.findByIdOrThrow(caseId);
    const user = await this.requireGrantManageAccess(caseRow);

    const grant = await this.caseAccessGrantRepository.findByIdOrThrow(grantId);
    if (grant.case_id !== caseId) {
      throw new NotFoundError('case_access_grants', grantId);
    }

    const revoked = await this.caseAccessGrantRepository.update(grantId, {
      revoked_at: new Date().toISOString(),
    } as never);

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: caseRow.firm_id,
      caseId,
      action: 'case.access_grant.revoke',
      resourceType: 'case_access_grant',
      resourceId: grantId,
      metadata: { caseId, granteeId: grant.grantee_id },
    });

    return revoked;
  }

  /**
   * Lists every active grant for a case.
   *
   * FLAGGED: CaseAccessGrantRepository is admin-client-only (see its
   * header) -- RLS does NOT apply to this read, so it would otherwise
   * return every active grant regardless of caller. Gated explicitly
   * here via the same requireGrantManageAccess() check as
   * issueGrant()/revokeGrant(), rather than relying on RLS the way
   * FirmMemberService#listMembers relies on firm_members' own
   * firm-wide SELECT policy -- case_access_grants has no equivalent
   * firm-wide SELECT policy, and this repository bypasses RLS
   * entirely regardless.
   */
  async listGrantsForCase(caseId: string): Promise<CaseAccessGrantRow[]> {
    const caseRow = await this.caseRepository.findByIdOrThrow(caseId);
    await this.requireGrantManageAccess(caseRow);

    return this.caseAccessGrantRepository.findActiveGrantsForCase(caseId);
  }

  /**
   * "My Cases" -- every case the CURRENT authenticated user has an
   * active grant for. Self-scoped only (no profileId parameter) --
   * unlike issueGrant()/revokeGrant()/listGrantsForCase(), which
   * require case-owner/team-lead/firm-admin authorization, this needs
   * no separate permission check: a profile listing its OWN grants
   * needs no additional gate, same reasoning as a user listing their
   * own firm_members rows.
   *
   * This is the real client-portal "My Cases" entry point once a client
   * has completed signUpAsClient() and been issued a grant (both
   * prerequisites, not enforced by this method itself). Works
   * identically for firm-staff profiles with grants on cases they don't
   * own -- no client-specific branch, per this session's confirmed
   * finding that grantee_id carries no role distinction.
   *
   * FLAGGED -- N+1: fetches each case individually via
   * caseRepository.findByIdOrThrow() in a loop. CaseRepository's real
   * source has not been pasted this session beyond the findByIdOrThrow
   * call already confirmed in issueGrant()/revokeGrant() -- no bulk
   * findByIds()-shaped method is confirmed to exist, so one was not
   * invented here. Fine for expected per-profile case volumes; revisit
   * with a bulk fetch once CaseRepository's real source is available.
   */
  async listMyCases(): Promise<CaseRow[]> {
    const user = this.requireAuthentication();

    const grants = await this.caseAccessGrantRepository.findActiveGrantsForProfile(user.id);

    const cases = await Promise.all(
      grants.map((grant) => this.caseRepository.findByIdOrThrow(grant.case_id)),
    );

    return cases;
  }

  /**
   * FOUNDATION TASK 2 — Case Assignment & Access Architecture.
   *
   * assignCase() / reassignCase() / removeAssignment() below are the
   * lawyer-assignment entry points the task requires. They are
   * deliberately NOT folded into issueGrant()/revokeGrant() above:
   * those two remain the general-purpose grant primitive (also used to
   * grant a CLIENT profile access to a case, per this file's own
   * "Client RLS scoping" note higher up), and grantee_id there is not
   * restricted to firm staff on purpose. Assignment is a narrower,
   * lawyer-specific operation with an extra invariant issueGrant() does
   * not (and should not) enforce generally: the grantee must actually
   * belong to the case's firm.
   *
   * CLOSES A REAL GAP flagged directly above on issueGrant()'s own doc
   * comment ("this method does not check that granteeId is an actual
   * member of the case's firm/team before granting"). That gap is
   * exactly Foundation Task 2's CASE ACCESS TEST 8 (a firm admin must
   * not be able to assign a case to a lawyer from another firm) and
   * assignment-rule #3 in the task brief ("target lawyer belongs to the
   * same firm"). issueGrant() itself is left unmodified — its existing
   * callers (the generic POST /api/cases/[id]/grants route, used for
   * client grants too) keep their current behavior; the new firm-
   * membership check lives only in the methods below.
   */

  /**
   * Assigns a case to a lawyer. Caller must pass requireGrantManageAccess()
   * (case owner, team lead, or firm admin/owner — unchanged, Decision
   * #60), same gate as issueGrant(). Additionally validates the target
   * lawyer is a firm_members row of the CASE'S OWN firm (caseRow.firm_id
   * — never a client-supplied firm id, so this cannot be spoofed) before
   * issuing anything — see this method's own class-level doc comment
   * above for why that check does not live in issueGrant() itself.
   *
   * Idempotent: assigning a lawyer who already holds an active grant at
   * the same access level is a no-op that returns the existing grant,
   * rather than hitting case_access_grants_active_unique (the partial
   * unique index on (case_id, grantee_id) where revoked_at is null) as
   * a raw DatabaseError. Assigning at a DIFFERENT access level updates
   * the existing active grant in place instead of creating a second row
   * (which the unique index would reject outright).
   */
  async assignCase(input: {
    caseId: string;
    lawyerId: string;
    accessLevel?: 'read' | 'read_write';
  }): Promise<CaseAccessGrantRow> {
    const caseRow = await this.caseRepository.findByIdOrThrow(input.caseId);
    const user = await this.requireGrantManageAccess(caseRow);
    const accessLevel = input.accessLevel ?? 'read_write';

    await this.requireLawyerInSameFirm(caseRow, input.lawyerId);

    const existing = await this.caseAccessGrantRepository.findActiveGrantForCaseAndProfile(
      input.caseId,
      input.lawyerId,
    );

    if (existing) {
      if (existing.access_level === accessLevel) {
        return existing;
      }

      const updated = await this.caseAccessGrantRepository.update(existing.id, {
        access_level: accessLevel,
      } as never);

      await this.auditLogRepository.recordUserAction({
        actorId: user.id,
        firmId: caseRow.firm_id,
        caseId: input.caseId,
        action: 'case.assignment.update',
        resourceType: 'case_access_grant',
        resourceId: existing.id,
        metadata: { caseId: input.caseId, lawyerId: input.lawyerId, accessLevel },
      });

      return updated;
    }

    const grant = await this.caseAccessGrantRepository.create({
      case_id: input.caseId,
      grantee_id: input.lawyerId,
      granted_by: user.id,
      access_level: accessLevel,
    } as never);

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: caseRow.firm_id,
      caseId: input.caseId,
      action: 'case.assignment.assign',
      resourceType: 'case_access_grant',
      resourceId: grant.id,
      metadata: { caseId: input.caseId, lawyerId: input.lawyerId, accessLevel },
    });

    return grant;
  }

  /**
   * Reassigns a case from one lawyer to another: revokes fromLawyerId's
   * active grant (if any — a missing prior assignment is not treated as
   * an error, since the end state this method guarantees is "toLawyerId
   * is now assigned", regardless of what came before) and assigns
   * toLawyerId via assignCase() (so the same same-firm validation and
   * idempotency handling applies to the new assignee).
   */
  async reassignCase(input: {
    caseId: string;
    fromLawyerId: string;
    toLawyerId: string;
    accessLevel?: 'read' | 'read_write';
  }): Promise<CaseAccessGrantRow> {
    const caseRow = await this.caseRepository.findByIdOrThrow(input.caseId);
    const user = await this.requireGrantManageAccess(caseRow);

    const priorGrant = await this.caseAccessGrantRepository.findActiveGrantForCaseAndProfile(
      input.caseId,
      input.fromLawyerId,
    );

    if (priorGrant) {
      await this.caseAccessGrantRepository.update(priorGrant.id, {
        revoked_at: new Date().toISOString(),
      } as never);

      await this.auditLogRepository.recordUserAction({
        actorId: user.id,
        firmId: caseRow.firm_id,
        caseId: input.caseId,
        action: 'case.assignment.reassign',
        resourceType: 'case_access_grant',
        resourceId: priorGrant.id,
        metadata: { caseId: input.caseId, fromLawyerId: input.fromLawyerId, toLawyerId: input.toLawyerId },
      });
    }

    return this.assignCase({
      caseId: input.caseId,
      lawyerId: input.toLawyerId,
      accessLevel: input.accessLevel,
    });
  }

  /**
   * Removes a lawyer's assignment from a case (soft-revoke, same
   * revoked_at mechanism as revokeGrant()). Looks the active grant up by
   * (caseId, lawyerId) rather than requiring the caller to already know
   * a grantId — the natural shape for a "remove this lawyer from this
   * case" management action. Throws NotFoundError if the lawyer has no
   * active assignment on this case.
   */
  async removeAssignment(caseId: string, lawyerId: string): Promise<CaseAccessGrantRow> {
    const caseRow = await this.caseRepository.findByIdOrThrow(caseId);
    const user = await this.requireGrantManageAccess(caseRow);

    const grant = await this.caseAccessGrantRepository.findActiveGrantForCaseAndProfile(
      caseId,
      lawyerId,
    );

    if (!grant) {
      throw new NotFoundError('case_access_grants', `${caseId}:${lawyerId}`);
    }

    const revoked = await this.caseAccessGrantRepository.update(grant.id, {
      revoked_at: new Date().toISOString(),
    } as never);

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: caseRow.firm_id,
      caseId,
      action: 'case.assignment.remove',
      resourceType: 'case_access_grant',
      resourceId: grant.id,
      metadata: { caseId, lawyerId },
    });

    return revoked;
  }

  /**
   * CASE ACCESS TEST 8 / assignment-rule #3: the target lawyer must be a
   * firm_members row of the CASE'S OWN firm (caseRow.firm_id, resolved
   * from the trusted caseRow already fetched by the caller — never a
   * client-supplied firm id). No specific FirmRole is required of the
   * target (an assignee could themselves be an 'admin' or 'owner', not
   * just a plain 'lawyer'/'employee' row) — only firm membership itself.
   * A missing firm_members row (personal orgs, a different firm
   * entirely, or a profile that was never added to this firm) fails
   * closed with a ValidationError, not a generic authorization error,
   * since this is a data-validity problem with the request (a bad
   * lawyerId), not a permissions problem with the caller.
   */
  private async requireLawyerInSameFirm(caseRow: CaseRow, lawyerId: string): Promise<void> {
    const firmRole = await this.firmMemberRepository.findByFirmAndProfile(
      caseRow.firm_id,
      lawyerId,
    );

    if (!firmRole) {
      throw new ValidationError(
        'The selected lawyer is not a member of this case\u2019s firm.',
        { caseId: caseRow.id, firmId: caseRow.firm_id, lawyerId },
      );
    }
  }

  /**
   * Shared authorization check for issueGrant()/revokeGrant()/
   * listGrantsForCase(): the case OWNER always passes (Decision #60,
   * confirmed) -- checked first, directly off caseRow.owner_id, no
   * repository call needed. Failing that, a team lead of the case's
   * team (if it has one), or a firm admin/owner, same as before.
   *
   * Takes the full CaseRow (not firmId/teamId separately) -- resigned
   * from the prior revision specifically to make the ownership check
   * possible here. Identical shape to CaseService#requireCaseCreateAccess,
   * MINUS the "any firm member if solo" widening that method has --
   * duplicated, not shared; see that method's own doc comment for why,
   * and for why the two methods differ (this one checks an EXISTING
   * case's ownership; that one runs before a case exists).
   */
  private async requireGrantManageAccess(caseRow: CaseRow): Promise<AuthUser> {
    const user = this.requireAuthentication();

    if (caseRow.owner_id === user.id) {
      return user;
    }

    if (caseRow.team_id) {
      const teamRow = await this.teamMemberRepository.findRowByTeamAndProfile(caseRow.team_id, user.id);
      if (teamRow?.role === 'lead') {
        return user;
      }
    }

    const firmRole = await this.firmMemberRepository.findByFirmAndProfile(caseRow.firm_id, user.id);
    return this.requireFirmRole(firmRole, FIRM_MANAGE_ROLES);
  }
}