// FIX, tsc pass — was '@/lib/supabase/admin' (TS2307, module not found).
// Same wrong-path guess as lawyer-inquiry.factory.ts's identical bug,
// now fixed twice against the same confirmed real source
// (document.factory.ts's own working Amendment #15 import).
import { createAdminClient } from '@/core/supabase/admin';

import { AnonymousAnalysisRepository } from './anonymous-analysis.repository';
import { AnonymousAnalysisService } from './anonymous-analysis.service';
import { LawyerInquiryRepository } from './lawyer-inquiry.repository';

/**
 * Builds an AnonymousAnalysisService wired to the admin (service-role)
 * Supabase client — deliberately not the RLS-respecting server client
 * every other factory in this project uses (e.g. buildDocumentService()),
 * because the whole point of the anon-upload design (this session's
 * chat / scoping doc §4.3) is that there is no auth.uid() for RLS to
 * check against here. Both the Storage write and the
 * anonymous_analysis_sessions row write go through this same admin
 * client, matching anonymous_analysis_sessions' own migration comment
 * that the table has zero client-facing RLS policies by design.
 *
 * RESOLVED, tsc pass — `createAdminClient`'s name and path are no longer
 * invented. document.factory.ts's real, pasted source confirms both:
 * `createAdminClient` from `@/core/supabase/admin`, a cached
 * module-level service-role client. This file previously guessed
 * `@/lib/supabase/admin`, the same wrong path lawyer-inquiry.factory.ts
 * independently guessed — now corrected against real confirmed source,
 * not left as an open assumption.
 */
export async function buildAnonymousAnalysisService(): Promise<AnonymousAnalysisService> {
  const adminClient = createAdminClient();
  const repository = new AnonymousAnalysisRepository(adminClient);
  const lawyerInquiryRepository = new LawyerInquiryRepository(adminClient);

  return new AnonymousAnalysisService({
    repository,
    storageClient: adminClient,
    lawyerInquiryRepository,
  });
}