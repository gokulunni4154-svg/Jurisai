// src/modules/tasks/task.factory.ts
//
// Mirrors case.factory.ts's confirmed real, corrected convention exactly:
// create<Module>Service-named, async, currentUser passed in as a
// required param (NOT self-fetched via getCurrentUser() — that was the
// prior, wrong convention case.factory.ts's own header documents having
// been corrected away from). Async here for the same forced reason
// case.factory.ts is async: TaskRepository needs the RLS-respecting
// client via `await createClient()`.
//
// Client choice per repository, matching case.factory.ts's real
// precedent directly:
//   - TaskRepository: RLS client (supabase) — tasks has real
//     client-writable RLS policies (tasks_select/insert/update/delete),
//     same reasoning as CaseRepository's own RLS-client choice.
//   - CaseRepository: RLS client (supabase) — reused from
//     case.factory.ts's own construction, needed by TaskService to look
//     up a case's owner_id/firm_id when a task is case-linked.
//   - CaseAccessGrantRepository: admin client — case_access_grants has
//     no client-writable RLS policy at all (service-layer-only writes),
//     matching case.factory.ts's own construction exactly.
//   - FirmMemberRepository: admin client — firm_members has no
//     client-writable RLS policy either, same reasoning, matching
//     case.factory.ts's own construction exactly.
//
// AMENDED, THIS SESSION — Case Timeline / Activity History
// instrumentation. createTaskService() now also constructs and passes
// AuditLogRepository (admin client, same reasoning as
// case.factory.ts's and hearing.factory.ts's identical amendments this
// session). task.service.ts's constructor gained the auditLogRepository
// param this session; this factory update is what actually wires it.

import { createClient } from '@/core/supabase/server';
import { createAdminClient } from '@/core/supabase/admin';
import type { AuthUser } from '@/core/auth/types';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import { CaseAccessGrantRepository } from '@/modules/cases/case-access-grant.repository';
import { CaseRepository } from '@/modules/cases/case.repository';
import { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';

import { TaskRepository } from './task.repository';
import { TaskService } from './task.service';

export async function createTaskService(currentUser: AuthUser | null): Promise<TaskService> {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const taskRepository = new TaskRepository(supabase);
  const caseRepository = new CaseRepository(supabase);
  const caseAccessGrantRepository = new CaseAccessGrantRepository(adminClient);
  const firmMemberRepository = new FirmMemberRepository(adminClient);
  const auditLogRepository = new AuditLogRepository(adminClient);

  return new TaskService(
    currentUser,
    taskRepository,
    caseRepository,
    caseAccessGrantRepository,
    firmMemberRepository,
    auditLogRepository,
  );
}