// REAL FILE PATH: src/app/tasks/mine/page.tsx
//
// NEW FILE, THIS SESSION — self-scoped "my tasks" view. Last of the
// three Task Management frontend views (case-linked list and standalone
// firm to-dos were built earlier this session).
//
// Built against real, pasted source:
//   - case-detail-page.tsx / firm-todos-page.tsx (this session,
//     earlier) — same page shell, extractErrorMessage(), status pill,
//     lucide/Tailwind conventions traced back to documents/[id]/page.tsx
//     (File 160).
//   - tasks/mine/route.ts (this session) — real GET shape: no route
//     params, { data: tasks } envelope, self-scoped via
//     TaskService#listMyTasks() (requires only authentication, per
//     that method's own comment).
//   - task.repository.ts#findByAssigneeProfileId (this session) — real
//     confirmed ordering: `due_date asc, nulls last` (soonest due date
//     first) — NOT re-sorted client-side, same "don't distrust a
//     confirmed real ordering" posture case-detail-page.tsx took for
//     findByCaseId's own confirmed `created_at desc`.
//
// GENUINELY DIFFERENT FROM THE OTHER TWO VIEWS, ONE REAL DECISION:
// on this page, the caller IS always the assignee of every task shown
// (that's the entire definition of "my tasks") — unlike
// case-detail-page.tsx / firm-todos-page.tsx, where the caller's
// relationship to any given task was unknown client-side and Delete
// was therefore always rendered, relying on the Service's real 403 to
// reject an assignee-only caller. HERE, that identity fact IS known,
// so this page applies task.service.ts's own documented rule directly:
// "The assignee may NOT delete their own task" (tasks_delete's RLS
// deliberately excludes the assignee-only path) — Delete is not
// rendered at all on this page, not merely relied-upon-to-fail
// server-side. Status IS still shown as an advance-able pill, since
// TaskService#updateTask()'s assignee path explicitly permits
// status-only updates.
//
// FLAGGED, SAME AS THE OTHER TWO VIEWS: no case entity/lookup exists,
// so a task's `case_id` (when non-null) is shown only as a raw id with
// a "view case" link built from it directly — not a resolved case
// title. No profiles lookup exists either, so there's nothing to
// resolve for this page's own identity (the assignee is "you", so no
// name is needed here — this page doesn't have the same
// assignee-display gap the other two do, since there's nothing to
// show beyond the task itself).
//
// NOT INCLUDED, DELIBERATELY: no create-task form. Per
// task.service.ts, createTask() has no "assign to myself, standalone
// of any case/firm" path — every task must be case-linked or
// firm-standalone at creation, both of which require the OTHER two
// pages' context (a case id or a firm id) that this self-scoped page
// doesn't have. This page is read + status-update only, matching
// listMyTasks()'s own real scope.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, AlertCircle, ListTodo, Calendar, Briefcase } from 'lucide-react';

type TaskStatus = 'todo' | 'in_progress' | 'done';

interface TaskRow {
  id: string;
  firm_id: string;
  case_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignee_profile_id: string | null;
  due_date: string | null;
  created_by: string;
  created_at: string;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'done'];

const STATUS_STYLES: Record<TaskStatus, string> = {
  todo: 'bg-muted text-muted-foreground',
  in_progress: 'bg-amber-500/10 text-amber-700',
  done: 'bg-emerald-500/10 text-emerald-700',
};

// Copied verbatim from documents/[id]/page.tsx (File 160), same as the
// other two task views.
async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

function formatDueDate(dateString: string): string {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// A due date strictly before today (UTC calendar-date comparison, same
// reasoning as formatDueDate's own UTC-midnight parse) — used only for
// a visual "overdue" cue. NOT a real product feature: task.schemas.ts's
// own comment states there is deliberately no overdue-tracking column
// in v1, so this is purely a client-side, non-persisted highlight, not
// a claim that the backend tracks overdue status.
function isOverdue(dateString: string): boolean {
  const [year, month, day] = dateString.split('-').map(Number);
  const due = Date.UTC(year, month - 1, day);
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return due < todayUtc;
}

export default function MyTasksPage() {
  const router = useRouter();

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});

  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/tasks/mine', { credentials: 'include' });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      // Real confirmed envelope + ordering — see file header.
      setTasks(json.data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load your tasks.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Assignee path only ever sends `status` — task.service.ts's own
  // updateTask() silently drops any other field for the assignee, so
  // there is no reason to send more than this from a page where the
  // caller is always the assignee.
  const handleAdvanceStatus = async (task: TaskRow) => {
    const currentIndex = STATUS_ORDER.indexOf(task.status);
    const nextStatus = STATUS_ORDER[(currentIndex + 1) % STATUS_ORDER.length];

    setBusyTaskId(task.id);
    setTaskErrors((prev) => ({ ...prev, [task.id]: '' }));
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      const updated: TaskRow = json.data;
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      setTaskErrors((prev) => ({
        ...prev,
        [task.id]: err instanceof Error ? err.message : 'Could not update this task.',
      }));
    } finally {
      setBusyTaskId(null);
    }
  };

  return (
    <div className="flex h-screen w-full flex-col bg-background font-sans text-foreground">
      <header className="flex items-center gap-4 border-b border-border px-8 py-6">
        <button
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted/50"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            JurisAI · My Tasks
          </p>
          <h1 className="truncate font-serif text-[24px] leading-none text-foreground">
            My Tasks
          </h1>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-8 py-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-[13px]">Loading your tasks…</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="text-[13px]">{loadError}</p>
            <button
              onClick={loadTasks}
              className="text-[13px] font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            <section className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <ListTodo className="h-4 w-4 text-primary" strokeWidth={1.75} />
                <h2 className="font-serif text-[18px] text-foreground">
                  Assigned to you ({tasks.length})
                </h2>
              </div>

              {tasks.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  Nothing is assigned to you right now.
                </p>
              ) : (
                <div className="flex flex-col divide-y divide-border">
                  {tasks.map((task) => (
                    <div key={task.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-foreground">{task.title}</p>
                          {task.description && (
                            <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                              {task.description}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleAdvanceStatus(task)}
                          disabled={busyTaskId === task.id}
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-60 ${STATUS_STYLES[task.status]}`}
                          title="Click to advance status"
                        >
                          {busyTaskId === task.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            STATUS_LABELS[task.status]
                          )}
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                        {task.due_date && (
                          <span
                            className={`flex items-center gap-1 ${
                              task.status !== 'done' && isOverdue(task.due_date)
                                ? 'font-medium text-destructive'
                                : ''
                            }`}
                          >
                            <Calendar className="h-3 w-3" />
                            {formatDueDate(task.due_date)}
                            {task.status !== 'done' && isOverdue(task.due_date) ? ' · Overdue' : ''}
                          </span>
                        )}
                        {task.case_id ? (
                          <Link
                            href={`/cases/${task.case_id}`}
                            className="flex items-center gap-1 text-primary hover:underline"
                          >
                            <Briefcase className="h-3 w-3" />
                            View case
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Firm to-do</span>
                        )}
                      </div>

                      {taskErrors[task.id] && (
                        <p className="text-[12px] text-destructive">{taskErrors[task.id]}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}