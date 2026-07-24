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
// RESOLVED THIS SESSION: assign() (§4.1, the firm-handoff step) added
// below. This was previously blocked on firm_members-shape source --
// now confirmed real via 20260802000001_create_firm_members_table.sql
// and case.service.ts's real usage of FirmMemberRepository. The
// business-logic decisions (caller must be firm owner/admin; target
// lawyer must belong to the firm; reassignment blocked) live in
// LawyerInquiryService#assignInquiry(), not here -- this repository
// method is deliberately as thin as accept()/decline() above, matching
// this file's established division of labor (auth/business rules at
// the Service layer, raw writes here).
//
// convert() remains deliberately NOT added here -- still blocked on
// CaseService.createCase()'s teamId/title gap (now partially resolved:
// firmId is confirmed non-nullable per the real cases migration, but
// title still has no source in lawyer_inquiries, and teamId's source
// for a converted case is still an open product question).
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

import type { SupabaseClient } from '@supabase/supabase-js';

// FLAGGED: hand-typed to match the migration column-for-column, same
// caveat as AnonymousAnalysisSessionRow -- no generated-types
// convention confirmed against pasted source this session.
interface LawyerInquiryRow {
  id: string;
  client_profile_id: string;
  target_profile_id: string | null;
  target_firm_id: string;
  assigned_by: string | null;
  assigned_at: string | null;
  document_storage_path: string;
  analysis_result: unknown;
  status: 'pending' | 'accepted' | 'converted_to_case';
  case_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateInquiryInput {
  clientProfileId: string;
  targetProfileId: string | null;
  targetFirmId: string;
  documentStoragePath: string;
  analysisResult: unknown;
}

interface AssignInquiryInput {
  targetProfileId: string;
  assignedBy: string;
}

const TABLE = 'lawyer_inquiries';

/**
 * Thin Postgres access for lawyer_inquiries. Always called with the
 * admin (service-role) client -- this table's own RLS is SELECT-only
 * (see the migration), so every write, including create(), has to go
 * through service-role, not the caller's own session, even though
 * create() happens right after a real signup and the caller does have a
 * session at that point. Flagged: this means create() can't rely on
 * client_profile_id being implicitly auth.uid() the way an RLS-backed
 * insert would -- it's passed explicitly and trusted, so whatever calls
 * this repository must independently confirm clientProfileId is really
 * the newly-signed-up user before calling create(), not assume the DB
 * layer enforces that for it. Same trust posture now applies to
 * accept()/decline()/assign() below -- see this file's header comment.
 */
export class LawyerInquiryRepository {
  constructor(private readonly client: SupabaseClient) {}

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

    // FLAGGED: raw error thrown, matching AnonymousAnalysisRepository's
    // existing (also-flagged) inconsistency with the service layer's
    // AppError wrapping -- same open question, not re-decided here.
    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Fetches a single inquiry row by id, or null if it doesn't exist --
   * including the "already declined" case, since decline() deletes
   * rather than marking status (§4.2), so a declined inquiry and a
   * never-existed one are indistinguishable at this layer. Whatever
   * calls this is responsible for deciding what a null result means in
   * context (e.g. accept() below treats it as "already gone, nothing to
   * accept").
   */
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
   * Transitions an inquiry from pending to accepted (§2 step 9).
   *
   * FLAGGED: does not verify the row's CURRENT status is 'pending'
   * before updating -- a straight unconditional update. This means
   * calling accept() on an already-'converted_to_case' inquiry would
   * silently move it back to 'accepted', which is a real regression the
   * status enum's own ordering implies shouldn't be possible. Left as a
   * flat update rather than adding a `.eq('status', 'pending')` guard
   * here because IF such a guard is added, the caller needs to be able
   * to distinguish "row not found" from "row found but not pending" --
   * Supabase's update().select().single() can't cleanly express that
   * distinction without a follow-up read. Flagged as the most
   * load-bearing gap in this file, not silently guarded one way.
   */
  async accept(inquiryId: string): Promise<LawyerInquiryRow> {
    const { data, error } = await this.client
      .from(TABLE)
      .update({ status: 'accepted' })
      .eq('id', inquiryId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Deletes an inquiry outright (§2 step 8, §4.2 resolved: decline has
   * no stored status or audit trail -- row deletion IS the decline
   * action, not a side effect of it).
   *
   * FLAGGED: returns void, not the deleted row -- there is nothing
   * meaningful to return once the row is gone. Supabase's delete()
   * doesn't return affected rows by default without a `.select()` added
   * first; not added here since nothing consumes it.
   */
  async decline(inquiryId: string): Promise<void> {
    const { error } = await this.client.from(TABLE).delete().eq('id', inquiryId);

    if (error) {
      throw error;
    }
  }

  /**
   * NEW -- hands a firm-targeted, unassigned inquiry over to a specific
   * lawyer (§4.1). Sets target_profile_id, assigned_by, and assigned_at
   * together, matching the scoping doc's §3.2 column notes exactly
   * ("Set alongside assigned_by").
   *
   * FLAGGED: no guard here on the row's CURRENT target_profile_id being
   * null, or its target_firm_id matching anything -- purely a raw
   * update by id, same posture as accept() above. The Service layer
   * (LawyerInquiryService#assignInquiry) is what decides whether
   * reassigning an already-assigned inquiry is allowed; this method
   * will happily overwrite an existing assignment if called on one.
   */
  async assign(inquiryId: string, input: AssignInquiryInput): Promise<LawyerInquiryRow> {
    const { data, error } = await this.client
      .from(TABLE)
      .update({
        target_profile_id: input.targetProfileId,
        assigned_by: input.assignedBy,
        assigned_at: new Date().toISOString(),
      })
      .eq('id', inquiryId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * NEW -- marks an inquiry converted, after a real cases row has
   * already been created elsewhere (§2 step 10, §4.5). Sets status to
   * 'converted_to_case' and case_id together, matching the scoping
   * doc's §3.2 note ("Set only on conversion").
   *
   * FLAGGED: this method does NOT create the case itself -- that's
   * CaseService#createCase(), called by LawyerInquiryService#convertInquiry()
   * BEFORE this method runs. This is purely the second half of a
   * two-step, non-transactional sequence (create the case, then mark
   * the inquiry converted) -- see the Service layer's own doc comment
   * for the accepted, not-solved risk if the second step fails after
   * the first succeeds.
   *
   * FLAGGED: no guard on the row's CURRENT status -- same posture as
   * accept()/assign() above. Calling this on an already-converted row
   * would silently overwrite case_id with whatever new value is passed.
   */
  async convert(inquiryId: string, caseId: string): Promise<LawyerInquiryRow> {
    const { data, error } = await this.client
      .from(TABLE)
      .update({ status: 'converted_to_case', case_id: caseId })
      .eq('id', inquiryId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }
}