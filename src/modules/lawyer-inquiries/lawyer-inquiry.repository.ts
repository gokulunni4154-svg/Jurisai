// src/modules/lawyer-inquiries/lawyer-inquiry.repository.ts
//
// Extends the create()-only file from earlier this session with the two
// write paths that don't depend on source still missing (firms/profiles
// tables, needed for assign()'s firm-role check; NotificationsService,
// needed to fire the accept-side notification per §4.4). accept() and
// decline() were picked over assign()/convert() specifically because
// their business logic is fully specified in the scoping doc without
// needing anything not yet pasted:
//   - decline (§2 step 8, §4.2 resolved): row deletion, no stored
//     status, no audit trail. Nothing to look up first except the row
//     itself (to 404 cleanly if it's already gone).
//   - accept (§2 step 9): status pending -> accepted, full document/
//     analysis then unlock for the lawyer. Same -- no external lookup
//     needed for the state transition itself.
//
// RESOLVED: assign() (§4.1, the firm-handoff step) added. Business-logic
// decisions (caller must be firm owner/admin; target lawyer must belong
// to the firm; reassignment blocked) live in
// LawyerInquiryService#assignInquiry(), not here -- this repository
// method is deliberately as thin as accept()/decline() above, matching
// this file's established division of labor (auth/business rules at
// the Service layer, raw writes here).
//
// RESOLVED, THIS SESSION -- team_id gap closed. assign() now also sets
// team_id (new migration: 20260810000000_add_team_id_to_lawyer_inquiries.sql),
// caller-supplied via AssignInquiryInput, matching CaseService#createCase()'s
// own "teamId is explicit input, never inferred" posture. This is what
// finally makes convertInquiry()'s team-lead conversion path reachable --
// see that method's own doc comment in lawyer-inquiry.service.ts for the
// full before/after.
//
// convert() sets case_id and status only -- team_id is already on the row
// by the time convert() runs (set earlier, at assign() time), so nothing
// new is needed there.
//
// FLAGGED, new this file: assign(), like accept()/decline(), performs
// no authorization and no guard on the row's current state (whether
// target_profile_id is already set) -- purely a raw update. Same
// repository-doesn't-enforce-business-rules posture as accept()'s own
// flagged gap on status. The Service layer is what decides whether
// reassignment is allowed.
//
// FLAGGED, real open question, not resolved here: can a firm-targeted
// inquiry (target_profile_id still null, per §4.1's "routes to the firm
// generally" step) be accepted or declined BEFORE a firm owner/admin
// assigns it to a specific lawyer? The scoping doc's flow (§2) lists
// assign (6a) before accept/decline (8/9) in prose order, which reads
// as "assignment happens first," but nothing explicitly forbids a firm
// admin declining an unassigned inquiry outright, or a lawyer at the
// firm self-selecting it without a formal assign step. accept()/decline()
// below are written assuming a target_profile_id already exists by the
// time either is called -- if firm-level accept/decline-before-assign
// is actually intended, they need an additional target_firm_id-based
// path. assign() existing now makes this LESS urgent (there's now a
// real path to get target_profile_id set before accept/decline are
// ever called), but doesn't resolve the underlying question.

// REVISED -- pre-acceptance document review (migrations 20261017000000 /
// 20261017000001):
//   - accept() and decline() are GONE. accept() was an unconditional status
//     flip and decline() deleted the row; both are replaced by the atomic
//     Postgres functions accept_lawyer_inquiry() / decline_lawyer_inquiry(),
//     wrapped by acceptAtomic() / declineAtomic() below. Declining is now a
//     soft decline (status 'declined', reviewer + timestamp kept).
//   - create() also writes the lawyer_inquiry_documents row(s) that tie the
//     inquiry to the exact document and AI report it was sent with, so BOTH
//     the authenticated flow and AnonymousAnalysisService#reattachSession()
//     (which calls create() directly) get them without any change to the
//     anonymous module.
//   - openReview() wraps open_lawyer_inquiry_review(), the single decision
//     for who may preview/download before acceptance.
//   - convert()/assign() now carry state guards in the WHERE clause and
//     return null when the guard does not match.
// Trust posture is unchanged: always constructed with the admin client, every
// caller id is passed in and trusted, authorization lives in the services.

import type { SupabaseClient } from '@supabase/supabase-js';

export type LawyerInquiryStatus = 'pending' | 'accepted' | 'converted_to_case' | 'declined';
export type InquiryAnalysisState = 'complete' | 'processing' | 'unavailable';

