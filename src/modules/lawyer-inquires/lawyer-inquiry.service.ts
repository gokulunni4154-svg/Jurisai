// src/modules/lawyer-inquiries/lawyer-inquiry.service.ts
//
// Service layer for the lawyer-facing accept/decline actions (§2 steps
// 8-9), extended this session with assignInquiry() (§4.1, the firm
// handoff step).
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
// service until assignInquiry() (now built, see below) sets
// target_profile_id first.
//
// NEW THIS SESSION -- assignInquiry() (§4.1). Unblocked now that
// firm_members' real shape and case.service.ts's real FIRM_MANAGE_ROLES
// usage are both confirmed. Mirrors CaseService's own
// requireCaseCreateAccess() pattern exactly: look up the caller's
// FirmRole via FirmMemberRepository, then gate on requireFirmRole()
// with the same ['owner', 'admin'] set CaseService uses for "only firm
// admins manage this."
//
// TWO JUDGMENT CALLS MADE HERE, FLAGGED, NOT CONFIRMED PRODUCT DECISIONS:
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
// FLAGGED, DEPENDENCY GAP: FirmMemberRepository itself was never pasted
// this session -- its constructor shape and findByFirmAndProfile()
// signature are inferred entirely from case.service.ts's real,
// confirmed USAGE of it (`firmMemberRepository.findByFirmAndProfile(firmId, user.id)`
// returning something with a `.role` field passed to requireFirmRole()).
// If the real file differs from that inferred shape, only the
// constructor injection and the two call sites below need to change.
//
// FLAGGED, NOT DONE HERE: lawyer-inquiry.factory.ts (referenced, never
// pasted this session) constructs LawyerInquiryService and will need
// updating to inject a real FirmMemberRepository AND a real CaseService
// instance alongside the existing LawyerInquiryRepository, now that the
// constructor below takes three dependencies. Not fixed here since that
// file's real content is still unconfirmed.
//
// NEW THIS SESSION -- convertInquiry() (§2 step 10, §4.5). Delegated
// decision: the caller (lawyer) supplies `title` explicitly as a
// parameter, rather than the system deriving one -- resolves the
// teamId/title gap flagged since case.service.ts was first reviewed,
// for title specifically.
//
// teamId is NOT resolved the same way -- it's simply always null.
// lawyer_inquiries has no team_id column at all (only target_firm_id),
// so there is no data anywhere in this flow that could supply a real
// teamId even if one were wanted. This has a real, FLAGGED consequence:
// CaseService#createCase()'s own requireCaseCreateAccess() only reaches
// its team-lead authorization path when a real teamId is given -- with
// teamId always null here, that path is permanently unreachable through
// convertInquiry(). In practice, ONLY a firm owner/admin can ever
// convert an inquiry to a case this way, even though the scoping doc's
// §4.5 names "team head or firm admin" as the confirmed rule. Not
// resolved by inventing a teamId source here -- flagged as a real gap
// between the confirmed product decision and what's actually reachable
// given lawyer_inquiries' real schema.

import 'server-only';

import type { AuthUser, FirmRole } from '@/core/auth/types';
import { AppError, NotFoundError } from '@/core/errors/app-error';
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
    const user = this.requireAuthentication();

    const row = await this.repository.findById(inquiryId);
    if (!row) {
      throw new NotFoundError('Inquiry not found.');
    }

    // See file header -- this throws for a firm-targeted, unassigned
    // inquiry (target_profile_id null), not just a wrong-lawyer case.
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
      // FLAGGED: unlike acceptInquiry(), a missing row here is treated
      // as a silent no-op rather than a thrown NotFoundError -- decline
      // is inherently idempotent by design (§4.2). Intentional
      // asymmetry, not an inconsistency.
      return;
    }

    this.requireOwnership(row.target_profile_id);

    await this.repository.decline(inquiryId);
  }

  /**
   * NEW -- hands an unassigned firm inquiry to a specific lawyer at
   * that firm (§4.1). Caller must be a firm owner/admin of the
   * inquiry's target_firm_id; the lawyer being assigned to must
   * themselves be a member of that same firm. See file header for both
   * flagged judgment calls (reassignment blocked; target-lawyer
   * membership required).
   */
  async assignInquiry(inquiryId: string, targetProfileId: string): Promise<LawyerInquiryListing> {
    const user = this.requireAuthentication();

    const row = await this.repository.findById(inquiryId);
    if (!row) {
      throw new NotFoundError('Inquiry not found.');
    }

    if (row.target_profile_id !== null) {
      // FLAGGED: AppError constructor shape (message, { statusCode })
      // is the same unconfirmed guess carried through every route file
      // this session -- not independently verified against real
      // AppError source.
      throw new AppError('Inquiry is already assigned to a lawyer.', { statusCode: 409 });
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
      throw new AppError('The target lawyer is not a member of this firm.', {
        statusCode: 400,
      });
    }

    const updated = await this.repository.assign(inquiryId, {
      targetProfileId,
      assignedBy: user.id,
    });

    return toListing(updated);
  }

  /**
   * NEW -- converts an accepted inquiry into a real case (§2 step 10,
   * §4.5). See file header for the full teamId/title resolution and
   * the resulting team-lead-path gap.
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
      throw new AppError('Only an accepted inquiry can be converted to a case.', {
        statusCode: 409,
      });
    }

    // CaseService.createCase() performs its own full authorization
    // check internally (requireCaseCreateAccess) -- this method does
    // NOT duplicate that check here, same "authorization lives with the
    // thing being authorized" posture as every other cross-module call
    // in this file. teamId is always null -- see file header.
    const createdCase = await this.caseService.createCase({
      firmId: row.target_firm_id,
      teamId: null,
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
  status: 'pending' | 'accepted' | 'converted_to_case';
  document_storage_path: string;
  analysis_result: unknown;
}): LawyerInquiryListing {
  return {
    id: row.id,
    clientProfileId: row.client_profile_id,
    targetProfileId: row.target_profile_id,
    targetFirmId: row.target_firm_id,
    status: row.status,
    documentStoragePath: row.document_storage_path,
    analysisResult: row.analysis_result,
  };
}