// src/modules/client-dashboard/client-dashboard.factory.ts
//
// NEW FILE — Client Portal, Client Dashboard. Mirrors
// lawyer-dashboard.factory.ts's confirmed real, corrected convention
// exactly: createXService-named, async, currentUser passed in as a
// required param. Async for the same forced reason
// lawyer-dashboard.factory.ts is async: repositories need the
// RLS-respecting client via `await createClient()`.
//
// ALL FOUR repositories are constructed against the RLS-respecting
// client, NO admin client anywhere in this factory — deliberate, see
// client-dashboard.service.ts's own header for why this dashboard
// leans on the new additive RLS policies
// (20260916000000_add_client_portal_visibility.sql) rather than the
// admin-client + service-layer-authorization pattern client.factory.ts
// (the firm-side CRUD surface) uses. ClientRepository specifically
// must be RLS-client here, not admin — see
// ClientRepository#findByProfileId()'s own doc comment: that method's
// safety depends entirely on being called against a client that
// enforces clients_select_own.

import { createClient } from '@/core/supabase/server';
import type { AuthUser } from '@/core/auth/types';
import { ClientRepository } from '@/modules/user-management/client.repository';
import { CaseRepository } from '@/modules/cases/case.repository';
import { HearingRepository } from '@/modules/hearings/hearing.repository';
import { FirmRepository } from '@/modules/billing/firm.repository';

import { ClientDashboardService } from './client-dashboard.service';

export async function createClientDashboardService(
  currentUser: AuthUser | null,
): Promise<ClientDashboardService> {
  const supabase = await createClient();

  const clientRepository = new ClientRepository(supabase);
  const caseRepository = new CaseRepository(supabase);
  const hearingRepository = new HearingRepository(supabase);
  const firmRepository = new FirmRepository(supabase);

  return new ClientDashboardService(
    currentUser,
    clientRepository,
    caseRepository,
    hearingRepository,
    firmRepository,
  );
}