export interface LawyerInquiryRow {
  id: string;
  client_profile_id: string;
  target_profile_id: string | null;
  target_firm_id: string;
  team_id: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  document_storage_path: string;
  analysis_result: unknown;
  status: LawyerInquiryStatus;
  case_id: string | null;
  decision: 'accepted' | 'declined' | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  review_expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface InquiryDocumentRow {
  id: string;
  inquiry_id: string;
  document_id: string | null;
  storage_path: string;
  file_name: string;
  analysis_id: string | null;
  analysis_state: InquiryAnalysisState;
  analysis_snapshot: unknown;
  created_at: string;
}

/** The document + report an inquiry is sent with. Omitted => anonymous-origin. */
export interface InquiryAttachmentInput {
  documentId: string | null;
  analysisId: string | null;
  analysisState: InquiryAnalysisState;
}

interface CreateInquiryInput {
  clientProfileId: string;
  targetProfileId: string | null;
  targetFirmId: string;
  documentStoragePath: string;
  analysisResult: unknown;
  attachment?: InquiryAttachmentInput;
}

interface AssignInquiryInput {
  targetProfileId: string;
  assignedBy: string;
  teamId: string | null;
}

export interface AcceptInquiryRpcInput {
  inquiryId: string;
  actorId: string;
  assigneeId: string | null;
  teamId: string | null;
  title: string;
}

export interface AcceptInquiryRpcResult {
  inquiry_id: string;
  case_id: string;
  already_accepted: boolean;
  assignee_id: string | null;
  linked_documents: number;
  unlinked_documents: number;
}

export interface DeclineInquiryRpcResult {
  inquiry_id: string;
  already_declined: boolean;
}

export interface OpenReviewRpcResult {
  review_id: string;
  inquiry_id: string;
  capacity: 'assigned_lawyer' | 'firm_reviewer';
  expires_at: string;
}

const TABLE = 'lawyer_inquiries';
const DOCUMENTS_TABLE = 'lawyer_inquiry_documents';
const DOCUMENTS_BUCKET = 'legal-vault-documents';

function fileNameFromPath(path: string): string {
  const segment = path.split('/').pop() ?? path;
  try {
    return decodeURIComponent(segment) || 'document';
  } catch {
    return segment || 'document';
  }
}

/**
 * Thin Postgres access for lawyer_inquiries and its review tables. Always
 * called with the admin (service-role) client: lawyer_inquiries' RLS is
 * SELECT-only and lawyer_inquiry_documents / lawyer_inquiry_reviews have no
 * reviewer policies at all. The trust posture of every method is therefore
 * "the caller passes an already-authorized id" -- see this file's header.
 */
export class LawyerInquiryRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Inserts the inquiry AND its lawyer_inquiry_documents row. The two inserts
   * are not one transaction (no cross-table transaction precedent in this
   * codebase); if the second fails the just-created inquiry row is removed so
   * no inquiry exists without its attachment. That compensating delete only
   * ever targets the row this call created seconds earlier.
   */
  async create(input: CreateInquiryInput): Promise<LawyerInquiryRow> {
    const { data, error } = await this.client
      .from(TABLE)
      .insert({
        client_profile_id: input.clientProfileId,
        target_profile_id: input.targetProfileId,
        target_firm_id: input.targetFirmId,
        document_storage_path: input.documentStoragePath,
        analysis_result: input.analysisResult,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    const attachment: InquiryAttachmentInput = input.attachment ?? {
      documentId: null,
      analysisId: null,
      analysisState: 'complete',
    };

    const { error: docError } = await this.client.from(DOCUMENTS_TABLE).insert({
      inquiry_id: data.id,
      document_id: attachment.documentId,
      storage_path: input.documentStoragePath,
      file_name: fileNameFromPath(input.documentStoragePath),
      analysis_id: attachment.analysisId,
      analysis_state: attachment.analysisState,
      analysis_snapshot: attachment.analysisState === 'complete' ? input.analysisResult : null,
    });

    if (docError) {
      await this.client.from(TABLE).delete().eq('id', data.id).eq('status', 'pending');
      throw docError;
    }

    return data;
  }

  /** Row by id, or null. A declined inquiry still exists (soft decline). */
  async findById(inquiryId: string): Promise<LawyerInquiryRow | null> {
    const { data, error } = await this.client
      .from(TABLE)
      .select('*')
      .eq('id', inquiryId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Every inquiry assigned to a lawyer (pending, accepted, converted,
   * declined), most recent first. targetProfileId must be the authenticated
   * caller's own id -- never client-supplied.
   */
  async listForTargetProfile(targetProfileId: string): Promise<LawyerInquiryRow[]> {
    const { data, error } = await this.client
      .from(TABLE)
      .select('*')
      .eq('target_profile_id', targetProfileId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data ?? [];
  }

  /**
   * Every inquiry a sender sent, most recent first. Declined inquiries are
   * left out: before soft decline a declined inquiry vanished from the
   * sender's list, and surfacing the decision to the sender is a product call
   * not made here. senderProfileId must be the authenticated caller's own id.
   */
  async listForSenderProfile(senderProfileId: string): Promise<LawyerInquiryRow[]> {
    const { data, error } = await this.client
      .from(TABLE)
      .select('*')
      .eq('client_profile_id', senderProfileId)
      .neq('status', 'declined')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data ?? [];
  }

  /**
   * Every inquiry routed to a firm, most recent first (Firm Terminal inbox).
   * Whether the caller may see the firm's inquiries is decided by the service
   * (firm owner/admin only).
   */
  async listForFirm(firmId: string): Promise<LawyerInquiryRow[]> {
    const { data, error } = await this.client
      .from(TABLE)
      .select('*')
      .eq('target_firm_id', firmId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data ?? [];
  }

  /** Documents attached to ONE inquiry, oldest first. */
  async listDocumentsForInquiry(inquiryId: string): Promise<InquiryDocumentRow[]> {
    const { data, error } = await this.client
      .from(DOCUMENTS_TABLE)
      .select('*')
      .eq('inquiry_id', inquiryId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return data ?? [];
  }

  /**
   * One attached document, matched on BOTH ids so a document id from another
   * inquiry (guessed or swapped into the URL) finds nothing.
   */
  async findDocumentForInquiry(
    inquiryId: string,
    inquiryDocumentId: string
  ): Promise<InquiryDocumentRow | null> {
    const { data, error } = await this.client
      .from(DOCUMENTS_TABLE)
      .select('*')
      .eq('id', inquiryDocumentId)
      .eq('inquiry_id', inquiryId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Looks up the analysis a sender attached, but only if it belongs to the
   * document being sent. Returns null when it does not, so a mismatched
   * analysis id is never recorded against the wrong document.
   */
  async findAnalysisForDocument(
    analysisId: string,
    documentId: string
  ): Promise<{ id: string; status: string } | null> {
    const { data, error } = await this.client
      .from('document_analyses')
      .select('id, status')
      .eq('id', analysisId)
      .eq('document_id', documentId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  }

  /** open_lawyer_inquiry_review(): the one pre-acceptance access decision. */
  async openReview(inquiryId: string, reviewerId: string): Promise<OpenReviewRpcResult> {
    const { data, error } = await this.client.rpc('open_lawyer_inquiry_review', {
      p_inquiry_id: inquiryId,
      p_reviewer_id: reviewerId,
    });

    if (error) {
      throw error;
    }

    return data as OpenReviewRpcResult;
  }

  /**
   * accept_lawyer_inquiry(): ONE transaction -- lock, case create/return,
   * document link, access grant, review end, audit. Idempotent.
   */
  async acceptAtomic(input: AcceptInquiryRpcInput): Promise<AcceptInquiryRpcResult> {
    const { data, error } = await this.client.rpc('accept_lawyer_inquiry', {
      p_inquiry_id: input.inquiryId,
      p_actor_id: input.actorId,
      p_assignee_id: input.assigneeId,
      p_team_id: input.teamId,
      p_title: input.title,
    });

    if (error) {
      throw error;
    }

    return data as AcceptInquiryRpcResult;
  }

  /** decline_lawyer_inquiry(): soft decline, ends review access, audit. */
  async declineAtomic(
    inquiryId: string,
    actorId: string,
    note: string | null
  ): Promise<DeclineInquiryRpcResult> {
    const { data, error } = await this.client.rpc('decline_lawyer_inquiry', {
      p_inquiry_id: inquiryId,
      p_actor_id: actorId,
      p_note: note,
    });

    if (error) {
      throw error;
    }

    return data as DeclineInquiryRpcResult;
  }

  /**
   * Hands an unassigned, still-pending firm inquiry to a lawyer (§4.1). The
   * guard is in the WHERE clause, so a concurrent accept/decline or a second
   * assign matches no row and this returns null (the service raises Conflict).
   */
  async assign(inquiryId: string, input: AssignInquiryInput): Promise<LawyerInquiryRow | null> {
    const { data, error } = await this.client
      .from(TABLE)
      .update({
        target_profile_id: input.targetProfileId,
        assigned_by: input.assignedBy,
        assigned_at: new Date().toISOString(),
        team_id: input.teamId,
      })
      .eq('id', inquiryId)
      .eq('status', 'pending')
      .is('target_profile_id', null)
      .select()
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * LEGACY: marks an already-accepted inquiry that never got a case as
   * converted. New accepts create the case atomically and never need this.
   * Guarded so it cannot overwrite an existing case_id; null = no match.
   */
  async convert(inquiryId: string, caseId: string): Promise<LawyerInquiryRow | null> {
    const { data, error } = await this.client
      .from(TABLE)
      .update({ status: 'converted_to_case', case_id: caseId })
      .eq('id', inquiryId)
      .eq('status', 'accepted')
      .is('case_id', null)
      .select()
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  }

  /** Short-lived signed URL for a stored object. Server-side only. */
  async createSignedUrl(storagePath: string, expiresInSeconds: number): Promise<string | null> {
    const { data, error } = await this.client.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error || !data) {
      return null;
    }

    return data.signedUrl;
  }
}
