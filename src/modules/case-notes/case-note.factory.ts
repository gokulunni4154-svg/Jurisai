// src/modules/case-notes/case-note.factory.ts
//
// Mirrors task.factory.ts's confirmed real, corrected convention
// exactly: create<Module>Service-named, async, currentUser passed in
// as a required param. Async for the same forced reason
// task.factory.ts/case.factory.ts are async: CaseNoteRepository needs
// the RLS-respecting client via `await createClient()`.
//
// Client choice per repository, matching task.factory.ts's own
// construction directly:
//   - CaseNoteRepository: RLS client (supabase) — case_notes has
//     client-writable RLS policies (see the migration), same reasoning
//     as TaskRepository's own RLS-client choice.
//   - CaseRepository: RLS client (supabase) — reused from
//     task.factory.ts's own construction, needed by CaseNoteService to
//     look up a case's owner_id/firm_id.
//   - CaseAccessGrantRepository: admin client — case_access_grants has
//     no client-writable RLS policy at all (service-layer-only
//     writes), matching task.factory.ts's own construction exactly.
//   - AuditLogRepository: admin client, same reasoning as
//     task.factory.ts's/case.factory.ts's identical construction.

import { createClient } from '@/core/supabase/server';
import { createAdminClient } from '@/core/supabase/admin';
import type { AuthUser } from '@/core/auth/types';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import { CaseAccessGrantRepository } from '@/modules/cases/case-access-grant.repository';
import { CaseRepository } from '@/modules/cases/case.repository';

import { CaseNoteRepository } from './case-note.repository';
import { CaseNoteService } from './case-note.service';

export async function createCaseNoteService(
  currentUser: AuthUser | null,
): Promise<CaseNoteService> {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const caseNoteRepository = new CaseNoteRepository(supabase);
  const caseRepository = new CaseRepository(supabase);
  const caseAccessGrantRepository = new CaseAccessGrantRepository(adminClient);
  const auditLogRepository = new AuditLogRepository(adminClient);

  return new CaseNoteService(
    currentUser,
    caseNoteRepository,
    caseRepository,
    caseAccessGrantRepository,
    auditLogRepository,
  );
}