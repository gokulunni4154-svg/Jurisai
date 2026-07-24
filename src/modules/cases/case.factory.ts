// src/modules/cases/case.factory.ts
//
// CORRECTED: previous revision used buildCaseService()/buildCaseAccessGrantService(),
// async with no params, self-fetching currentUser via getCurrentUser().
// That contradicted the confirmed real convention (team-member.factory.ts,
// firm-member.factory.ts): create*-named, currentUser passed in as a
// required param, not self-fetched. Renamed/re-signed to match. Still
// `async` here (unlike team-member.factory.ts, which is fully sync)
// because CaseRepository requires the RLS-respecting client via
// `await createClient()` — the async-ness is forced by that, not a
// convention violation.
//
// CaseService now also takes CaseAccessGrantRepository as a dependency
// (see case.service.ts's addDocumentToCase() change, Decision #61) —
// constructed here with the admin client, same reasoning as
// case-access-grant.repository.ts's own header.

import { createClient } from '@/core/supabase/server';
import { createAdminClient } from '@/core/supabase/admin';
import type { AuthUser } from '@/core/auth/types';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import { DocumentRepository } from '@/modules/documents/document.repository';
import { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';
import { TeamMemberRepository } from '@/modules/user-management/team-member.repository';

import { CaseAccessGrantRepository } from './case-access-grant.repository';
import { CaseAccessGrantService } from './case-access-grant.service';
import { CaseRepository } from './case.repository';
import { CaseService } from './case.service';

export async function createCaseService(currentUser: AuthUser | null): Promise<CaseService> {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const caseRepository = new CaseRepository(supabase);
  const teamMemberRepository = new TeamMemberRepository(adminClient);
  const firmMemberRepository = new FirmMemberRepository(adminClient);
  const documentRepository = new DocumentRepository(supabase);
  const caseAccessGrantRepository = new CaseAccessGrantRepository(adminClient);

  return new CaseService(
    currentUser,
    caseRepository,
    teamMemberRepository,
    firmMemberRepository,
    documentRepository,
    caseAccessGrantRepository,
  );
}

export async function createCaseAccessGrantService(currentUser: AuthUser | null): Promise<CaseAccessGrantService> {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const caseAccessGrantRepository = new CaseAccessGrantRepository(adminClient);
  const caseRepository = new CaseRepository(supabase);
  const teamMemberRepository = new TeamMemberRepository(adminClient);
  const firmMemberRepository = new FirmMemberRepository(adminClient);
  const auditLogRepository = new AuditLogRepository(adminClient);

  return new CaseAccessGrantService(
    currentUser,
    caseAccessGrantRepository,
    caseRepository,
    teamMemberRepository,
    firmMemberRepository,
    auditLogRepository,
  );
}