// Real path (still a best guess on the exact directory, matching this
// project's confirmed src/modules/<module>/ flat convention): 
// src/modules/case-timeline/case-timeline.factory.ts
//
// AMENDED, THIS SESSION — WIRING PATTERN NOW CONFIRMED, caveat downgraded.
// This file was originally written before any real factory file had been
// pasted into this thread, so its shape was reconstructed purely from
// route.ts call sites (e.g. `await createHearingService(currentUser)`)
// and flagged as unverified. Real, pasted case.factory.ts/
// hearing.factory.ts/task.factory.ts (this session) now confirm the
// wiring convention this file already guessed correctly: async,
// create<Module>Service-named, currentUser passed in as a required
// param, `createClient()` for RLS-scoped repositories and
// `createAdminClient()` for admin-only ones. No structural change made
// to this file as a result -- the guess held up -- but the "unverified
// pattern" framing is removed since it's no longer accurate.
//
// STILL UNVERIFIED: the exact real file path/directory
// (src/modules/case-timeline/ vs. some other location) and the exact
// import path for createAdminClient, since no admin.ts source has ever
// been independently pasted -- only referenced in other files' header
// comments. Flag if either turns out to differ.
//
// Client choice per dependency, matching each repository's own
// documented posture, and now also matching the real factories' same
// choices for the identical repositories:
//   - CaseRepository: RLS-respecting client (case.repository.ts's own
//     header: "RLS-ONLY, NO ADMIN CLIENT"; case.factory.ts's real,
//     pasted source constructs it with `supabase`, not `adminClient`,
//     confirming this).
//   - CaseAccessGrantRepository: admin client (case.factory.ts's real,
//     pasted source confirms this exactly).
//   - AuditLogRepository: admin client (case.factory.ts's real, pasted
//     source confirms this exactly; also audit-log.repository.ts's own
//     header: "no RLS read policy yet").

import { createClient } from '@/core/supabase/server';
import { createAdminClient } from '@/core/supabase/admin';
import type { AuthUser } from '@/core/auth/types';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import { CaseAccessGrantRepository } from '@/modules/cases/case-access-grant.repository';
import { CaseRepository } from '@/modules/cases/case.repository';

import { CaseTimelineService } from './case-timeline.service';

export async function createCaseTimelineService(
  currentUser: AuthUser | null,
): Promise<CaseTimelineService> {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const caseRepository = new CaseRepository(supabase);
  const caseAccessGrantRepository = new CaseAccessGrantRepository(adminClient);
  const auditLogRepository = new AuditLogRepository(adminClient);

  return new CaseTimelineService(
    currentUser,
    auditLogRepository,
    caseRepository,
    caseAccessGrantRepository,
  );
}