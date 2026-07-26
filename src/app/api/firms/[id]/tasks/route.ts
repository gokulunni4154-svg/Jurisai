// src/app/api/firms/[id]/tasks/route.ts
//
// Nested under /api/firms/[id]/..., matching the project's dominant
// route-nesting convention (used by the majority of routes in this
// project, per this project's own notes — unlike cases/mine and
// auth/client-sign-up, which were flagged as this-session-only
// naming). Standalone (case_id null) tasks only — case-linked task
// creation/listing goes through cases/[id]/tasks/route.ts instead.
//
// UPDATED THIS SESSION: POST now validates its body against
// createTaskInputSchema (task.schemas.ts) before calling the Service,
// closing the last remaining Task Management gap flagged since
// PROJECT_PROGRESS_52.md (that file's own flag: "no task.schemas.ts
// exists... both POST routes and the PATCH route read request.json()
// and pass the body through with only minimal shape-checking"). The
// two routes that flag referred to alongside this one —
// cases/[id]/tasks/route.ts's POST and tasks/[id]/route.ts's PATCH —
// were both closed in an earlier session; this was the one route left
// unwired. Same safeParse + manual ValidationError throw pattern those
// two files use, copied directly from cases/[id]/tasks/route.ts's real
// pasted POST handler rather than reinvented — this route's own header
// previously flagged that wiring shape as "this session's own
// construction, not a re-verified project convention" the first time
// it was introduced; it is now a repeated, consistent pattern across
// three routes, which is as close to "the project's real convention"
// as this codebase currently has for schema-validated routes.
//
// A malformed body now surfaces as a clean ValidationError via
// handleApiError() instead of whatever DatabaseError/Postgrest
// previously produced.

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
 * GET /api/firms/[id]/tasks
 * Lists standalone (non-case) tasks for the firm.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const taskService = await createTaskService(currentUser);

    const tasks = await taskService.listStandaloneTasks(id);

    return NextResponse.json({ data: tasks });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/firms/[id]/tasks
 * Creates a standalone (non-case) task for the firm. The route's own
 * [id] param IS the authoritative firmId, passed straight through —
 * unlike the case-linked route, there's no derived value to prefer
 * over it here, since there's no case row involved.
 *
 * Body is now validated against createTaskInputSchema before reaching
 * the Service — same posture as cases/[id]/tasks/route.ts's POST and
 * tasks/[id]/route.ts's PATCH. createTaskInputSchema has no
 * firmId/caseId field (both are derived/supplied server-side, never
 * trusted from the body — see that schema's own header comment), so
 * this route continues to pass `id` and `caseId: null` explicitly
 * below, exactly as before; only the task-specific fields
 * (title/description/assigneeProfileId/dueDate) now flow through
 * validation first.
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
      firmId: id,
      caseId: null,
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