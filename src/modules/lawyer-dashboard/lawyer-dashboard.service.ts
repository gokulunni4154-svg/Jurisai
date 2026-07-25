// src/modules/lawyer-dashboard/lawyer-dashboard.service.ts
//
// NEW MODULE, THIS SESSION -- Lawyer Dashboard (Phase 4 sub-feature,
// picked over Law firm dashboard / Reports & analytics / Org-firm
// settings on complexity grounds -- this is a pure read/aggregation
// layer over three already-complete modules (Task Management,
// Hearings & Calendar, Case Access Grants), unlike Org/firm settings
// which would need a brand-new firms CRUD module (Open Item #80) or
// Law firm/Reports which need new firm-wide aggregation queries not
// yet built anywhere in this project.
//
// SCOPING DECISIONS, THIS SESSION:
//   1. Self-scoped only, no profileId parameter -- same reasoning as
//      CaseAccessGrantService#listMyCases(): a lawyer viewing their OWN
//      dashboard needs no separate authorization gate beyond
//      "authenticated and role === 'lawyer'". Viewing ANOTHER lawyer's
//      dashboard (e.g. a firm admin auditing a report) is explicitly
//      OUT OF SCOPE for this file -- no pasted precedent in this
//      project currently does that, and it would need its own
//      authorization shape.
//   2. Gated on AuthUser.role === 'lawyer' (types.ts, UserRole), NOT
//      FirmRole -- confirmed this session as the correct axis: UserRole
//      answers "what kind of account is this", FirmRole answers "what
//      can this profile do inside one firm". A dashboard identity check
//      is a UserRole question. See types.ts's own header for this
//      exact distinction -- a profile could be FirmRole 'lawyer'
//      *within* a firm while UserRole is something else entirely, or
//      vice versa; these are independent facts.
//   3. "My cases" uses CaseRepository#findManyVisible() -- a REAL
//      FINDING this session, not an assumption: that method's own doc
//      comment confirms it returns every case RLS lets the caller see
//      (own cases, active-grant cases, firm-admin override) with no
//      explicit filter added -- visibility is entirely determined by
//      the RLS-scoped client the repository is constructed with. This
//      makes the earlier N+1 pattern in
//      CaseAccessGrantService#listMyCases() (grants, then
//      findByIdOrThrow per case in a loop) unnecessary for this
//      dashboard's purposes -- findManyVisible() is a single query and
//      already covers owned + granted cases together. Flagging this as
//      a possible future simplification of listMyCases() itself; NOT
//      changing that file here, out of scope for this session.
//   4. "My tasks" uses TaskRepository#findByAssigneeProfileId(user.id)
//      -- confirmed real, unmodified from that file's own pasted
//      source.
//   5. "Upcoming hearings" uses HearingRepository#findUpcoming(fromDate)
//      -- confirmed real. Per that method's own doc comment, hearings
//      have no per-user assignee column, so "my hearings" is simply
//      "every hearing RLS lets me see, filtered to the future" -- for a
//      lawyer, RLS already narrows this to hearings on cases they own
//      or have an active grant on. fromDate is computed here in the
//      Service layer (now()), matching that method's own documented
//      "repository doesn't own business defaults" posture.
//
// CORRECTION, THIS SESSION -- base.service.ts and app-error.ts were both
// pasted after this file's first draft shipped. Both confirmed the
// draft's INFERRED shapes were correct (BaseService's constructor,
// requireAuthentication(), and AuthorizationError's single-string-message
// constructor all match exactly). One real fix made as a result, though:
// the draft's private requireLawyerRole() hand-rolled a role check and a
// bare AuthorizationError throw -- BaseService already provides
// requireRole(...allowedRoles: readonly UserRole[]) for exactly this,
// which additionally attaches structured context ({ requiredRoles,
// actualRole }) to the thrown error that the hand-rolled version didn't.
// The private method is removed below in favor of the inherited one --
// same "don't duplicate what the base class already gives you" lesson
// task.repository.ts's own corrected header documents for its prior
// draft's hand-rolled findByIdOrThrow.
//
import 'server-only';

import { BaseService } from '@/core/services/base.service';
import type { AuthUser } from '@/core/auth/types';
import type { Database } from '@/core/supabase/database.types';
import type { CaseRepository } from '@/modules/cases/case.repository';
import type { TaskRepository } from '@/modules/tasks/task.repository';
import type { HearingRepository } from '@/modules/hearings/hearing.repository';

type CaseRow = Database['public']['Tables']['cases']['Row'];
type TaskRow = Database['public']['Tables']['tasks']['Row'];
type HearingRow = Database['public']['Tables']['hearings']['Row'];

export interface LawyerDashboardData {
  myCases: CaseRow[];
  myTasks: TaskRow[];
  upcomingHearings: HearingRow[];
}

export class LawyerDashboardService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly caseRepository: CaseRepository,
    private readonly taskRepository: TaskRepository,
    private readonly hearingRepository: HearingRepository,
  ) {
    super(currentUser);
  }

  /**
   * Returns the current lawyer's dashboard data: every case they can
   * see (owned or granted, per CaseRepository#findManyVisible()'s own
   * RLS-scoped posture), every task assigned to them, and every
   * upcoming hearing they can see. All three repositories are
   * constructed with the RLS-scoped client (not admin) in
   * lawyer-dashboard.factory.ts -- matching every one of these three
   * repositories' own individually-confirmed RLS-client posture.
   *
   * Self-scoped only -- see this file's header, decision #1. Fetches
   * run in parallel (Promise.all) since they are independent reads with
   * no ordering dependency between them.
   */
  async getDashboard(): Promise<LawyerDashboardData> {
    // Inherited from BaseService -- requireRole('lawyer') internally
    // calls requireAuthentication() first (401 for no session, not a
    // 403), then throws AuthorizationError with structured context
    // ({ requiredRoles: ['lawyer'], actualRole }) if the role doesn't
    // match. Deliberately does NOT allow an 'admin'/'support' override
    // (unlike CaseAccessGrantService's requireFirmRole() checks
    // elsewhere in this project) -- this dashboard has no confirmed
    // "view on behalf of" requirement yet; narrower default until a
    // real need surfaces, same "don't invent unrequested scope" posture
    // as issueGrant()'s own documented restraint. See decision #2 in
    // this file's header for why UserRole, not FirmRole, is the right
    // axis here.
    const user = this.requireRole('lawyer');

    const [myCases, myTasks, upcomingHearings] = await Promise.all([
      this.caseRepository.findManyVisible(),
      this.taskRepository.findByAssigneeProfileId(user.id),
      this.hearingRepository.findUpcoming(new Date().toISOString()),
    ]);

    return { myCases, myTasks, upcomingHearings };
  }
}