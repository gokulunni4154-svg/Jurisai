// src/modules/reports/reports.factory.ts
// Reports & Analytics — Phase 4. Factory construction, mirroring
// case.factory.ts's confirmed real pattern (async createXService, RLS
// client via createClient() where a repository needs it, admin client
// via createAdminClient() where it doesn't).
//
// SOURCE VERIFICATION NOTE: ReportsRepository (this session's own File
// 1) constructs its own admin client internally rather than taking one
// via constructor injection -- a real deviation from CaseRepository's
// shape (case.factory.ts injects `supabase` into `new CaseRepository(supabase)`).
// Flagged, not silently normalized: every OTHER repository this project
// has real pasted source for (CaseRepository, TeamMemberRepository,
// FirmMemberRepository, CaseAccessGrantRepository, AuditLogRepository,
// DocumentRepository) takes its client via the constructor, following
// BaseRepository's own confirmed shape (constructor protected). Since
// ReportsRepository was deliberately built to NOT extend BaseRepository
// (File 1's own header explains why -- no single-table fit), it also
// doesn't inherit that constructor-injection convention. This factory
// still calls `new ReportsRepository()` with no arguments to match File
// 1's real, already-delivered constructor -- changing that constructor
// to accept an injected client instead would be a File 1 revision, not
// something to silently paper over here by pretending the signature is
// different than what was actually delivered.
//
// This function is `async` for signature-consistency with every other
// create*Service() in this project (case.factory.ts's own header notes
// its async-ness is "forced," not a stylistic choice) even though
// ReportsService itself has no async construction step today --
// FirmMemberRepository still needs the admin client at construction
// time via createAdminClient(), which is itself synchronous, so nothing
// here actually awaits anything. Kept async anyway for call-site
// consistency with createCaseService()/createFirmService() (both
// awaited by every route that calls them) rather than introducing the
// only sync create*Service() in the project -- a real, deliberate
// judgment call, not an oversight.

import { createAdminClient } from '@/core/supabase/admin';
import type { AuthUser } from '@/core/auth/types';
import { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';

import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

export async function createReportsService(currentUser: AuthUser | null): Promise<ReportsService> {
  const adminClient = createAdminClient();

  const reportsRepository = new ReportsRepository();
  const firmMemberRepository = new FirmMemberRepository(adminClient);

  return new ReportsService(currentUser, reportsRepository, firmMemberRepository);
}