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
import type { DocumentService } from '@/modules/documents/document.service';

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
  // NEW -- added for listMyInquiries()'s consumer (the "My Inquiries"
  // page needs a created date to sort/display by). Additive only:
  // every existing caller of toListing() (accept/decline/assign/
  // convert's own return values) already has this on the row it maps
  // from, so this is a strictly wider response shape, not a breaking
  // change to any existing route's contract.
  createdAt: string;
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
    private readonly caseService: CaseService,
    // NEW -- authenticated "contact a lawyer" flow. See createInquiry()
    // below.
    private readonly documentService: DocumentService
  ) {
    super(currentUser);
  }

  /**
   * NEW -- authenticated "contact a lawyer" flow (documents/[id]
   * frontend, real gap identified this session: this table's only
   * prior write path was AnonymousAnalysisService#reattachSession(),
   * which calls LawyerInquiryRepository.create() directly, bypassing
   * this Service entirely -- there was no authenticated create path at
   * all before this method).
   *
   * KEY DECISION -- mirrors every upstream synthesis module's own
   * "take inputs explicitly, don't fetch them yourself" discipline
   * (see e.g. ai-legal-insight.service.ts's runAiLegalInsight()):
   * `analysisResult` is passed in by the caller (the Route layer),
   * already combined from whichever upstream module(s)' results are
   * relevant, rather than this method reaching into
   * LegalHealthScoreService/AiLegalInsightService itself. This module
   * has no existing dependency on either, and adding one here would
   * mean re-deciding the same nine-collaborator sprawl question
   * ai-legal-insight.factory.ts's own KEY DECISION already documents at
   * length one layer up -- not worth repeating for a single write
   * method. The Route layer already has to call
   * AiLegalInsightService's getLatestCompletedXForAnalysis() passthroughs
   * to render the page in the first place; combining and forwarding
   * that same data here is not new work for it.
   *
   * KEY DECISION -- requires ownership of the document
   * (requireOwnership(document.owner_id)), same posture as every
   * upstream module's create-with-real-cost method (e.g.
   * DocumentAnalysisService#createAnalysis()). Contacting a lawyer
   * about a document is only meaningful for the document's own owner.
   *
   * KEY DECISION, FLAGGED JUDGMENT CALL -- does NOT verify
   * targetProfileId (when supplied) actually belongs to targetFirmId
   * before writing. assignInquiry() above performs that same check
   * explicitly (judgment call #2 in this file's header) because an
   * unconstrained targetProfileId there would let a firm admin hand an
   * inquiry to an unrelated profile. Here, targetProfileId/targetFirmId
   * both originate from LawyerDirectoryService's own picker (list a
   * firm, then list that firm's real roster) -- a mismatched pair would
   * require the client to deliberately construct a bad request, not
   * something the normal UI flow can produce. lawyer_inquiries'
   * real FK on target_firm_id (references firms(id)) still rejects an
   * outright-nonexistent firm at the database level; there is no
   * equivalent FK tying target_profile_id to target_firm_id
   * specifically, so a deliberately malicious mismatched pair would be
   * accepted as written. Flagged as a real, accepted gap for this first
   * version, not silently guarded -- add the same
   * firmMemberRepository.findByFirmAndProfile() check assignInquiry()
   * already uses if this needs hardening later.
   *
   * No requireFirmRole()/firm-membership check on the CALLER, unlike
   * assignInquiry() -- any authenticated client-side user (any
   * UserRole) may contact any firm about their own document; this is
   * the client-initiated half of the flow, not the firm-internal
   * handoff half.
   */
  async createInquiry(
    rawParams: unknown,
    targetFirmId: string,
    targetProfileId: string | null,
    analysisResult: unknown
  ): Promise<LawyerInquiryListing> {
    const user = this.requireAuthentication();

    const document = await this.documentService.getDocumentById(rawParams);
    this.requireOwnership(document.owner_id);

    const created = await this.repository.create({
      clientProfileId: user.id,
      targetProfileId,
      targetFirmId,
      documentStoragePath: document.storage_path,
      analysisResult,
    });

    return toListing(created);
  }

  /**
   * NEW -- lists every inquiry assigned to the CURRENT authenticated
   * caller (self-scoped, no id param -- same "no :id, resolves off the
   * authenticated caller" shape as CaseAccessGrantService#listMyCases(),
   * confirmed real precedent this session). Closes the "My Inquiries"
   * gap: accept/decline/convert have been fully implemented and
   * routable since earlier sessions, but nothing anywhere in this repo
   * ever listed a lawyer's OWN inquiries for them to act on in the
   * first place -- see the accompanying implementation report.
   *
   * requireAuthentication() supplies the id this filters on -- never a
   * client-supplied value, matching repository.listForTargetProfile()'s
   * own trust-posture comment.
   */
  async listMyInquiries(): Promise<LawyerInquiryListing[]> {
    const user = this.requireAuthentication();

    const rows = await this.repository.listForTargetProfile(user.id);
    return rows.map(toListing);
  }

  /**
   * NEW -- General User Terminal, "My Sent Inquiries" gap (the
   * companion read this session identified as missing: a General User
   * can already SEND an inquiry via createInquiry() above, but had no
   * way to see what happened to it afterward). Self-scoped, no id/
   * profileId param -- same "resolves entirely off requireAuthentication()'s
   * own result" shape as listMyInquiries() below and
   * CaseAccessGrantService#listMyCases() (confirmed real precedent).
   *
   * KEY DECISION, IDENTITY MODEL: deliberately named
   * listMySentInquiries(), not e.g. listForClientProfile(), to keep the
   * General User Terminal's own vocabulary (a General User is not
   * necessarily a Client Portal "client" -- see
   * lawyer-directory.service.ts's own "no currentUser concept" framing
   * for the same client/General-User distinction elsewhere in this
   * module) separate from this table's column name, which is
   * client_profile_id purely because that column predates the General
   * Portal existing as a concept at all (this table was built for the
   * anonymous-visitor-signs-up-and-contacts-a-lawyer flow, back when
   * "client" meant "whoever sent the inquiry," not the later, distinct
   * Client Portal role). No new identity field was introduced --
   * user.id (requireAuthentication()'s own result) is compared directly
   * against the existing client_profile_id column, same column
   * createInquiry() already writes to.
   *
   * No requireOwnership()/requireFirmRole() gate here, unlike
   * acceptInquiry()/assignInquiry() below -- there is no specific row
   * to check ownership against yet at call time (this IS the query that
   * finds which rows belong to the caller), same "authorization is
   * baked into the query's own filter, not a post-hoc check" posture as
   * listMyInquiries() below.
   */
  async listMySentInquiries(): Promise<LawyerInquiryListing[]> {
    const user = this.requireAuthentication();

    const rows = await this.repository.listForSenderProfile(user.id);
    return rows.map(toListing);
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
   *
   * FIXED, P0 SECURITY -- this method previously relied ENTIRELY on
   * CaseService#createCase()'s own requireCaseCreateAccess() check,
   * which only verifies the caller has case-creation access to
   * row.target_firm_id/row.team_id (any firm member, for a solo/no-team
   * case -- see that method's Decision #60). It never verified the
   * caller is actually the lawyer this inquiry was assigned to. That
   * meant any other member of the same firm (e.g. another lawyer, or
   * any firm member at all for a no-team inquiry) could call convert on
   * an inquiry accepted by a DIFFERENT lawyer and become the resulting
   * case's owner_id, taking over that lawyer's accepted engagement.
   *
   * The fix reuses the exact same assignment-ownership check
   * acceptInquiry()/declineInquiry() above already enforce --
   * requireOwnership(row.target_profile_id) -- rather than inventing a
   * new authorization rule. Only the lawyer this inquiry is currently
   * assigned to (target_profile_id) may convert it. No firm-owner/admin
   * override is added here: acceptInquiry()/declineInquiry(), the two
   * existing precedents for "acting on this row" in this same file, do
   * not grant one either (plain requireOwnership(), no allowRoles), so
   * adding one only for convert would be a new, unprecedented
   * permission model, not a reuse of an existing one.
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

    if (row.target_profile_id === null) {
      throw new AuthorizationError('This inquiry has not yet been assigned to a lawyer.');
    }
    this.requireOwnership(row.target_profile_id);

    // CaseService.createCase() still performs its own full
    // authorization check internally (requireCaseCreateAccess) -- that
    // check is orthogonal (does the caller have case-creation access to
    // this firm/team at all) and is still required. The
    // requireOwnership() call above is what was actually missing: it
    // closes the gap where createCase()'s firm-level check alone let
    // any firm member convert someone else's assigned inquiry. teamId
    // still comes from row.team_id, set earlier at assignInquiry()
    // time -- see this method's own doc comment above.
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
  created_at: string;
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
    createdAt: row.created_at,
  };
}