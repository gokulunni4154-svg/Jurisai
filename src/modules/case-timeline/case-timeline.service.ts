// Real path (confirmed by user):
// src/modules/case-timeline/case-timeline.service.ts
//
// NEW MODULE, THIS SESSION. Case Timeline / Activity History -- Phase 4.
// Thin read-only orchestration over AuditLogRepository, scoped to a
// single case via the new audit_log.case_id column
// (20260801000000_add_case_id_to_audit_log.sql).
//
// AUTHORIZATION, DELIBERATELY MIRRORED: same test as
// HearingService#requireHearingAccess() (real, pasted source) -- case
// owner OR an active read_write grantee. NOT reused directly (no
// cross-Service private-helper-sharing precedent in this project, same
// reasoning every other Service's own duplicated-helper comment gives)
// but the SHAPE is deliberately different from Hearing/Task's write-path
// check in one respect: this is a READ, so an active READ-ONLY grantee
// is also allowed, not just read_write. There is no confirmed source
// anywhere in this project of a read-only grantee being denied read
// access to case-scoped data (case-access-grant.service.ts's own
// listGrantsForCase() gates by manage-access, not by grant level, but
// that's a different operation -- viewing WHO has access, not viewing
// case activity). CONFIRMED as an explicit product decision (not
// merely this session's own judgment call): owner + any active grantee
// (read or read_write) can view the case timeline, but (per every other
// module's existing write-side checks) a read-only grantee still cannot
// create/update/delete the things that appear on it.
//
// RETURN SHAPE mirrors AuditLogService's own real, pasted
// AuditLogReadResult ({ events, total }) exactly, for the same reason
// that file's own header gives: keeps this Service's return shape
// distinct from AuditLogRepository's own { data, total }, and reads
// naturally as this Service's own public contract.
//
// DELIBERATELY RETURNS RAW audit_log ROWS, NOT ENRICHED -- decided this
// session ("u can decide"): matches this project's established
// convention of repositories/services returning raw rows and leaving
// enrichment (e.g. resolving actor_id to a display name) to the
// frontend, the same way src/app/hearings/upcoming/page.tsx (real,
// pasted source) batch-fetches case titles per distinct case_id itself
// rather than the backend joining them in. A CaseTimelinePage would
// follow the identical pattern: collect distinct actor_id values from
// the returned events, then batch-fetch profile names the same way that
// page batch-fetches case titles. NOT built here -- no case-timeline
// frontend page has been requested yet, this file is backend-only.

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { BaseService } from '@/core/services/base.service';
import type { Database } from '@/core/supabase/database.types';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import type { CaseAccessGrantRepository } from '@/modules/cases/case-access-grant.repository';
import type { CaseRepository } from '@/modules/cases/case.repository';

type AuditLogRow = Database['public']['Tables']['audit_log']['Row'];

/** Mirrors AuditLogService's own AuditLogReadResult shape exactly. */
export interface CaseTimelineResult {
  events: AuditLogRow[];
  total: number;
}

export class CaseTimelineService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly caseRepository: CaseRepository,
    private readonly caseAccessGrantRepository: CaseAccessGrantRepository,
  ) {
    super(currentUser);
  }

  /**
   * Returns the activity timeline for a case, most recent first, plus
   * the total count matching the case (before pagination) -- same
   * "total reflects the full filtered set, not the page size" contract
   * as AuditLogService's own three read methods.
   *
   * Access test: case owner, OR an active grantee of EITHER access
   * level (read or read_write) -- see this file's own header for why
   * this deliberately differs from the write-path services' read_write-
   * only check.
   */
  async getCaseTimeline(
    caseId: string,
    options?: { limit?: number; offset?: number; actionPrefix?: string },
  ): Promise<CaseTimelineResult> {
    await this.requireTimelineReadAccess(caseId);

    const { data, total } = await this.auditLogRepository.findByFilter({
      caseId,
      limit: options?.limit,
      offset: options?.offset,
      actionPrefix: options?.actionPrefix,
    });

    return { events: data, total };
  }

  /**
   * Case owner, OR any active grantee (read or read_write) -- see this
   * file's own header comment for why this is deliberately wider than
   * HearingService/TaskService's write-path checks, which require
   * read_write specifically. Confirmed as an explicit product decision.
   */
  private async requireTimelineReadAccess(caseId: string): Promise<AuthUser> {
    const user = this.requireAuthentication();
    const caseRow = await this.caseRepository.findByIdOrThrow(caseId);

    if (caseRow.owner_id === user.id) {
      return user;
    }

    const grant = await this.caseAccessGrantRepository.findActiveGrantForCaseAndProfile(
      caseId,
      user.id,
    );

    if (grant) {
      // Any active grant level (read or read_write) is sufficient for a
      // READ of the timeline -- deliberately not restricted to
      // read_write, unlike the write-path services. See header comment.
      return user;
    }

    // No ownership and no active grant of any level -- throws.
    this.requireOwnership(caseRow.owner_id);

    // Unreachable -- requireOwnership() always throws above when it
    // gets here, but TypeScript needs a return path. Same pattern as
    // HearingService#requireHearingAccess's own identical fallback.
    throw new Error('unreachable');
  }
}