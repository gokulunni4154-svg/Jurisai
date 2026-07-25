// Real path: src/modules/hearings/hearing.service.ts
//
// Built directly against the real, pasted task.service.ts and its
// requireTaskCreateAccess() pattern, simplified: hearings have no
// standalone (case_id null) path and no assignee concept (see the
// migration header) so there is only ONE access test, not the
// case-linked-vs-standalone branch tasks needed. Also no dual
// "assignee, status-only" vs "manager, any field" branch on update --
// every hearing mutation uses the same single access test.
//
// AMENDED, THIS SESSION — Case Timeline / Activity History
// instrumentation. Constructor gains a new dependency,
// auditLogRepository (real, pasted this session). createHearing(),
// updateHearing(), and deleteHearing() each now write a
// recordUserAction() event with caseId set -- unlike task.service.ts,
// there is no standalone path here, so caseId is always non-null on
// every hearing event, same reasoning requireHearingAccess() itself
// gives for having only one access test.

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { BaseService } from '@/core/services/base.service';
import type { Database } from '@/core/supabase/database.types';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import type { CaseAccessGrantRepository } from '@/modules/cases/case-access-grant.repository';
import type { CaseRepository } from '@/modules/cases/case.repository';

import type { HearingRepository } from './hearing.repository';

type HearingRow = Database['public']['Tables']['hearings']['Row'];
type HearingType = HearingRow['hearing_type'];

