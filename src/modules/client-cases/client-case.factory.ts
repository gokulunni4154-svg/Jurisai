// src/modules/client-cases/client-case.factory.ts
//
// NEW FILE — Client Portal Phase 2, Client Matter / Case Workspace.
// Mirrors client-dashboard.factory.ts's confirmed real convention
// exactly: createXService-named, async, currentUser passed in as a
// required param (not self-fetched). Async for the same forced reason
// client-dashboard.factory.ts is async: repositories need the
// RLS-respecting client via `await createClient()`.
//
// ALL FOUR repositories are constructed against the RLS-respecting
// client, NO admin client anywhere in this factory — same deliberate
// choice client-dashboard.factory.ts's own header explains: this
// module leans on the confirmed-live additive RLS policies
// (cases_select_client_own, hearings_select_client_own,
// firms_select_client) rather than an admin-client +
// service-layer-authorization pattern. ClientRepository specifically
// must stay RLS-client here, not admin — see
// ClientRepository#findByProfileId()'s own doc comment: that method's
// safety depends entirely on being called against a client that
// enforces clients_select_own.

import { createClient } from '@/core/supabase/server';
import type { AuthUser } from '@/core/auth/types';
import { ClientRepository } from '@/modules/user-management/client.repository';
import { CaseRepository } from '@/modules/cases/case.repository';
import { HearingRepository } from '@/modules/hearings/hearing.repository';
import { FirmRepository } from '@/modules/billing/firm.repository';

import { ClientCaseService } from './client-case.service';

export async function createClientCaseService(
  currentUser: AuthUser | null,
): Promise<ClientCaseService> {
  const supabase = await createClient();

  const clientRepository = new ClientRepository(supabase);
  const caseRepository = new CaseRepository(supabase);
  const hearingRepository = new HearingRepository(supabase);
  const firmRepository = new FirmRepository(supabase);

  return new ClientCaseService(
    currentUser,
    clientRepository,
    caseRepository,
    hearingRepository,
    firmRepository,
  );
}
