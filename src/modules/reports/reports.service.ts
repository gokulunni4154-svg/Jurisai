// src/modules/reports/reports.service.ts
// Reports & Analytics — Phase 4. Combined firm dashboard.
//
// SOURCE VERIFICATION NOTE: built directly against this session's real,
// pasted firm.service.ts and case.service.ts. Access-control shape below
// is a deliberate, near-verbatim mirror of firm.service.ts's own
// requireManageAccess() — same resolve-then-assert pattern
// (firmMemberRepository.findByFirmAndProfile() -> inherited
// requireFirmRole()), same duplication trade-off that file's own doc
// comment already accepts (FirmService and FirmMemberService don't
// share a base beyond BaseService, so this is a third independent copy
// of the same owner/admin gate array -- flagged there already as "a
// real smell, not a coincidence"; this file adds a fourth copy rather
// than resolving that smell, since resolving it is out of this file's
// scope).
//
// GATE DECISION, FLAGGED: mirrors firm.service.ts's own stated
// precedent that "Firm Dashboard's own visibility gate" is owner/admin
// only, not all firm members. Applying literally the same gate here for
// the Reports & Analytics dashboard -- not independently re-confirmed
// with the user this session, same as firm.service.ts's own admission
// that its Org/Firm Settings gate reuses that precedent without a fresh
// confirmation. If a broader "any firm member can view reports" access
// tier is wanted later, this is the method to revisit.

import 'server-only';

import type { AuthUser, FirmRole } from '@/core/auth/types';
import { BaseService } from '@/core/services/base.service';
import type { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';

import type {
  CaseStatusCounts,
  FirmSubscriptionSummary,
  ReportsRepository,
  TaskStatusCounts,
} from './reports.repository';

/**
 * FLAGGED, DUPLICATED: same value, same reasoning, as
 * FIRM_SETTINGS_MANAGE_ROLES in firm.service.ts and MANAGE_ROLES in
 * firm-member.service.ts. Not imported from either -- neither exports
 * it (confirmed for firm.service.ts via its own pasted source this
 * session; firm-member.service.ts's non-export was already flagged
 * there in firm.service.ts's own comment).
 */
const REPORTS_VIEW_ROLES: readonly FirmRole[] = ['owner', 'admin'];

export interface FirmDashboard {
  cases: CaseStatusCounts;
  tasks: TaskStatusCounts;
  upcomingHearings: Awaited<ReturnType<ReportsRepository['getUpcomingHearings']>>;
  subscription: FirmSubscriptionSummary | null;
}

export class ReportsService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly reportsRepository: ReportsRepository,
    private readonly firmMemberRepository: FirmMemberRepository,
  ) {
    super(currentUser);
  }

  /**
   * Combined firm dashboard: case status counts, task status counts,
   * upcoming hearings, and the firm's active subscription/plan, all in
   * one call. Deliberately a single aggregate method rather than four
   * separate ones -- this is the "one combined dashboard" shape the
   * user picked over per-report breakouts. Individual report methods
   * (case-load-per-team, revenue-only, etc.) can be added later as
   * their own methods without changing this one, if wanted.
   *
   * hearingsLimit defaults to 5 -- an arbitrary, unconfirmed choice
   * (no real precedent exists in pasted source for how many upcoming
   * items a dashboard widget should show). Flagged rather than silently
   * picked without comment.
   *
   * NOT audited. Read-only, matching this project's own established
   * convention for read methods (FirmService#getMyFirm(),
   * DocumentService#getDownloadUrl(), NotificationService#listNotifications()
   * all excluded from audit logging for the identical reason).
   */
  async getFirmDashboard(firmId: string, hearingsLimit = 5): Promise<FirmDashboard> {
    await this.requireDashboardAccess(firmId);

    const [cases, tasks, upcomingHearings, subscription] = await Promise.all([
      this.reportsRepository.getCaseStatusCounts(firmId),
      this.reportsRepository.getTaskStatusCounts(firmId),
      this.reportsRepository.getUpcomingHearings(firmId, hearingsLimit),
      this.reportsRepository.getActiveSubscription(firmId),
    ]);

    return { cases, tasks, upcomingHearings, subscription };
  }

  /**
   * Shared authorization helper, deliberate mirror of
   * firm.service.ts#requireManageAccess() -- see class-level doc
   * comment for the duplication reasoning.
   */
  private async requireDashboardAccess(firmId: string): Promise<AuthUser> {
    const user = this.requireAuthentication();
    const callerRole = await this.firmMemberRepository.findByFirmAndProfile(firmId, user.id);
    return this.requireFirmRole(callerRole, REPORTS_VIEW_ROLES);
  }
}