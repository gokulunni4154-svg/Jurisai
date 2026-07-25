// Real path: FLAGGED, UNVERIFIED -- src/modules/firm-dashboard/firm-dashboard.service.ts
// New module this session, mirroring lawyer-dashboard's own dedicated
// module (src/modules/lawyer-dashboard/), since firms/firm_members
// currently straddle billing (firm.repository.ts) and user-management
// (firm-member.repository.ts) with no single existing module to fold
// this into -- flagged as a placement decision, not confirmed against
// any existing convention for a module that spans others this way.

import { BaseService } from '@/core/services/base.service';
import type { AuthUser, FirmRole } from '@/core/auth/types';
import type { Database } from '@/core/supabase/database.types';
import type { CaseRepository } from '@/modules/cases/case.repository';
import type { TaskRepository } from '@/modules/tasks/task.repository';
import type { HearingRepository } from '@/modules/hearings/hearing.repository';
import type { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';

type CaseRow = Database['public']['Tables']['cases']['Row'];
type TaskRow = Database['public']['Tables']['tasks']['Row'];
type HearingRow = Database['public']['Tables']['hearings']['Row'];

export interface FirmDashboardData {
  firmCases: CaseRow[];
  firmTasks: TaskRow[];
  upcomingHearings: HearingRow[];
}

/**
 * FirmRoles permitted to view the firm dashboard. Deliberately narrower
 * than "any firm member" -- confirmed by the user this session, not
 * inferred. Duplicated here rather than imported from
 * firm-member.service.ts's own MANAGE_ROLES constant, because that
 * constant is not exported from that file (private to its module) --
 * flagged as a small, real duplication. If firm-member.service.ts's
 * MANAGE_ROLES is ever exported, this local copy should be replaced
 * with an import instead of kept in sync by hand.
 */
const DASHBOARD_VIEW_ROLES: readonly FirmRole[] = ['owner', 'admin'];

/**
 * FirmDashboardService
 * ---------------------
 * NEW, Phase 4 — Firm Dashboard. Aggregates firm-wide cases, tasks, and
 * upcoming hearings for a firm's owner/admin. Structural sibling of
 * LawyerDashboardService (Phase 4, prior session) -- same
 * resolve-then-aggregate-via-Promise.all shape -- but with one forced,
 * real difference: this Service is NOT self-scoped off the session the
 * way LawyerDashboardService was. Multi-firm membership (confirmed this
 * session via firm-member.service.ts and firm.service.ts's own pasted
 * source) means a profile can be admin/owner at more than one firm
 * simultaneously, so "my dashboard" is ambiguous without a firmId --
 * every method here takes firmId explicitly instead.
 *
 * FLAGGED, NEW DECISION -- authorization is enforced ENTIRELY here, at
 * the Service layer, not via RLS. See case.repository.ts#findByFirmId(),
 * task.repository.ts#findByFirmId(), and
 * hearing.repository.ts#findUpcomingByFirmId()'s own doc comments for
 * the full reasoning: none of those three tables' RLS policies were
 * independently re-confirmed this session for a firm-wide,
 * cross-member query shape, so this Service's repositories are
 * constructed against the admin client by firm-dashboard.factory.ts,
 * and requireManageAccess() below is the only gate standing between an
 * authenticated caller and every case/task/hearing row in the firm.
 */
export class FirmDashboardService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly caseRepository: CaseRepository,
    private readonly taskRepository: TaskRepository,
    private readonly hearingRepository: HearingRepository,
    private readonly firmMemberRepository: FirmMemberRepository,
  ) {
    super(currentUser);
  }

  /**
   * Resolves the caller's own FirmRole for the given firm, then asserts
   * it's one of DASHBOARD_VIEW_ROLES. Identical two-step shape to
   * firm-member.service.ts's own private requireManageAccess() --
   * resolve via findByFirmAndProfile(), assert via BaseService's
   * inherited requireFirmRole() -- duplicated here rather than reused
   * because that method is private to FirmMemberService and not
   * exposed for cross-Service reuse.
   */
  private async requireManageAccess(firmId: string): Promise<AuthUser> {
    const user = this.requireAuthentication();
    const callerRole = await this.firmMemberRepository.findByFirmAndProfile(firmId, user.id);
    return this.requireFirmRole(callerRole, DASHBOARD_VIEW_ROLES);
  }

  /**
   * Returns the firm-wide dashboard aggregate: every case, every task
   * (case-linked and standalone alike), and every upcoming hearing
   * belonging to the firm. Runs all three queries in parallel via
   * Promise.all, same convention LawyerDashboardService's own
   * getDashboard() established.
   */
  async getDashboard(firmId: string): Promise<FirmDashboardData> {
    await this.requireManageAccess(firmId);

    const now = new Date().toISOString();

    const [firmCases, firmTasks, upcomingHearings] = await Promise.all([
      this.caseRepository.findByFirmId(firmId),
      this.taskRepository.findByFirmId(firmId),
      this.hearingRepository.findUpcomingByFirmId(firmId, now),
    ]);

    return { firmCases, firmTasks, upcomingHearings };
  }
}