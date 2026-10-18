// src/modules/lawyer-inquiries/lawyer-inquiry-review.service.ts
//
// Pre-acceptance document review. Everything a reviewer may see of an
// inquiry's document and AI report goes through here, and every path ends in
// ONE decision:
//
//   * inquiry pending  -> open_lawyer_inquiry_review() (database): the caller
//     must be the addressed lawyer, or -- for a firm-routed inquiry -- an
//     owner/admin of the target firm; the 7-day window must be open; the
//     review row must not be revoked. Membership is checked live on every
//     call, so a demoted admin loses access at once.
//   * inquiry accepted -> ongoing access: an active case grant, or firm
//     owner/admin of the case's firm (the existing is_firm_case_manager
//     rule). Nothing is granted here.
//   * declined / anything else -> not found.
//
// "Not found" and "not authorized" are deliberately indistinguishable so an
// inquiry id cannot be probed. Document ids are always matched together with
// the inquiry id, so swapping a document id into the URL finds nothing.
// Files are served only as short-lived signed URLs minted with the
// service-role client on the server; no key or storage path reaches a client.

import 'server-only';

import type { AuthUser, FirmRole } from '@/core/auth/types';
import { NotFoundError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import type { CaseAccessGrantRepository } from '@/modules/cases/case-access-grant.repository';
import type { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';

import { rethrowInquiryRpcError } from './lawyer-inquiry.errors';
import type {
  InquiryAnalysisState,
  InquiryDocumentRow,
  LawyerInquiryRepository,
  LawyerInquiryRow,
} from './lawyer-inquiry.repository';
import { toListing, type LawyerInquiryListing } from './lawyer-inquiry.service';

/** Firm roles that may review/decide a firm-routed inquiry (existing FIRM_MANAGE_ROLES). */
const FIRM_REVIEW_ROLES: readonly FirmRole[] = ['owner', 'admin'];

/** Signed download links live this long. Each open mints a fresh one. */
export const REVIEW_SIGNED_URL_TTL_SECONDS = 120;

export type ReviewStage = 'pre_acceptance' | 'accepted';

export interface InquiryReviewDocument {
  id: string;
  fileName: string;
  analysisState: InquiryAnalysisState;
  /** The report frozen when the inquiry was sent. Null unless analysisState is 'complete'. */
  report: unknown;
}

export interface InquiryReview {
  inquiry: LawyerInquiryListing;
  stage: ReviewStage;
  /** Pre-acceptance only: how this caller is entitled to review. */
  capacity: 'assigned_lawyer' | 'firm_reviewer' | null;
  reviewExpiresAt: string;
  canDecide: boolean;
  /** True for a firm-routed inquiry: accepting needs a lawyer to assign. */
  requiresAssignee: boolean;
  documents: InquiryReviewDocument[];
}

export interface InquiryDocumentAccess {
  url: string;
  fileName: string;
  expiresInSeconds: number;
}

export interface FirmInquiryListing extends LawyerInquiryListing {
  /** True when the caller may open the documents/report (unassigned + pending). */
  reviewableByYou: boolean;
}

interface Authorized {
  row: LawyerInquiryRow;
  stage: ReviewStage;
  capacity: 'assigned_lawyer' | 'firm_reviewer' | null;
  expiresAt: string;
}

export class LawyerInquiryReviewService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly repository: LawyerInquiryRepository,
    private readonly firmMemberRepository: FirmMemberRepository,
    private readonly caseAccessGrantRepository: CaseAccessGrantRepository,
    private readonly auditLogRepository: AuditLogRepository
  ) {
    super(currentUser);
  }

  /** Firm Terminal inbox: every inquiry routed to the firm. Firm owner/admin only. */
  async listFirmInquiries(firmId: string): Promise<FirmInquiryListing[]> {
    const user = this.requireAuthentication();

    const firmRole = await this.firmMemberRepository.findByFirmAndProfile(firmId, user.id);
    this.requireFirmRole(firmRole, FIRM_REVIEW_ROLES);

    const rows = await this.repository.listForFirm(firmId);
    return rows.map((row) => ({
      ...toListing(row),
      reviewableByYou: row.status === 'pending' && row.target_profile_id === null,
    }));
  }

  /** The inquiry, its attached document(s) and their reports, for an authorized reviewer. */
  async getReview(inquiryId: string): Promise<InquiryReview> {
    const access = await this.authorize(inquiryId);
    const documents = await this.repository.listDocumentsForInquiry(inquiryId);

    return {
      inquiry: toListing(access.row),
      stage: access.stage,
      capacity: access.capacity,
      reviewExpiresAt: access.expiresAt,
      canDecide: access.stage === 'pre_acceptance',
      requiresAssignee: access.row.target_profile_id === null,
      documents: documents.map(toReviewDocument),
    };
  }

  /** A short-lived signed URL for ONE document of ONE inquiry. Audited. */
  async getDocumentAccess(
    inquiryId: string,
    inquiryDocumentId: string
  ): Promise<InquiryDocumentAccess> {
    const user = this.requireAuthentication();
    const access = await this.authorize(inquiryId);

    const document = await this.repository.findDocumentForInquiry(inquiryId, inquiryDocumentId);
    if (!document) {
      throw new NotFoundError('Document not found.');
    }

    const url = await this.repository.createSignedUrl(
      document.storage_path,
      REVIEW_SIGNED_URL_TTL_SECONDS
    );
    if (!url) {
      throw new NotFoundError('The document file is no longer available.');
    }

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: access.row.target_firm_id,
      caseId: access.row.case_id,
      action: 'lawyer_inquiry.document.open',
      resourceType: 'lawyer_inquiry_document',
      resourceId: document.id,
      metadata: { inquiryId, stage: access.stage },
    });

    return { url, fileName: document.file_name, expiresInSeconds: REVIEW_SIGNED_URL_TTL_SECONDS };
  }

  private async authorize(inquiryId: string): Promise<Authorized> {
    const user = this.requireAuthentication();

    const row = await this.repository.findById(inquiryId);
    if (!row) {
      throw new NotFoundError('Inquiry not found.');
    }

    if (row.status === 'pending') {
      try {
        const review = await this.repository.openReview(inquiryId, user.id);
        return { row, stage: 'pre_acceptance', capacity: review.capacity, expiresAt: review.expires_at };
      } catch (error) {
        rethrowInquiryRpcError(error, { hideExistence: true });
      }
    }

    if ((row.status === 'accepted' || row.status === 'converted_to_case') && row.case_id) {
      if (await this.hasOngoingAccess(row, user.id)) {
        return { row, stage: 'accepted', capacity: null, expiresAt: row.review_expires_at };
      }
    }

    throw new NotFoundError('Inquiry not found.');
  }

  /** Active case grant, or firm owner/admin of the case's firm. */
  private async hasOngoingAccess(row: LawyerInquiryRow, profileId: string): Promise<boolean> {
    if (row.case_id) {
      const grant = await this.caseAccessGrantRepository.findActiveGrantForCaseAndProfile(
        row.case_id,
        profileId
      );
      if (grant) {
        return true;
      }
    }

    const firmRole = await this.firmMemberRepository.findByFirmAndProfile(row.target_firm_id, profileId);
    return firmRole !== null && FIRM_REVIEW_ROLES.includes(firmRole);
  }
}

function toReviewDocument(row: InquiryDocumentRow): InquiryReviewDocument {
  return {
    id: row.id,
    fileName: row.file_name,
    analysisState: row.analysis_state,
    report: row.analysis_state === 'complete' ? row.analysis_snapshot : null,
  };
}
