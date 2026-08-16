// src/modules/client-dashboard/client-dashboard.service.ts
//
// NEW MODULE — Client Portal, Client Dashboard / Client Home.
// Structural mirror of lawyer-dashboard.service.ts's confirmed real,
// pasted shape (self-scoped, no id param; requireRole() over the
// account's UserRole, not FirmRole; Promise.all over independent
// RLS-scoped reads; repositories constructed with the RLS-respecting
// client only, no admin client — see client-dashboard.factory.ts).
//
// WHY THIS SHAPE, NOT ClientService's (client.service.ts) admin-client
// pattern: ClientService is the FIRM-SIDE CRUD surface (owner/admin
// managing their firm's client roster) — its writes intentionally go
// through the admin client with service-layer-only authorization (see
// that file's own class doc comment on why). This service is the
// CLIENT'S OWN read-only view of themselves — the real, applied RLS
// this task's migration adds (clients_select_own, plus the three new
// additive policies in 20260916000000_add_client_portal_visibility.sql)
// already does the narrowing correctly for a 'client'-role caller, so
// there is no reason to bypass it here. Matches lawyer-dashboard's own
// "all three repositories are RLS-client-only" posture.
//
// SCOPE, this task (STEP 5/10 of the brief — do not invent a giant
// portal): identity (the caller's own `clients` row + their firm's
// name), every case visible to them (now real, via
// cases_select_client_own), and every upcoming hearing visible to them
// (now real, via hearings_select_client_own). Documents and
// notifications are DELIBERATELY NOT included — no RLS path exists
// yet for a client to read case_documents/documents or a meaningful
// notifications feed (notifications.document_id is NOT NULL and
// nothing in this project creates a notification row for a client
// today — see this task's final report, "Remaining Work"). Not silently
// dropped: flagged there as follow-up work requiring its own RLS
// decision, matching this file's own restraint on scope.

import 'server-only';

import { BaseService } from '@/core/services/base.service';
import type { AuthUser } from '@/core/auth/types';
import { AuthorizationError } from '@/core/errors/app-error';
import type { Database } from '@/core/supabase/database.types';
import type { ClientRepository } from '@/modules/user-management/client.repository';
import type { CaseRepository } from '@/modules/cases/case.repository';
import type { HearingRepository } from '@/modules/hearings/hearing.repository';
import type { FirmRepository } from '@/modules/billing/firm.repository';

type ClientRow = Database['public']['Tables']['clients']['Row'];
type CaseRow = Database['public']['Tables']['cases']['Row'];
type HearingRow = Database['public']['Tables']['hearings']['Row'];

export interface ClientDashboardData {
  client: ClientRow;
  firmName: string | null;
  cases: CaseRow[];
  upcomingHearings: HearingRow[];
}

export class ClientDashboardService extends BaseService {
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
   * Returns the current client's dashboard data: their own `clients`
   * row, their firm's name (now readable via the new
   * firms_select_client policy), every case RLS lets them see (in
   * practice, exactly their own client-linked cases — a client is
   * never a case owner_id or case_access_grants grantee), and every
   * upcoming hearing RLS lets them see (same narrowing, via
   * hearings_select_client_own).
   *
   * Gated on UserRole === 'client' first (401/403 via requireRole(),
   * matching every other dashboard's own gate) — but role alone does
   * not guarantee a linked `clients` row exists (see
   * ClientRepository#findByProfileId()'s own doc comment: an
   * authenticated 'client'-role account with no completed link is a
   * real, if unusual, possible state). Rather than let that surface as
   * a confusing empty dashboard, this throws a clear
   * AuthorizationError so the caller can render an explicit
   * "not linked to a client record yet" state instead of a
   * silently-empty one.
   */
  async getDashboard(): Promise<ClientDashboardData> {
    const user = this.requireRole('client');

    const client = await this.clientRepository.findByProfileId(user.id);

    if (!client) {
      throw new AuthorizationError(
        'Your account is not yet linked to a client record. Please contact your firm.',
        { userId: user.id },
      );
    }

    const [cases, upcomingHearings, firm] = await Promise.all([
      this.caseRepository.findManyVisible(),
      this.hearingRepository.findUpcoming(new Date().toISOString()),
      this.firmRepository.findById(client.firm_id),
    ]);

    return {
      client,
      firmName: firm?.name ?? null,
      cases,
      upcomingHearings,
    };
  }
}
