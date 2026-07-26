// src/modules/lawyer-inquiries/lawyer-inquiry.service.ts
//
// Service layer for the lawyer-facing accept/decline actions (§2 steps
// 8-9), extended with assignInquiry() (§4.1, the firm handoff step) and
// convertInquiry() (§2 step 10, §4.5).
//
// FLAGGED, a real design choice made here, not discovered: extends
// BaseService and takes `currentUser: AuthUser | null` as its first
// constructor arg, mirroring CaseService exactly (case.service.ts,
// pasted and confirmed this session) -- NOT AnonymousAnalysisService's
// shape (a plain deps object, no currentUser), which was the other
// available precedent in this same module. The reason: accept/decline
// are the first lawyer-inquiry actions that need to check WHO is
// calling against a specific row (target_profile_id), which is exactly
// what BaseService's requireAuthentication()/requireOwnership() exist
// for -- AnonymousAnalysisService never needed that because every one
// of its callers is either unauthenticated by design (createAnonymousAnalysis)
// or trusted-input-from-a-route (reattachSession, called right after a
// confirmed signIn()).
//
// FLAGGED, carried directly from lawyer-inquiry.repository.ts's own
// header: whether a firm-targeted-but-unassigned inquiry can be
// accepted/declined before a firm admin assigns it is still an open
// question. Both acceptInquiry()/declineInquiry() below call
// requireOwnership(row.target_profile_id), which will THROW for a
// firm-targeted, unassigned inquiry, since target_profile_id is null.
// That's a real behavioral stance, not a bug -- it means an unassigned
// firm inquiry CANNOT be accepted or declined by anyone through this
// service until assignInquiry() sets target_profile_id first.
//
// assignInquiry() (§4.1). Mirrors CaseService's own
// requireCaseCreateAccess() pattern exactly: look up the caller's
// FirmRole via FirmMemberRepository, then gate on requireFirmRole()
// with the same ['owner', 'admin'] set CaseService uses for "only firm
// admins manage this."
//
// TWO JUDGMENT CALLS, FLAGGED, NOT CONFIRMED PRODUCT DECISIONS:
//   1. Reassignment is blocked -- assignInquiry() throws if
//      target_profile_id is already set, rather than silently
//      overwriting an existing assignment. The scoping doc's §4.1 never
//      explicitly addresses reassignment; blocking it is the safer
//      default (an explicit "unassign" step, if ever needed, is a
//      cheap addition later; silently allowing overwrite today and
//      restricting it later would be a breaking change for whatever
//      frontend gets built against this).
//   2. The target lawyer must themselves be a member of target_firm_id
//      (checked via a second FirmMemberRepository lookup) -- prevents a
//      firm admin handing an inquiry to a profile with no relationship
//      to the firm at all. Not explicitly required by the scoping doc,
//      but skipping it would let target_profile_id end up pointing at
//      an arbitrary profile id the caller supplies, which seems like an
//      oversight to allow rather than a deliberate flexibility.
//
// RESOLVED: FirmMemberRepository's real shape was confirmed this
// session (firm-member.repository.ts, real, pasted source) --
// findByFirmAndProfile(firmId, profileId): Promise<FirmRole | null>
// returns the bare FirmRole directly, exactly matching how it's used
// below (passed straight into requireFirmRole(), or checked with a
// plain truthiness test). No change needed to either call site.
//
// RESOLVED: lawyer-inquiry.factory.ts was confirmed this session,
// argument-by-argument, against this file's real constructor and
// CaseService's real constructor -- already correct, no change needed.
// TeamMemberRepository and DocumentRepository's constructor shapes
// (CaseService's other dependencies, wired in the factory) were also
// independently confirmed this session -- single SupabaseClient arg,
// matching what the factory already assumed.
//
// RESOLVED, THIS SESSION -- the teamId/title gap. `title` is supplied
// explicitly by the caller (lawyer) as a convertInquiry() parameter,
// unchanged. teamId is NO LONGER always null -- migration
// 20260810000000_add_team_id_to_lawyer_inquiries.sql added a team_id
// column to lawyer_inquiries, set at assignInquiry() time (caller-
// supplied, same "explicit input, never inferred" posture
// CaseService#createCase() already uses for its own teamId param).
// convertInquiry() below now reads row.team_id and passes it straight
// through to createCase(), instead of the previous hardcoded null.
// This is what finally makes CaseService#requireCaseCreateAccess()'s
// team-lead authorization path reachable through this flow -- a team
// lead (of whatever team was set at assignment time) can now convert an
// inquiry into a case, matching the scoping doc's §4.5 "team head or
// firm admin" rule in full, not just the firm-admin half of it.
//
// FLAGGED, CARRIED FORWARD, NOT A ROUTE CHANGE MADE HERE: the route
// handling assignInquiry() (not pasted/confirmed this session) will
// need updating to accept and pass through a teamId field in its
// request body, alongside the existing targetProfileId. Not fixed here
// since that route's real current content is unconfirmed.

