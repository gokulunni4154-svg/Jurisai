// Real path: src/modules/hearings/hearing.factory.ts
//
// Mirrors task.factory.ts exactly: async, currentUser passed in as a
// required param (not self-fetched). Client choice per repository,
// same reasoning as task.factory.ts:
//   - HearingRepository: RLS client -- hearings has real client-
//     writable RLS policies.
//   - CaseRepository: RLS client -- reused, needed to look up a case's
//     owner_id/firm_id.
//   - CaseAccessGrantRepository: admin client -- case_access_grants has
//     no client-writable RLS policy (service-layer-only writes).
//
// FirmMemberRepository is deliberately NOT constructed here, unlike
// task.factory.ts -- hearings have no standalone (case_id null) path,
// so HearingService never needs a firm-membership check.
//
// AMENDED, THIS SESSION — Case Timeline / Activity History
// instrumentation. createHearingService() now also constructs and
// passes AuditLogRepository (admin client, same reasoning as
// audit-log.repository.ts's own header: no RLS read policy on
// audit_log yet), matching case.factory.ts's own identical amendment
// this session. hearing.service.ts's constructor gained the
// auditLogRepository param this session; this factory update is what
// actually wires it, or HearingService construction would fail to
// compile against its new signature.

import { createClient } from '@/core/supabase/server';
import { createAdminClient } from '@/core/supabase/admin';
import type { AuthUser } from '@/core/auth/types';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import { CaseAccessGrantRepository } from '@/modules/cases/case-access-grant.repository';
import { CaseRepository } from '@/modules/cases/case.repository';

import { HearingRepository } from './hearing.repository';
import { HearingService } from './hearing.service';

export async function createHearingService(currentUser: AuthUser | null): Promise<HearingService> {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const hearingRepository = new HearingRepository(supabase);
  const caseRepository = new CaseRepository(supabase);
  const caseAccessGrantRepository = new CaseAccessGrantRepository(adminClient);
  const auditLogRepository = new AuditLogRepository(adminClient);

  return new HearingService(
    currentUser,
    hearingRepository,
    caseRepository,
    caseAccessGrantRepository,
    auditLogRepository,
  );
}