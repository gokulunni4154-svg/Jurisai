// src/modules/lawyer-inquiries/lawyer-inquiry.factory.ts
//
// Wires LawyerInquiryService for the lawyer-facing actions
// (accept/decline/assign/convert). Built AFTER accept-route.ts
// specifically to pull that route's inline currentUser/repository
// construction out into one place, matching the factory pattern every
// other module in this feature already follows
// (anonymous-analysis.factory.ts, lawyer-directory.factory.ts) --
// accept-route.ts's inline construction was a stand-in, not the
// intended shape, per that file's own header comment.
//
// FLAGGED, the single biggest guess in this file: takes `currentUser`
// as a parameter rather than loading it itself. RESOLVED THIS SESSION
// for the ROUTE side of this guess -- accept-route.ts/decline-route.ts
// now call the real getCurrentUser() (src/core/auth/session.ts) and
// pass its result in here. This factory itself is unaffected either
// way, since it never loaded currentUser itself to begin with -- still
// just accepts whatever AuthUser | null the caller passes.
//
// UPDATED THIS SESSION -- TWO CLIENTS NOW CONSTRUCTED, NOT ONE. Original
// version used only the admin client, correct for LawyerInquiryRepository
// (lawyer_inquiries' RLS is SELECT-only even for a real authenticated
// caller -- confirmed via that table's real migration -- so accept()/
// decline()/assign()/convert() literally cannot be performed as
// authenticated writes even with a correct auth.uid()). But
// LawyerInquiryService now ALSO depends on FirmMemberRepository and
// CaseService (added this session for assignInquiry()/convertInquiry()),
// and case.repository.ts's own real, pasted header comment is explicit
// that cases/case_documents/team_members/firm_members all keep
// CLIENT-WRITE RLS and must be constructed with the standard
// RLS-respecting client, NEVER the admin client -- the opposite
// direction from lawyer_inquiries. So this factory now builds both:
//   - adminClient: LawyerInquiryRepository only (as before).
//   - rlsClient: FirmMemberRepository (both LawyerInquiryService's own
//     direct use, and CaseService's), plus everything CaseService itself
//     needs (CaseRepository, TeamMemberRepository, DocumentRepository).
// Using the RLS-respecting client for FirmMemberRepository is also
// CORRECT, not just consistent with case.repository.ts's stated
// pattern: firm_members' real RLS (firm_members_select_same_firm) lets
// any member read every row sharing their own firm_id, which is exactly
// what assignInquiry()'s two lookups need (the caller's own role, and
// the target lawyer's role, both within the SAME firm the caller
// belongs to) -- no admin bypass is actually required here, unlike
// lawyer_inquiries and professional_verifications.
//
// FLAGGED, DEPENDENCY GAP, CARRIED FROM lawyer-inquiry.service.ts:
// TeamMemberRepository, FirmMemberRepository, and DocumentRepository
// (CaseService's other constructor dependencies, per case.service.ts's
// real pasted source) were never themselves pasted this session -- only
// their USAGE was confirmed via case.service.ts. Their constructors are
// assumed to take a single SupabaseClient argument, matching every
// other repository pasted or built this session (LawyerDirectoryRepository,
// NotificationRepository, CaseRepository, LawyerInquiryRepository all
// share this exact shape) -- a reasonable inferred default, not an
// independently confirmed one. If any of the three differs (e.g. needs
// a second constructor argument), only the four `new ...Repository(...)`
// calls below need to change.
//
// FLAGGED: getCurrentSession()/getCurrentUser() (src/core/auth/session.ts)
// wraps createClient() from '@/core/supabase/server' as an async
// function (`await createClient()`) -- this factory follows that same
// real, confirmed pattern for its own RLS-respecting client, rather than
// the `@/lib/supabase/server` path the original accept-route.ts/
// decline-route.ts guessed at before this session's fix.

import type { AuthUser } from '@/core/auth/types';
// FIX, tsc pass — was '@/lib/supabase/admin' (TS2307, module not found).
// Now confirmed against real, pasted document.factory.ts source, which
// imports createAdminClient from this exact path and uses it correctly
// (Amendment #15) — this was a typo/wrong-path guess, not a real second
// admin.ts location. Group 2, item 22 from the continuation prompt is
// now resolved by this evidence.
import { createAdminClient } from '@/core/supabase/admin';
import { createClient } from '@/core/supabase/server';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import { CaseAccessGrantRepository } from '@/modules/cases/case-access-grant.repository';
import { CaseRepository } from '@/modules/cases/case.repository';
import { CaseService } from '@/modules/cases/case.service';
import { DocumentRepository } from '@/modules/documents/document.repository';
import { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';
import { TeamMemberRepository } from '@/modules/user-management/team-member.repository';

import { LawyerInquiryRepository } from './lawyer-inquiry.repository';
import { LawyerInquiryService } from './lawyer-inquiry.service';

export async function buildLawyerInquiryService(
  currentUser: AuthUser | null
): Promise<LawyerInquiryService> {
  const adminClient = createAdminClient();
  const rlsClient = await createClient();

  // lawyer_inquiries: SELECT-only RLS -- must use admin client. See
  // file header.
  const lawyerInquiryRepository = new LawyerInquiryRepository(adminClient);

  // firm_members: real client-write RLS, real read policy covers
  // exactly what assignInquiry() needs. Must use the RLS-respecting
  // client, not admin. See file header.
  const firmMemberRepository = new FirmMemberRepository(rlsClient);

  // CaseService's own dependencies -- all RLS-respecting per
  // case.repository.ts's explicit "NO ADMIN CLIENT" header comment.
  // FLAGGED: TeamMemberRepository/DocumentRepository constructor shape
  // inferred, not confirmed -- see file header.
  const caseRepository = new CaseRepository(rlsClient);
  const teamMemberRepository = new TeamMemberRepository(rlsClient);
  const documentRepository = new DocumentRepository(rlsClient);

  // FIX, tsc pass -- CaseService's real constructor (case.service.ts,
  // confirmed via real pasted source) takes SEVEN arguments, not five:
  // currentUser, caseRepository, teamMemberRepository,
  // firmMemberRepository, documentRepository, caseAccessGrantRepository,
  // auditLogRepository. Both were missing here. caseAccessGrantRepository
  // uses the ADMIN client, not rlsClient -- case.service.ts's own header
  // comment states this explicitly ("admin client, same reasoning as
  // case-access-grant.repository.ts's header"), a real, confirmed
  // divergence from CaseService's other RLS-respecting dependencies, not
  // an inferred default. auditLogRepository also uses the admin client,
  // same as every other AuditLogRepository construction in this project
  // (audit_log has no RLS policy) -- reuses the same adminClient this
  // factory already builds for lawyerInquiryRepository above, rather than
  // constructing a second instance.
  const caseAccessGrantRepository = new CaseAccessGrantRepository(adminClient);
  const auditLogRepository = new AuditLogRepository(adminClient);

  const caseService = new CaseService(
    currentUser,
    caseRepository,
    teamMemberRepository,
    firmMemberRepository,
    documentRepository,
    caseAccessGrantRepository,
    auditLogRepository
  );

  return new LawyerInquiryService(
    currentUser,
    lawyerInquiryRepository,
    firmMemberRepository,
    caseService
  );
}