import 'server-only';

import type { AuthUser, FirmRole } from '@/core/auth/types';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';
import type { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';
import type { CaseService } from '@/modules/cases/case.service';

import type { LawyerInquiryRepository } from './lawyer-inquiry.repository';

// FLAGGED: hand-typed DTO shape, same caveat as every row/DTO type
// written this session -- not from generated Supabase types.
export interface LawyerInquiryListing {
  id: string;
  clientProfileId: string;
  targetProfileId: string | null;
  targetFirmId: string;
  teamId: string | null;
  status: 'pending' | 'accepted' | 'converted_to_case';
  documentStoragePath: string;
  analysisResult: unknown;
}

/**
 * FirmRoles permitted to assign an unassigned firm inquiry to a
 * specific lawyer. Matches CaseService's own FIRM_MANAGE_ROLES exactly
 * (case.service.ts, confirmed this session) -- same confirmed product
 * decision (scoping doc §4.1: "the firm owner or admin ... hands it
 * over"), same role set as case creation, not independently re-derived.
 */
const FIRM_MANAGE_ROLES: readonly FirmRole[] = ['owner', 'admin'];

export class LawyerInquiryService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly repository: LawyerInquiryRepository,
    private readonly firmMemberRepository: FirmMemberRepository,
    private readonly caseService: CaseService
  ) {
    super(currentUser);
  }

  /**
   * Accepts a pending inquiry (§2 step 9) -- full document + analysis
   * unlock for the lawyer from this point on. Only the inquiry's
   * target_profile_id may accept it.
   *
   * FLAGGED: does not check the row's CURRENT status is 'pending'
   * before calling repository.accept() -- same gap the repository
   * layer already flagged, just not resolved up here either.
   */
  async acceptInquiry(inquiryId: string): Promise<LawyerInquiryListing> {
    this.requireAuthentication();

    const row = await this.repository.findById(inquiryId);
    if (!row) {
      throw new NotFoundError('Inquiry not found.');
    }

    if (row.target_profile_id === null) {
      throw new AuthorizationError('This inquiry has not yet been assigned to a lawyer.');
    }
    this.requireOwnership(row.target_profile_id);

    const updated = await this.repository.accept(inquiryId);
    return toListing(updated);
  }

  /**
   * Declines a pending inquiry (§2 step 8) -- deletes the row outright,
   * per §4.2's resolved "no stored status, no audit trail" decision.
   * Same target_profile_id-only authorization as acceptInquiry().
   */
  async declineInquiry(inquiryId: string): Promise<void> {
    this.requireAuthentication();

    const row = await this.repository.findById(inquiryId);
    if (!row) {
      return;
    }

    if (row.target_profile_id === null) {
      throw new AuthorizationError('This inquiry has not yet been assigned to a lawyer.');
    }
    this.requireOwnership(row.target_profile_id);
  }

  /**
   * Hands an unassigned firm inquiry to a specific lawyer at that firm
   * (§4.1). Caller must be a firm owner/admin of the inquiry's
   * target_firm_id; the lawyer being assigned to must themselves be a
   * member of that same firm. See file header for both flagged
   * judgment calls (reassignment blocked; target-lawyer membership
   * required).
   *
   * teamId is NEW -- caller-supplied, optional (defaults to null for a
   * solo-firm or no-team inquiry), same "explicit input, never
   * inferred" posture CaseService#createCase() already uses. This is
   * what convertInquiry() later reads to reach CaseService's team-lead
   * authorization path -- see that method's own doc comment.
   */
  async assignInquiry(
    inquiryId: string,
    targetProfileId: string,
    teamId: string | null = null
  ): Promise<LawyerInquiryListing> {
    const user = this.requireAuthentication();

    const row = await this.repository.findById(inquiryId);
    if (!row) {
      throw new NotFoundError('Inquiry not found.');
    }

    if (row.target_profile_id !== null) {
      throw new ConflictError('Inquiry is already assigned to a lawyer.');
    }

    // Caller must be firm owner/admin of the firm this inquiry targets.
    const callerFirmRole = await this.firmMemberRepository.findByFirmAndProfile(
      row.target_firm_id,
      user.id
    );
    this.requireFirmRole(callerFirmRole, FIRM_MANAGE_ROLES);

    // The lawyer being assigned must themselves belong to this firm --
    // see file header, judgment call #2.
    const targetFirmRole = await this.firmMemberRepository.findByFirmAndProfile(
      row.target_firm_id,
      targetProfileId
    );
    if (!targetFirmRole) {
      throw new ValidationError('The target lawyer is not a member of this firm.');
    }

    const updated = await this.repository.assign(inquiryId, {
      targetProfileId,
      assignedBy: user.id,
      teamId,
    });

    return toListing(updated);
  }

  /**
   * Converts an accepted inquiry into a real case (§2 step 10, §4.5).
   *
   * FLAGGED, JUDGMENT CALL: only 'accepted' inquiries may be converted
   * -- a 'pending' inquiry (never accepted) or an already-
   * 'converted_to_case' one both throw. The scoping doc's flow (§2
   * steps 9-10) reads as accept-then-convert in sequence, but never
   * explicitly forbids converting straight from pending -- this method
   * enforces the sequence rather than assuming it, since allowing a
   * pending inquiry to convert would let a case exist for a client who
   * never had their inquiry accepted at all.
   *
   * RESOLVED, THIS SESSION -- teamId now sourced from row.team_id
   * (set earlier, at assignInquiry() time), not hardcoded null. This
   * closes the gap this method's own header used to carry: previously,
   * CaseService#createCase()'s requireCaseCreateAccess() could only
   * ever reach its firm-admin authorization path here, since teamId
   * was always null -- the team-lead path was permanently unreachable
   * through this method, even though the scoping doc's §4.5 names
   * "team head or firm admin" as the confirmed rule. Now that team_id
   * is a real column set at assignment time, a team lead of that team
   * can convert too, matching §4.5 in full.
   *
   * FLAGGED, NON-TRANSACTIONAL RISK, same accepted-not-solved class as
   * document.service.ts's own flagged gap between a mutation and a
   * follow-up write: createCase() and repository.convert() are two
   * separate calls. If createCase() succeeds but repository.convert()
   * throws, a real case now exists with no lawyer_inquiries row
   * pointing to it as converted -- the inquiry would still read as
   * 'accepted' even though a case for it already exists. Not fixed here
   * -- no precedent in this codebase for a transaction spanning two
   * different repositories/services (same gap CaseService and
   * DocumentService both separately carry).
   */
  async convertInquiry(inquiryId: string, title: string): Promise<LawyerInquiryListing> {
    this.requireAuthentication();

    const row = await this.repository.findById(inquiryId);
    if (!row) {
      throw new NotFoundError('Inquiry not found.');
    }

    if (row.status !== 'accepted') {
      throw new ConflictError('Only an accepted inquiry can be converted to a case.');
    }

    // CaseService.createCase() performs its own full authorization
    // check internally (requireCaseCreateAccess) -- this method does
    // NOT duplicate that check here, same "authorization lives with the
    // thing being authorized" posture as every other cross-module call
    // in this file. teamId now comes from row.team_id, set earlier at
    // assignInquiry() time -- see this method's own doc comment above.
    const createdCase = await this.caseService.createCase({
      firmId: row.target_firm_id,
      teamId: row.team_id,
      title,
    });

    const updated = await this.repository.convert(inquiryId, createdCase.id);
    return toListing(updated);
  }
}

function toListing(row: {
  id: string;
  client_profile_id: string;
  target_profile_id: string | null;
  target_firm_id: string;
  team_id: string | null;
  status: 'pending' | 'accepted' | 'converted_to_case';
  document_storage_path: string;
  analysis_result: unknown;
}): LawyerInquiryListing {
  return {
    id: row.id,
    clientProfileId: row.client_profile_id,
    targetProfileId: row.target_profile_id,
    targetFirmId: row.target_firm_id,
    teamId: row.team_id,
    status: row.status,
    documentStoragePath: row.document_storage_path,
    analysisResult: row.analysis_result,
  };
}