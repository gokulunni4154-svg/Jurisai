import { createAdminClient } from '@/lib/supabase/admin';

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
 * FLAGGED: `createAdminClient` — name and import path invented. No
 * existing admin-client instantiation was found in pasted source this
 * session; every other factory-related file seen used the RLS-respecting
 * server client. The scoping doc's own gap list flags that server-role
 * Supabase usage elsewhere in this project (cron/system writes,
 * document_analyses completion) was never independently pasted either —
 * so this isn't just this file's assumption, it's inherited from an
 * upstream gap. If the real helper has a different name/path, only this
 * one import line needs correcting, not AnonymousAnalysisService's shape.
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