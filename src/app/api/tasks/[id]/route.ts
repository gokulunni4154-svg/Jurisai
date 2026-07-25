// src/app/api/tasks/[id]/route.ts
//
// Same confirmed pattern as cases/[id]/tasks/route.ts. DELETE returns a
// bare 204 No Content, not a { data: null } envelope — matches the
// project's confirmed real precedent from document-sets/[id]/members/
// [documentId]/route.ts's actual DELETE handler (the FirmMemberService
// DELETE route was itself corrected to this same shape after that
// precedent was found). This session: this file was itself re-pasted,
// independently confirming that DELETE-204 shape rather than relying on
// carried-forward memory — closes that flag from PROJECT_PROGRESS_52.md.
//
// UPDATED THIS SESSION: PATCH now validates its body against
// updateTaskInputSchema (task.schemas.ts) before calling the Service,
// closing the last remaining route-level gap flagged in
// PROJECT_PROGRESS_52.md. Same safeParse + manual ValidationError throw
// pattern as the two POST routes — see those files' own flags: this
// wiring shape is this session's own construction, not a re-verified
// project convention, and ValidationError's constructor signature is
// inferred from AuthorizationError's real usage in task.service.ts, not
// independently re-pasted from app-error.ts this session.
//
// IMPORTANT — validation vs. authorization boundary, unchanged by this
// edit: updateTaskInputSchema only rejects a structurally malformed
// body (e.g. status outside the enum, a non-uuid assigneeProfileId). It
// does NOT and cannot enforce the assignee-vs-non-assignee field
// restriction — TaskService#updateTask() still owns that, silently
// dropping non-status fields for the assignee path exactly as before.
// A schema-valid body (e.g. { title: "x", status: "done" }) sent by the
// assignee will still pass this schema and then have `title` silently
// ignored inside the Service, per that method's own documented,
// still-open judgment call on whether silent-drop is the right failure
// mode.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { createTaskService } from '@/modules/tasks/task.factory';
import { updateTaskInputSchema } from '@/modules/tasks/task.schemas';

interface RouteContext {
  params: { id: string };
}

/**
 * PATCH /api/tasks/[id]
 * Updates a task. TaskService#updateTask() itself branches on whether
 * the caller is the task's assignee (status-only) or a manager-level
 * actor (any field) — this route does not need to know which case
 * applies, same "authorization lives in the Service, not the route"
 * posture as every other route in this project.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const taskService = await createTaskService(currentUser);

    const body = await request.json();
    const parsed = updateTaskInputSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError('Invalid task payload.', parsed.error.flatten());
    }

    const task = await taskService.updateTask(id, {
      title: parsed.data.title,
      description: parsed.data.description,
      status: parsed.data.status,
      assigneeProfileId: parsed.data.assigneeProfileId,
      dueDate: parsed.data.dueDate,
    });

    return NextResponse.json({ data: task });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/tasks/[id]
 * Deletes a task. Deliberately NOT available to the assignee alone —
 * enforced inside TaskService#deleteTask(), which surfaces as
 * AuthorizationError (403) via handleApiError() if attempted.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const taskService = await createTaskService(currentUser);

    await taskService.deleteTask(id);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}