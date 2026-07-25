// src/modules/lawyer-dashboard/lawyer-dashboard.factory.ts
//
// NEW FILE, THIS SESSION. Mirrors case-note.factory.ts's confirmed
// real, corrected convention exactly: createXService-named, async,
// currentUser passed in as a required param. Async for the same forced
// reason case-note.factory.ts/task.factory.ts are async: repositories
// need the RLS-respecting client via `await createClient()`.
//
// Client choice per repository -- SIMPLER than case-note.factory.ts's
// mixed RLS/admin construction, because all three repositories this
// service needs are RLS-client-only, confirmed individually from each
// file's own pasted header this session:
//   - CaseRepository: RLS client -- "RLS-ONLY, NO ADMIN CLIENT" per
//     that file's own header comment.
//   - TaskRepository: RLS client -- confirmed in that file's own
//     header ("RLS-scoped client (not admin) -- tasks DOES have
//     client-writable RLS policies").
//   - HearingRepository: RLS client -- confirmed in that file's own
//     header ("RLS-scoped client (not admin)").
//
// No admin client constructed at all in this factory -- unlike
// case-note.factory.ts, which needs createAdminClient() for
// CaseAccessGrantRepository and AuditLogRepository. Neither of those
// two repositories is used by LawyerDashboardService, so there is no
// admin-client need here. If audit logging of dashboard views is ever
// required, that would reintroduce an AuditLogRepository (admin
// client) dependency -- not done here, since no such requirement has
// been raised.

import { createClient } from '@/core/supabase/server';
import type { AuthUser } from '@/core/auth/types';
import { CaseRepository } from '@/modules/cases/case.repository';
import { TaskRepository } from '@/modules/tasks/task.repository';
import { HearingRepository } from '@/modules/hearings/hearing.repository';

import { LawyerDashboardService } from './lawyer-dashboard.service';

export async function createLawyerDashboardService(
  currentUser: AuthUser | null,
): Promise<LawyerDashboardService> {
  const supabase = await createClient();

  const caseRepository = new CaseRepository(supabase);
  const taskRepository = new TaskRepository(supabase);
  const hearingRepository = new HearingRepository(supabase);

  return new LawyerDashboardService(
    currentUser,
    caseRepository,
    taskRepository,
    hearingRepository,
  );
}