export class HearingService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly hearingRepository: HearingRepository,
    private readonly caseRepository: CaseRepository,
    private readonly caseAccessGrantRepository: CaseAccessGrantRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {
    super(currentUser);
  }

  /**
   * Creates a hearing on a case. Requires the caller either OWN the
   * case, or hold an active read_write grant on it -- mirrors
   * TaskService#requireTaskCreateAccess()'s case-linked branch exactly,
   * matching hearings_insert's real RLS policy. firmId is ALWAYS
   * derived from the case row, never accepted as caller input -- same
   * fix TaskService#createTask()'s own comment documents for the
   * identical caseId/firmId-mismatch risk, except here there is no
   * standalone path where a caller-supplied firmId would ever be
   * needed, so the input shape doesn't accept one at all.
   *
   * AMENDED, THIS SESSION: writes a 'hearing.create' audit event.
   */
  async createHearing(input: {
    caseId: string;
    hearingDate: string;
    hearingType?: HearingType;
    courtName?: string | null;
    location?: string | null;
    notes?: string | null;
  }): Promise<HearingRow> {
    const { user, firmId } = await this.requireHearingAccess(input.caseId);

    // KNOWN FLAGGED MISMATCH, same idiom as TaskService#createTask: narrow
    // input shape vs. the inherited create()'s Database-derived Insert type.
    const hearing = await this.hearingRepository.create({
      case_id: input.caseId,
      firm_id: firmId,
      hearing_date: input.hearingDate,
      hearing_type: input.hearingType,
      court_name: input.courtName ?? null,
      location: input.location ?? null,
      notes: input.notes ?? null,
      created_by: user.id,
    } as never);

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId,
      caseId: hearing.case_id,
      action: 'hearing.create',
      resourceType: 'hearing',
      resourceId: hearing.id,
      metadata: { hearingDate: hearing.hearing_date, hearingType: hearing.hearing_type },
    });

    return hearing;
  }

  /**
   * Lists every hearing on a given case. Does not independently
   * re-check access beyond confirming the case exists -- RLS
   * (hearings_select) already scopes what comes back, same "RLS is the
   * backstop" convention as TaskService#listTasksForCase.
   */
  async listHearingsForCase(caseId: string): Promise<HearingRow[]> {
    this.requireAuthentication();
    await this.caseRepository.findByIdOrThrow(caseId);
    return this.hearingRepository.findByCaseId(caseId);
  }

  /**
   * "Upcoming hearings" -- the calendar view's primary query. Self-
   * scoped only in the sense that RLS narrows results to what the
   * caller's session can see (own cases, or cases with an active
   * grant) -- there is no per-user assignee filter to apply on top,
   * unlike TaskService#listMyTasks(). `fromDate` defaults to "now" if
   * omitted, letting a future date be passed for a "hearings after X"
   * view without a second method.
   */
  async listUpcomingHearings(fromDate?: string): Promise<HearingRow[]> {
    this.requireAuthentication();
    return this.hearingRepository.findUpcoming(fromDate ?? new Date().toISOString());
  }

  /**
   * Updates a hearing. Single access test, unlike
   * TaskService#updateTask()'s assignee-vs-manager dual path -- there
   * is no assignee concept on hearings, so every caller who can update
   * a hearing at all may update any field, including the new
   * `outcome`.
   *
   * AMENDED, THIS SESSION: writes a 'hearing.update' audit event. The
   * `outcome` field is deliberately included in the event's metadata
   * when present -- a hearing's outcome being recorded is arguably the
   * single most useful entry a case timeline can show, same reasoning
   * task.service.ts's own header gives for not excluding status
   * changes from that module's timeline events.
   */
  async updateHearing(
    hearingId: string,
    input: {
      hearingDate?: string;
      hearingType?: HearingType;
      courtName?: string | null;
      location?: string | null;
      notes?: string | null;
      outcome?: string | null;
    },
  ): Promise<HearingRow> {
    this.requireAuthentication();
    const hearing = await this.hearingRepository.findByIdOrThrow(hearingId);

    const { user, firmId } = await this.requireHearingAccess(hearing.case_id);

    const updated = await this.hearingRepository.update(hearingId, {
      hearing_date: input.hearingDate,
      hearing_type: input.hearingType,
      court_name: input.courtName,
      location: input.location,
      notes: input.notes,
      outcome: input.outcome,
    } as never);

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId,
      caseId: updated.case_id,
      action: 'hearing.update',
      resourceType: 'hearing',
      resourceId: updated.id,
      metadata: { hearingDate: updated.hearing_date, outcome: updated.outcome },
    });

    return updated;
  }

  /**
   * Deletes a hearing. Same access test as create/update -- unlike
   * TaskService#deleteTask(), there is no assignee to deliberately
   * exclude from this path, since no assignee concept exists.
   *
   * AMENDED, THIS SESSION: writes a 'hearing.delete' audit event BEFORE
   * the delete call, same ordering reasoning as
   * TaskService#deleteTask()'s own amended comment (the row's fields
   * are only available while it still exists; same accepted no-
   * transaction-primitive caveat applies).
   */
  async deleteHearing(hearingId: string): Promise<void> {
    this.requireAuthentication();
    const hearing = await this.hearingRepository.findByIdOrThrow(hearingId);

    const { user, firmId } = await this.requireHearingAccess(hearing.case_id);

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId,
      caseId: hearing.case_id,
      action: 'hearing.delete',
      resourceType: 'hearing',
      resourceId: hearing.id,
      metadata: { hearingDate: hearing.hearing_date },
    });

    await this.hearingRepository.delete(hearingId);
  }

  /**
   * Shared access check for create/update/delete. Case owner OR an
   * active read_write grantee only -- matches hearings_insert/update/
   * delete's real RLS policies. Returns the authoritative firmId
   * (derived from the case row), same reasoning as
   * TaskService#requireTaskCreateAccess()'s return shape, simplified
   * since there is no standalone path here to also handle.
   *
   * Duplicated rather than shared with TaskService's own private
   * helper, per that method's own documented reasoning: no established
   * precedent in this project for cross-Service private helper
   * sharing beyond BaseService itself.
   */
  private async requireHearingAccess(
    caseId: string,
  ): Promise<{ user: AuthUser; firmId: string }> {
    const user = this.requireAuthentication();
    const caseRow = await this.caseRepository.findByIdOrThrow(caseId);

    if (caseRow.owner_id === user.id) {
      return { user, firmId: caseRow.firm_id };
    }

    const grant = await this.caseAccessGrantRepository.findActiveGrantForCaseAndProfile(
      caseId,
      user.id,
    );

    if (grant?.access_level === 'read_write') {
      return { user, firmId: caseRow.firm_id };
    }

    // No ownership and no valid read_write grant -- throws
    // AuthorizationError, mirroring TaskService's identical fallback.
    this.requireOwnership(caseRow.owner_id);

    // Unreachable -- requireOwnership() always throws above when it
    // gets here, but TypeScript needs a return path.
    throw new Error('unreachable');
  }
}