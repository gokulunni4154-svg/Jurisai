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

import type { SupabaseClient } from '@supabase/supabase-js';

// FLAGGED: hand-typed to match the migration column-for-column, same
// caveat as AnonymousAnalysisSessionRow -- no generated-types
// convention confirmed against pasted source this session.
interface LawyerInquiryRow {
  id: string;
  client_profile_id: string;
  target_profile_id: string | null;
  target_firm_id: string;
  team_id: string | null;
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
  // NEW: caller-supplied, matching CaseService#createCase()'s own
  // "teamId is explicit input, never inferred" posture. Null is valid --
  // a solo-firm or no-team inquiry stays team_id: null through
  // assignment and conversion, same as a solo case.
  teamId: string | null;
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
   * NEW -- lists every inquiry currently assigned to a specific lawyer
   * (target_profile_id = targetProfileId), most recent first. Built for
   * the Lawyer Terminal "My Inquiries" gap (accept/decline/convert all
   * pre-existed with zero list/read entry point for the lawyer they act
   * on) -- see lawyer-inquiry.service.ts's listMyInquiries() and the
   * accompanying implementation report for the full audit writeup.
   *
   * FLAGGED, same trust posture as create() above (this file's own
   * header comment): targetProfileId is passed in and trusted, not
   * derived from anything this repository method checks itself --
   * whatever calls this (LawyerInquiryService#listMyInquiries()) is
   * responsible for passing the AUTHENTICATED caller's own id, never a
   * client-supplied one. This mirrors lawyer_inquiries' own real SELECT
   * RLS policy (lawyer_inquiries_select_assigned_lawyer: `target_profile_id
   * = auth.uid()`), even though this repository is constructed with the
   * admin client (RLS bypassed) -- the filter here is what actually
   * enforces the same boundary the RLS policy would, for the one caller
   * (the Service layer) that is expected to ever invoke this method with
   * anything other than a self-scoped id.
   *
   * No status filter -- returns pending, accepted, AND converted_to_case
   * rows for this lawyer. The UI consuming this can filter/group
   * client-side; keeping this method's own contract simple (one lawyer's
   * full inquiry history) avoids inventing a query-param shape with no
   * existing precedent elsewhere in this file.
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
   * NEW -- General User Terminal, "My Sent Inquiries" gap. Lists every
   * inquiry SENT BY a specific sender (client_profile_id =
   * senderProfileId), most recent first. Mirrors listForTargetProfile()
   * above field-for-field (same query shape, same trust posture, same
   * "no status filter, let the caller filter/group client-side"
   * decision) -- the only difference is which column is filtered on:
   * client_profile_id (who sent it) instead of target_profile_id (who
   * it's assigned to). Confirmed against this table's real, live SELECT
   * RLS this session (`lawyer_inquiries_select_client`: client_profile_id
   * = auth.uid()) -- that policy already covers exactly this access
   * pattern, so no RLS change was needed for this method to be safe in
   * principle. It still doesn't rely on that policy directly, though:
   * this repository is always constructed with the admin client (RLS
   * bypassed -- see this file's own header comment), so the
   * `.eq('client_profile_id', senderProfileId)` filter below is what
   * actually enforces the boundary the RLS policy would, not the policy
   * itself.
   *
   * FLAGGED, same trust posture as listForTargetProfile() above:
   * senderProfileId is passed in and trusted, not derived from anything
   * this repository method checks itself -- whatever calls this
   * (LawyerInquiryService#listMySentInquiries()) is responsible for
   * passing the AUTHENTICATED caller's own id, never a client-supplied
   * one.
   */
  async listForSenderProfile(senderProfileId: string): Promise<LawyerInquiryRow[]> {
    const { data, error } = await this.client
      .from(TABLE)
      .select('*')
      .eq('client_profile_id', senderProfileId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data ?? [];
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
   * Hands a firm-targeted, unassigned inquiry over to a specific lawyer
   * (§4.1). Sets target_profile_id, assigned_by, assigned_at, AND
   * team_id together -- team_id is NEW this revision, closing the gap
   * that made convertInquiry()'s team-lead path permanently unreachable
   * (see migration 20260810000000's own comment, and
   * lawyer-inquiry.service.ts's convertInquiry() doc comment).
   *
   * team_id is caller-supplied via AssignInquiryInput, not derived from
   * anything -- null is a valid, expected value (a solo-firm or no-team
   * inquiry).
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
        team_id: input.teamId,
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
   * Marks an inquiry converted, after a real cases row has already been
   * created elsewhere (§2 step 10, §4.5). Sets status to
   * 'converted_to_case' and case_id together, matching the scoping
   * doc's §3.2 note ("Set only on conversion"). Does NOT touch team_id --
   * that's already been set at assign() time by the point convert() runs.
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