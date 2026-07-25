// src/modules/tasks/task.service.ts
// Task Management — Phase 4. Built directly against the real, pasted
// case.service.ts for its create-access-check shape and its
// addDocumentToCase() owner-or-active-read_write-grant pattern — this
// service's case-linked create/update checks mirror that method's
// structure directly, since 20260814000000_create_tasks_table.sql's
// tasks_insert/tasks_update RLS policies encode the exact same test
// (case owner OR active read_write grantee) that addDocumentToCase()
// already checks in application code.
//
// base.service.ts's real source is now independently confirmed this
// session (pasted directly, not just inferred from case.service.ts's
// usage): requireAuthentication()/requireOwnership()/requireFirmRole()
// below are used exactly as documented there. This corrected a real
// bug in this file's first draft -- requireTaskCreateAccess()'s
// standalone-firm-member rejection path called requireOwnership(null),
// which would not have compiled against requireOwnership()'s actual
// non-nullable `resourceOwnerId: string` signature; it now throws
// AuthorizationError directly instead. See that method's own comment.
//
// Constructor takes TaskRepository, CaseRepository (to look up a case's
// owner_id/firm_id when case-linked), CaseAccessGrantRepository (to
// check for an active read_write grant, same as CaseService), and
// FirmMemberRepository (to check standalone-task firm membership).
//
// AMENDED, THIS SESSION — Case Timeline / Activity History
// instrumentation. Constructor gains a new dependency,
// auditLogRepository (real, pasted this session; same class
// case.service.ts and case-access-grant.service.ts already depend on).
// createTask(), updateTask(), and deleteTask() each now write a
// recordUserAction() event. `caseId` on the event is the task's own
// `case_id`, which is `null` for a standalone task — the audit_log
// migration's `case_id` column is nullable for exactly this reason,
// same "not every event is case-scoped" posture as `firm_id`.
//
// FLAGGED, NOT SOLVED HERE: updateTask()'s assignee-only path (status
// field only) ALSO now writes an audit event -- deliberately not
// excluded, since a status change (e.g. a task moving to 'done') is
// arguably the single most useful event on a case timeline, not a
// low-value one to skip. If this turns out to be too noisy in
// practice, revisit; not assumed here.

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { AuthorizationError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';
import type { Database } from '@/core/supabase/database.types';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import type { CaseAccessGrantRepository } from '@/modules/cases/case-access-grant.repository';
import type { CaseRepository } from '@/modules/cases/case.repository';
import type { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';

import type { TaskRepository } from './task.repository';

type TaskRow = Database['public']['Tables']['tasks']['Row'];
type TaskStatus = TaskRow['status'];

export class TaskService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly taskRepository: TaskRepository,
    private readonly caseRepository: CaseRepository,
    private readonly caseAccessGrantRepository: CaseAccessGrantRepository,
    private readonly firmMemberRepository: FirmMemberRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {
    super(currentUser);
  }

  /**
   * Creates a task. Case-linked (caseId given): requires the caller
   * either OWN the case, or hold an active read_write grant on it —
   * mirrors CaseService#addDocumentToCase()'s exact check, matching
   * tasks_insert's real RLS policy (FLAGGED ASSUMPTION #1 from the
   * migration: a read-only grantee, including a client, cannot create
   * a task on a case they don't own or hold write access to).
   * Standalone (caseId null): requires any firm_members row for
   * firmId, any role (FLAGGED ASSUMPTION #2 from the migration —
   * confirmed by delegation, "u can decide").
   *
   * CORRECTED, real bug caught while designing the routes on top of
   * this: when caseId is given, `firmId` is now DERIVED from the
   * case's own row (case.firm_id), never taken from caller input.
   * The prior draft accepted a caller-supplied firmId even in the
   * case-linked path and never cross-checked it against the case's
   * real firm — a caller with a valid read_write grant on a case
   * could have supplied an unrelated firmId, producing a task whose
   * firm_id didn't match its own case_id's real firm. `input.firmId`
   * is now only used for the standalone (caseId null) path, where
   * there is no case row to derive it from.
   *
   * AMENDED, THIS SESSION: writes a 'task.create' audit event, caseId
   * set to input.caseId (null for a standalone task).
   */
  async createTask(input: {
    firmId: string;
    caseId: string | null;
    title: string;
    description?: string | null;
    assigneeProfileId?: string | null;
    dueDate?: string | null;
  }): Promise<TaskRow> {
    const { user, firmId } = await this.requireTaskCreateAccess(input.firmId, input.caseId);

    // KNOWN FLAGGED MISMATCH, same idiom as CaseService#createCase:
    // narrow input shape vs. the inherited create()'s Database-derived
    // Insert type.
    const task = await this.taskRepository.create({
      firm_id: firmId,
      case_id: input.caseId,
      title: input.title,
      description: input.description ?? null,
      assignee_profile_id: input.assigneeProfileId ?? null,
      due_date: input.dueDate ?? null,
      created_by: user.id,
    } as never);

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId,
      caseId: task.case_id,
      action: 'task.create',
      resourceType: 'task',
      resourceId: task.id,
      metadata: { title: task.title, assigneeProfileId: task.assignee_profile_id },
    });

    return task;
  }

  /**
   * Lists every task on a given case. Does not independently re-check
   * access beyond requireAuthentication() — RLS (tasks_select) already
   * scopes what comes back to what the caller's session can see, same
   * "RLS is the backstop" convention as CaseService#listCaseDocuments.
   */
  async listTasksForCase(caseId: string): Promise<TaskRow[]> {
    this.requireAuthentication();
    await this.caseRepository.findByIdOrThrow(caseId);
    return this.taskRepository.findByCaseId(caseId);
  }

  /**
   * Lists standalone (non-case) tasks for a firm.
   */
  async listStandaloneTasks(firmId: string): Promise<TaskRow[]> {
    this.requireAuthentication();
    return this.taskRepository.findStandaloneByFirmId(firmId);
  }

  /**
   * "My tasks" — self-scoped, no additional permission gate, mirroring
   * CaseAccessGrantService#listMyCases()'s identical reasoning (a
   * profile listing its own assignments needs none).
   */
  async listMyTasks(): Promise<TaskRow[]> {
    const user = this.requireAuthentication();
    return this.taskRepository.findByAssigneeProfileId(user.id);
  }

  /**
   * Updates a task. Two distinct authorization paths, per FLAGGED
   * ASSUMPTION #3 in the migration (update/delete authorization was
   * not explicitly scoped by the user — this is this session's own
   * inference, not a re-confirmed decision):
   *
   *   - The assignee may update their OWN task, but only its `status`
   *     field — enforced here at the service layer (RLS allows the
   *     assignee a full row UPDATE; this method is what actually
   *     restricts them to status-only, matching the migration's own
   *     documented "service-layer, not RLS" approach).
   *   - Anyone else must satisfy the same access test as createTask()
   *     (case owner/read_write grantee, or any firm member for a
   *     standalone task) and may update any field.
   *
   * FLAGGED: if the assignee sends any field besides `status`, it is
   * silently ignored rather than rejected with a ValidationError —
   * revisit if silent-drop is the wrong failure mode for this project's
   * conventions (most validation elsewhere is Zod-schema-enforced
   * before the Service layer is ever reached, which this method
   * deliberately does not have precedent to lean on, since no
   * task.schemas.ts exists yet).
   *
   * AMENDED, THIS SESSION: both paths now write a 'task.update' audit
   * event — see this file's own header for why the assignee's
   * status-only path is deliberately included, not excluded.
   */
  async updateTask(
    taskId: string,
    input: {
      title?: string;
      description?: string | null;
      status?: TaskStatus;
      assigneeProfileId?: string | null;
      dueDate?: string | null;
    },
  ): Promise<TaskRow> {
    const user = this.requireAuthentication();
    const task = await this.taskRepository.findByIdOrThrow(taskId);

    const isAssignee = task.assignee_profile_id === user.id;

    if (isAssignee) {
      // Assignee path: status-only, regardless of what else was passed.
      const updated = await this.taskRepository.update(taskId, { status: input.status } as never);

      await this.auditLogRepository.recordUserAction({
        actorId: user.id,
        firmId: task.firm_id,
        caseId: task.case_id,
        action: 'task.update',
        resourceType: 'task',
        resourceId: task.id,
        metadata: { status: updated.status },
      });

      return updated;
    }

    // Non-assignee path: same test as createTask().
    await this.requireTaskCreateAccess(task.firm_id, task.case_id);

    const updated = await this.taskRepository.update(taskId, {
      title: input.title,
      description: input.description,
      status: input.status,
      assignee_profile_id: input.assigneeProfileId,
      due_date: input.dueDate,
    } as never);

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: task.firm_id,
      caseId: task.case_id,
      action: 'task.update',
      resourceType: 'task',
      resourceId: task.id,
      metadata: { status: updated.status },
    });

    return updated;
  }

  /**
   * Deletes a task. Deliberately NOT available to the assignee alone
   * (matches tasks_delete's real RLS policy, which excludes the
   * assignee-only path on purpose) — same access test as createTask().
   *
   * AMENDED, THIS SESSION: writes a 'task.delete' audit event BEFORE
   * the delete call, not after -- deliberate ordering, since
   * task.case_id/task.firm_id/task.title are only available while the
   * row still exists; the same "no transaction primitive" caveat
   * base.repository.ts documents applies here (if the delete itself
   * then fails, an orphan audit event recording a deletion that didn't
   * happen is possible, same accepted characteristic as elsewhere in
   * this project).
   */
  async deleteTask(taskId: string): Promise<void> {
    this.requireAuthentication();
    const task = await this.taskRepository.findByIdOrThrow(taskId);

    const user = await this.requireTaskCreateAccess(task.firm_id, task.case_id).then((r) => r.user);

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: task.firm_id,
      caseId: task.case_id,
      action: 'task.delete',
      resourceType: 'task',
      resourceId: task.id,
      metadata: { title: task.title },
    });

    await this.taskRepository.delete(taskId);
  }

  /**
   * Shared create/manage-access check, mirroring
   * CaseService#requireCaseCreateAccess()'s structure but against
   * task-specific rules: case-linked requires case OWNERSHIP or an
   * active READ_WRITE grant (not "any firm member" — unlike
   * CaseService's own solo-case-creation Decision #60, tasks were
   * never widened that way; see FLAGGED ASSUMPTION #1 in the
   * migration). Standalone requires any firm_members row for firmId,
   * any role (FLAGGED ASSUMPTION #2).
   *
   * Returns the AUTHORITATIVE firmId alongside the user — when
   * caseId is given, this is caseRow.firm_id (derived, never the
   * caller-supplied firmId — see createTask()'s own comment on the
   * bug this fixes); when caseId is null, it's simply the passed-in
   * firmId, since there's no case row to derive it from.
   *
   * Duplicated rather than shared with CaseService's own private
   * helper, per that method's own documented reasoning: no established
   * precedent in this project for cross-Service private helper
   * sharing beyond BaseService itself.
   */
  private async requireTaskCreateAccess(
    firmId: string,
    caseId: string | null,
  ): Promise<{ user: AuthUser; firmId: string }> {
    const user = this.requireAuthentication();

    if (caseId) {
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

      // No ownership and no valid read_write grant -- throws.
      this.requireOwnership(caseRow.owner_id);
    }

    const firmRole = await this.firmMemberRepository.findByFirmAndProfile(firmId, user.id);

    if (firmRole) {
      return { user, firmId };
    }

    // No firm_members row at all for this firm. CORRECTED: base.service.ts
    // is now confirmed real -- requireOwnership()'s resourceOwnerId
    // parameter is a non-nullable `string`, so passing `null` (the prior
    // draft's approach) would have failed to compile. There is no
    // "owner" concept for a standalone task to compare against here, so
    // this throws AuthorizationError directly instead, matching how
    // requireOwnership() itself throws when its own checks fail.
    throw new AuthorizationError(
      'You do not have permission to perform this action within this firm.',
      { firmId },
    );
  }
}