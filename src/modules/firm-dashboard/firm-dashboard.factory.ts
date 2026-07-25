// Real path: FLAGGED, UNVERIFIED -- src/modules/firm-dashboard/firm-dashboard.factory.ts

import { createAdminClient } from '@/core/supabase/admin';
import type { AuthUser } from '@/core/auth/types';

import { CaseRepository } from '@/modules/cases/case.repository';
import { TaskRepository } from '@/modules/tasks/task.repository';
import { HearingRepository } from '@/modules/hearings/hearing.repository';
import { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';
import { FirmDashboardService } from './firm-dashboard.service';

/**
 * NEW, Phase 4 — Firm Dashboard.
 *
 * UNLIKE lawyer-dashboard.factory.ts (prior session), which constructed
 * every repository against the RLS-respecting client (self-scoped reads
 * are naturally covered by each table's own RLS), this factory
 * constructs ALL FOUR repositories -- CaseRepository, TaskRepository,
 * HearingRepository, AND FirmMemberRepository -- against
 * createAdminClient(). This is a deliberate, flagged departure, not a
 * copy-paste of lawyer-dashboard.factory.ts's pattern:
 *
 *   1. FirmMemberRepository already requires the admin client, same
 *      reasoning firm-member.factory.ts and firm.factory.ts both
 *      already establish (firm_members has no client-writable RLS
 *      policy for the writes those factories support; the read path
 *      used here, findByFirmAndProfile(), is constructed against the
 *      same admin client those factories already use for consistency,
 *      not because a read-only RLS policy is missing -- firm_members
 *      does have SELECT policies. Matching the existing admin-client
 *      convention for this repository regardless.)
 *
 *   2. CaseRepository, TaskRepository, and HearingRepository are all
 *      normally RLS-scoped elsewhere in this project. They are
 *      constructed against the admin client HERE ONLY, specifically for
 *      this factory's firm-wide query methods
 *      (findByFirmId()/findUpcomingByFirmId()) -- see each of those
 *      methods' own doc comments in their respective repository files
 *      for the full reasoning: their RLS policies were not
 *      independently re-confirmed this session for a firm-wide,
 *      cross-member query shape, so FirmDashboardService's own
 *      requireManageAccess(firmId) check is the sole authorization gate
 *      for this dashboard, not RLS. Do not reuse these same repository
 *      instances for any other purpose that expects RLS-narrowed
 *      results.
 */
export function createFirmDashboardService(currentUser: AuthUser | null): FirmDashboardService {
  const adminClient = createAdminClient();

  const caseRepository = new CaseRepository(adminClient);
  const taskRepository = new TaskRepository(adminClient);
  const hearingRepository = new HearingRepository(adminClient);
  const firmMemberRepository = new FirmMemberRepository(adminClient);

  return new FirmDashboardService(
    currentUser,
    caseRepository,
    taskRepository,
    hearingRepository,
    firmMemberRepository,
  );
}