// src/modules/cases/case.service.ts
// Case Access Grants — Phase 4. Built directly against the real, pasted
// document-set.service.ts for the create/list/get + membership-method
// shape (createDocumentSet/listDocumentSets/getDocumentSetById/
// addDocumentToSet/removeDocumentFromSet all have a direct case-module
// analog below).
//
// FLAGGED ASSUMPTION, same idiom document-set.service.ts's own header
// carries forward: BaseService's real source is now independently
// confirmed this session (base.service.ts was pasted) -- requireOwnership()/
// requireAuthentication()/requireFirmRole() below are used exactly as
// documented there, not inferred.
//
// UPDATED — Decision #60 (solo case owner can create/manage their own
// case without also being a firm admin) and Decision #61 (a read_write
// grantee can add documents to a case, not just the owner) are now
// implemented below. Both were previously flagged and deliberately left
// unfixed pending product confirmation; both are now confirmed. See each
// method's own doc comment for exact scope.
//
// Constructor gained a new dependency, caseAccessGrantRepository, needed
// by addDocumentToCase() to check for an active read_write grant. See
// case.factory.ts's createCaseService() for how it's constructed (admin
// client, same reasoning as case-access-grant.repository.ts's header).

import 'server-only';

import type { AuthUser, FirmRole } from '@/core/auth/types';
import { BaseService } from '@/core/services/base.service';
import type { Database } from '@/core/supabase/database.types';
import type { DocumentRepository } from '@/modules/documents/document.repository';
import type { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';
import type { TeamMemberRepository } from '@/modules/user-management/team-member.repository';

import type { CaseAccessGrantRepository } from './case-access-grant.repository';
import type { CaseRepository } from './case.repository';

type CaseRow = Database['public']['Tables']['cases']['Row'];
type DocumentRow = Database['public']['Tables']['documents']['Row'];

/**
 * FirmRoles permitted to create a case WITH a team, or to create/manage
 * a case in a firm the caller isn't the owner of. Matches
 * FirmMemberService's own MANAGE_ROLES exactly -- same confirmed
 * decision (scoping doc sec4.3: "only team heads and firm admins").
 * Decision #60 widens the NO-TEAM path beyond this list -- see
 * requireCaseCreateAccess()'s doc comment.
 */
const FIRM_MANAGE_ROLES: readonly FirmRole[] = ['owner', 'admin'];

export class CaseService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly caseRepository: CaseRepository,
    private readonly teamMemberRepository: TeamMemberRepository,
    private readonly firmMemberRepository: FirmMemberRepository,
    private readonly documentRepository: DocumentRepository,
    private readonly caseAccessGrantRepository: CaseAccessGrantRepository,
  ) {
    super(currentUser);
  }

  /**
   * Creates a case. A case WITH a teamId still requires a team lead of
   * that team, or a firm admin/owner of firmId -- unchanged from the
   * original confirmed decision (scoping doc sec3/sec4.3). A SOLO case
   * (teamId null) may now be created by ANY member of firmId --
   * Decision #60, confirmed: a solo lawyer who is a firm member but not
   * also a firm admin/owner can create and own their own case. This
   * widens only the no-team path; team-scoped case creation is
   * unchanged.
   */
  async createCase(input: {
    firmId: string;
    teamId: string | null;
    title: string;
  }): Promise<CaseRow> {
    const user = await this.requireCaseCreateAccess(input.firmId, input.teamId);

    // KNOWN FLAGGED MISMATCH, same idiom as DocumentSetService's create
    // methods: narrow input shape vs. the inherited create()'s
    // Database-derived Insert type.
    return this.caseRepository.create({
      firm_id: input.firmId,
      team_id: input.teamId,
      owner_id: user.id,
      title: input.title,
    } as never);
  }

  /**
   * Lists every case visible to the caller under RLS.
   */
  async listCases(): Promise<CaseRow[]> {
    this.requireAuthentication();
    return this.caseRepository.findManyVisible();
  }

  /**
   * Fetches a single case the caller can see (RLS-scoped -- 404s for a
   * case the caller can't see at all).
   */
  async getCaseById(caseId: string): Promise<CaseRow> {
    this.requireAuthentication();
    return this.caseRepository.findByIdOrThrow(caseId);
  }

  /**
   * Adds a document to a case. Requires the caller either OWN the case,
   * or hold an active read_write grant on it -- Decision #61, confirmed:
   * a read_write grantee (not just the case owner) may add documents.
   * Previously flagged as owner-only pending this decision; now widened.
   *
   * The document itself must still be owned by the caller
   * (this.requireOwnership(document.owner_id), unchanged) -- same
   * enforcement-point reasoning as DocumentSetService#addDocumentToSet.
   *
   * FLAGGED, NOT SOLVED HERE, real limitation: a read_write grantee can
   * only add documents THEY personally own to the case -- not documents
   * already in the case owner's vault. Whether a grantee should be able
   * to attach the case owner's own documents is a separate, unconfirmed
   * question, deliberately not decided here.
   */
  async addDocumentToCase(caseId: string, documentId: string): Promise<void> {
    const user = this.requireAuthentication();

    const caseRow = await this.caseRepository.findByIdOrThrow(caseId);

    const isOwner = caseRow.owner_id === user.id;
    if (!isOwner) {
      const grant = await this.caseAccessGrantRepository.findActiveGrantForCaseAndProfile(
        caseId,
        user.id,
      );

      if (!grant || grant.access_level !== 'read_write') {
        // No ownership and no valid read_write grant -- throws.
        this.requireOwnership(caseRow.owner_id);
      }
    }

    const document = await this.documentRepository.findByIdOrThrow(documentId);
    this.requireOwnership(document.owner_id);

    await this.caseRepository.addMember(caseId, documentId);
  }

  /**
   * Removes a document from a case. Owner-of-case only -- same
   * "removing is a fact about the case, not the document" reasoning as
   * DocumentSetService#removeDocumentFromSet. NOT widened to read_write
   * grantees -- Decision #61 only covers adding documents; removal was
   * not part of that decision and stays owner-only until a separate
   * decision confirms otherwise.
   */
  async removeDocumentFromCase(caseId: string, documentId: string): Promise<void> {
    this.requireAuthentication();

    const caseRow = await this.caseRepository.findByIdOrThrow(caseId);
    this.requireOwnership(caseRow.owner_id);

    await this.caseRepository.removeMember(caseId, documentId);
  }

  /**
   * Lists the full document rows belonging to a case.
   */
  async listCaseDocuments(caseId: string): Promise<DocumentRow[]> {
    this.requireAuthentication();
    await this.caseRepository.findByIdOrThrow(caseId);
    return this.caseRepository.findMemberDocuments(caseId);
  }

  /**
   * Shared create-access check: team lead of teamId (if given); else, if
   * teamId is null (a solo case), any member of firmId -- Decision #60;
   * else (teamId given but caller isn't its lead), firm admin/owner of
   * firmId as a fallback. Not a BaseService method -- BaseService has
   * requireFirmRole() but no requireTeamRole() equivalent (team-level
   * authorization was never generalized there the way firm-level was),
   * so this stays local to CaseService, following requireOwnership()'s
   * own documented "add a dedicated method rather than bolt onto an
   * existing one" precedent for new authorization shapes.
   *
   * Duplicated (not shared) in CaseAccessGrantService's identical-shape
   * requireGrantManageAccess() -- the two Services don't share a common
   * private base beyond BaseService itself, and this project has no
   * established precedent for cross-Service private helper sharing.
   * NOTE: CaseAccessGrantService's version differs slightly -- it checks
   * case OWNERSHIP directly (not "any firm member, only if solo"),
   * since a grant always applies to an already-existing case with a
   * known owner_id. This method is create-time, before a case (and
   * therefore an owner_id) exists, so it can only check firm
   * membership, not case ownership.
   */
  private async requireCaseCreateAccess(firmId: string, teamId: string | null): Promise<AuthUser> {
    const user = this.requireAuthentication();

    if (teamId) {
      const teamRow = await this.teamMemberRepository.findRowByTeamAndProfile(teamId, user.id);
      if (teamRow?.role === 'lead') {
        return user;
      }
    }

    const firmRole = await this.firmMemberRepository.findByFirmAndProfile(firmId, user.id);

    // Decision #60: a solo case (no teamId) may be created by any member
    // of the firm, not just owner/admin -- widen before falling through
    // to the stricter requireFirmRole() check below.
    if (!teamId && firmRole) {
      return user;
    }

    return this.requireFirmRole(firmRole, FIRM_MANAGE_ROLES);
  }
}