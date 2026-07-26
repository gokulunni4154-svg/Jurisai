// src/app/api/tasks/mine/route.ts
//
// Self-scoped, no route params — mirrors cases/mine/route.ts's own
// design (itself flagged in this project's notes as this-session's-own
// naming, not mirrored from a pasted precedent, since no other route
// in the project uses this self-scoped-no-firmId shape either).
// TaskService#listMyTasks() requires only authentication, no additional
// permission gate — same reasoning as CaseAccessGrantService#listMyCases().

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createTaskService } from '@/modules/tasks/task.factory';

export async function GET(_request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    const taskService = await createTaskService(currentUser);

    const tasks = await taskService.listMyTasks();

    return NextResponse.json({ data: tasks });
  } catch (error) {
    return handleApiError(error);
  }
}