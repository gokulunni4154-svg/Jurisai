// src/app/api/cases/[id]/tasks/route.ts
//
// Mirrors cases/[id]/route.ts's real, confirmed pattern (itself marked
// DRAFT there, same Source Verification Rule caveat carried forward
// here): getCurrentUser() from @/core/auth/session, params typed
// synchronously as { id: string } (NOT a Promise — confirmed real via
// next@14.2.35 not Promise-wrapping dynamic route params, per
// professional-verification/admin/[id]/review/route.ts precedent),
// createXService(currentUser) from the module's factory,
// handleApiError() wrapping, { data: ... } envelope.
//
// UPDATED THIS SESSION: POST now validates its body against
// createTaskInputSchema (task.schemas.ts) before calling the Service,
// closing the gap flagged in PROJECT_PROGRESS_52.md. A malformed body
// now surfaces as a clean ValidationError via handleApiError() instead
// of whatever DatabaseError/Postgrest previously produced. The
// safeParse + manual ValidationError throw below is this session's OWN
// construction, not copied from a pasted precedent — no other
// schema-validated route file was supplied this session to confirm
// this project's real wiring convention against. Flagged; adjust to
// match the real convention if a genuine precedent is re-pasted.
//
// FLAGGED — REAL DISCREPANCY caught while wiring this: the pasted
// task.service.ts's createTask() types `firmId` as a plain, non-optional
// `string`, but PROJECT_PROGRESS_52.md's own narrative claims
// "input.firmId is optional on createTask() and only meaningful
// (validated as required) for the standalone path." The pasted CODE is
// authoritative over the progress-notes SUMMARY per the Source
// Verification Rule, so this route passes a placeholder empty string
// for the case-linked path below (harmless — requireTaskCreateAccess()
// never reads the `firmId` parameter when `caseId` is set, returning
// caseRow.firm_id before that param is touched) rather than silently
// trusting the progress notes' "optional" claim. The real fix is
// tightening task.service.ts's own signature to `firmId?: string` —
// out of scope for this schema-file task, flagging instead of silently
// fixing an unrequested file.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { createTaskService } from '@/modules/tasks/task.factory';
import { createTaskInputSchema } from '@/modules/tasks/task.schemas';

interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/cases/[id]/tasks
 * Lists every task on the case. TaskService#listTasksForCase() checks
 * the case exists (404s otherwise) but does not independently re-check
 * visibility beyond that — RLS (tasks_select) already scopes what
 * comes back, same "RLS is the backstop" posture as
 * CaseService#listCaseDocuments's own route.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const taskService = await createTaskService(currentUser);

    const tasks = await taskService.listTasksForCase(id);

    return NextResponse.json({ data: tasks });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/cases/[id]/tasks
 * Creates a task on the case. The route's own [id] param IS the
 * authoritative caseId; firmId is derived server-side inside
 * TaskService#createTask() from the case's own row, never trusted
 * from the request body — see that method's own comment on the real
 * firmId/caseId-mismatch bug this closes. Body only needs to supply
 * task-specific fields, not firmId — and createTaskInputSchema
 * (task.schemas.ts) deliberately has no firmId/caseId field at all,
 * for that same reason.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const taskService = await createTaskService(currentUser);

    const body = await request.json();
    const parsed = createTaskInputSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError('Invalid task payload.', parsed.error.flatten());
    }

    const task = await taskService.createTask({
      caseId: id,
      firmId: '', // Unused for the case-linked path — see header flag above.
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      assigneeProfileId: parsed.data.assigneeProfileId ?? null,
      dueDate: parsed.data.dueDate ?? null,
    });

    return NextResponse.json({ data: task }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}