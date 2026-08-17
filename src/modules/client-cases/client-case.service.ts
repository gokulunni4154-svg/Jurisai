// src/modules/client-cases/client-case.service.ts
//
// NEW MODULE — Client Portal Phase 2, Client Matter / Case Workspace
// (per JurisAI_Architecture_Audit.md). This is deliberately a SEPARATE,
// narrow service — NOT a modification of CaseService — matching the
// brief's own instruction: "If the existing CaseService.getCase() is
// fundamentally lawyer-scoped and cannot safely be reused, create a
// minimal client-specific read method rather than modifying lawyer
// behavior unnecessarily."
//
// STRUCTURAL MIRROR of client-dashboard.service.ts (the other real,
// confirmed Client Portal service): requireRole('client') first, then
// confirm a real linked `clients` row exists via
// ClientRepository#findByProfileId() (RLS-client-only, same reasoning
// as that file's own header), then read through RLS-scoped repositories
// only — no admin client anywhere in this module, same posture as
// client-dashboard.factory.ts.
//
// THE REAL AUTHORIZATION BOUNDARY IS RLS, CONFIRMED LIVE THIS SESSION —
// not assumed, not newly added here. Queried directly against the real
// Supabase project (pg_policies + pg_proc):
//   - cases.cases_select_client_own:
//       (jwt->app_metadata->>role = 'client') AND is_case_client(id)
//   - is_case_client(p_case_id) [SECURITY DEFINER]:
//       exists (select 1 from cases c join clients cl on cl.id = c.client_id
//               where c.id = p_case_id and cl.profile_id = auth.uid())
//   - hearings.hearings_select_client_own: same shape, one hop further
//     via is_case_client(case_id).
// Both are ADDITIVE policies (20260916000000_add_client_portal_visibility.sql)
// that sit alongside the existing owner/grant/firm-admin policies on
// each table, unmodified. This service does not duplicate that chain in
// application code — it relies on it, exactly like
// ClientDashboardService#getDashboard() already does for the dashboard
// list. `caseId` is accepted as a plain object identifier (per the
// brief's own framing: "the case ID is an object identifier, NOT an
// authorization credential") — a case this client isn't linked to is
// invisible under RLS and surfaces as NotFoundError, not a distinct
// 403, matching this project's existing "don't leak existence to an
// unauthorized caller" posture (documents/document_sets/cases' own
// getCaseById()).
//
// CURATED RESPONSE SHAPE, DELIBERATE: does NOT return the raw `cases`
// row. `owner_id`/`team_id`/`firm_id` are internal lawyer-side
// identifiers with no client-facing purpose — per the brief's own
// instruction ("Do not return internal lawyer-only fields and rely on
// the frontend to hide them"), they're dropped here at the Service
// layer, not filtered client-side.
//
// HEARINGS: reuses HearingRepository#findByCaseId() UNMODIFIED — it's
// already RLS-scoped (see file header: "RLS on the underlying table
// already restricts this to rows the caller's session can see"), and
// hearings_select_client_own extends that same restriction to a linked
// client. `notes` is deliberately EXCLUDED from the mapped shape below
// — it's a free-text field lawyers use for their own working notes on
// a hearing, not confirmed anywhere as client-appropriate content (the
// brief: "Do not expose lawyer-internal information"); `outcome` is
// included, matching the brief's explicit "status/result if already
// available".
//
// DOCUMENTS AND CASE NOTES ARE DELIBERATELY NOT TOUCHED HERE — per the
// brief's own explicit scope boundary ("Do NOT implement client
// document access in this task"). Confirmed live this session: neither
// `case_documents` nor `case_notes` has any client-facing RLS policy at
// all, so there is no safe read path to add even optionally. Not a gap
// this file works around — see final report's "Remaining Work".

import 'server-only';

import { BaseService } from '@/core/services/base.service';
import type { AuthUser } from '@/core/auth/types';
import { AuthorizationError } from '@/core/errors/app-error';
import type { ClientRepository } from '@/modules/user-management/client.repository';
import type { CaseRepository } from '@/modules/cases/case.repository';
import type { HearingRepository } from '@/modules/hearings/hearing.repository';
import type { FirmRepository } from '@/modules/billing/firm.repository';

export interface ClientCaseHearing {
  id: string;
  hearingDate: string;
  hearingType: string;
  courtName: string | null;
  location: string | null;
  outcome: string | null;
}

export interface ClientCaseDetail {
  id: string;
  title: string;
  status: string;
  caseNumber: string | null;
  createdAt: string;
  updatedAt: string;
  firmName: string | null;
  hearings: ClientCaseHearing[];
}

export class ClientCaseService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly clientRepository: ClientRepository,
    private readonly caseRepository: CaseRepository,
    private readonly hearingRepository: HearingRepository,
    private readonly firmRepository: FirmRepository,
  ) {
    super(currentUser);
  }

  /**
   * Returns a single case's client-appropriate detail, plus its
   * hearings, for the CURRENT authenticated client only.
   *
   * Gated on UserRole === 'client' first (401/403 via requireRole()),
   * matching ClientDashboardService#getDashboard()'s exact gate. Role
   * alone does not guarantee a linked `clients` row exists — same
   * "not a real permissions error, an actionable state" distinction
   * that file's own doc comment makes, surfaced identically here so the
   * client page can render the same explicit "not linked yet" state it
   * already handles for the dashboard.
   *
   * Does NOT independently re-check that this client owns this case —
   * deliberately, matching every other RLS-backstopped read in this
   * project (HearingService#listHearingsForCase's own doc comment:
   * "does not independently re-check access... RLS already scopes what
   * comes back"). `findByIdOrThrow()` runs through the RLS-respecting
   * client (see client-case.factory.ts) — cases_select_client_own is
   * the actual enforcement point; a case belonging to a different
   * client, or with no client_id at all, is simply not visible and
   * throws NotFoundError here, never leaking whether the id exists.
   */
  async getCaseForClient(caseId: string): Promise<ClientCaseDetail> {
    const user = this.requireRole('client');

    const client = await this.clientRepository.findByProfileId(user.id);

    if (!client) {
      throw new AuthorizationError(
        'Your account is not yet linked to a client record. Please contact your firm.',
        { userId: user.id },
      );
    }

    const caseRow = await this.caseRepository.findByIdOrThrow(caseId);

    const [hearings, firm] = await Promise.all([
      this.hearingRepository.findByCaseId(caseRow.id),
      this.firmRepository.findById(client.firm_id),
    ]);

    return {
      id: caseRow.id,
      title: caseRow.title,
      status: caseRow.status,
      caseNumber: caseRow.case_number,
      createdAt: caseRow.created_at,
      updatedAt: caseRow.updated_at,
      firmName: firm?.name ?? null,
      hearings: hearings.map((hearing) => ({
        id: hearing.id,
        hearingDate: hearing.hearing_date,
        hearingType: hearing.hearing_type,
        courtName: hearing.court_name,
        location: hearing.location,
        outcome: hearing.outcome,
      })),
    };
  }
}
