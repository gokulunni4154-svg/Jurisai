// REAL FILE PATH: src/app/firms/[id]/tasks/page.tsx
//
// NEW FILE, THIS SESSION — standalone (non-case) firm to-do list.
// Second of the two remaining Task Management frontend views (case-
// linked task list was built earlier this session, in
// case-detail-page.tsx / src/app/cases/[id]/page.tsx).
//
// Built against real, pasted source:
//   - case-detail-page.tsx (this session, earlier) — this file is a
//     direct structural adaptation of that page's TasksSection: same
//     create-form shape, same click-to-advance status pill, same
//     always-rendered Delete button with server-side enforcement (see
//     that file's own flagged note on why), same extractErrorMessage()
//     helper, same section/card/Loader2/lucide conventions traced back
//     to documents/[id]/page.tsx (File 160).
//   - firms/[id]/tasks/route.ts (this session) — real GET/POST shapes.
//     GET returns { data: tasks }. POST's [id] param IS the
//     authoritative firmId (no derivation needed, unlike the
//     case-linked route) — body only needs task fields.
//   - tasks/[id]/route.ts (this session) — same PATCH/DELETE used by
//     case-detail-page.tsx, reused verbatim here (task update/delete
//     doesn't differ by whether the task is case-linked or standalone).
//   - task.repository.ts / task.service.ts (this session) — same real
//     `tasks` row shape as case-detail-page.tsx uses. For a standalone
//     task, `case_id` is always null — not rendered here since it
//     carries no information on this page.
//
// FLAGGED, KEY DECISION — REAL GAP, NOT SOLVED HERE: unlike
// cases/[id]/route.ts, no GET /api/firms/[id] route (or firm.entity.ts
// / firm.repository.ts / firm.service.ts of any kind) was ever pasted
// in any session. There is therefore no confirmed `Firm` row shape at
// all — not even a firm name. This page's header deliberately shows
// only the raw firmId from the URL, NOT a fetched firm name, rather
// than inventing a GET /api/firms/[id] call against an unconfirmed
// response shape. Revisit once a real firms module exists — swap the
// header's raw-id display for a fetched name at that point.
//
// FLAGGED — REAL GAP CARRIED FORWARD FROM PROJECT NOTES: per
// PROJECT_PROGRESS_52.md and this session's own re-pasted
// firms/[id]/tasks/route.ts, the POST handler there is STILL not
// wired to createTaskInputSchema (task.schemas.ts) — it passes
// body.title/body.description/etc. through with only `?? null`
// fallbacks, no real validation. This page's create-task form sends
// the exact same field names createTaskInputSchema defines (title,
// description, assigneeProfileId, dueDate) so it will validate
// cleanly the moment that route is wired up — but until then, a
// malformed body from a source other than this form (e.g. a stray
// curl request) would surface as a raw DatabaseError, not a clean
// ValidationError. Not this file's bug to fix; flagged for whoever
// picks up the route-hardening item.
//
// SAME FLAGGED GAPS AS case-detail-page.tsx, carried forward
// unchanged: no profiles/members-lookup endpoint exists, so
// `assigneeProfileId` is a plain UUID text input, not a picker; this
// page cannot determine "am I the assignee" client-side, so Delete is
// always rendered and relies on the Service's real 403 to reject an
// assignee-only caller.

'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  ListTodo,
  Plus,
  Trash2,
  Calendar,
  User,
} from 'lucide-react';

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

// Copied verbatim from documents/[id]/page.tsx (File 160), same as
// case-detail-page.tsx.
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

export default function FirmToDosPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const firmId = params.id;

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/firms/${firmId}/tasks`, { credentials: 'include' });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      // Real confirmed envelope: { data: tasks } — see
      // firms/[id]/tasks/route.ts's own GET handler. Not re-sorted
      // client-side: TaskRepository#findStandaloneByFirmId already
      // orders `created_at desc` server-side, confirmed from its own
      // pasted source.
      setTasks(json.data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load firm to-dos.');
    } finally {
      setIsLoading(false);
    }
  }, [firmId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

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
            JurisAI · Firm To-Dos
          </p>
          {/* No firm name available — see file header. Raw firmId
              shown as a fallback rather than a fetched, unconfirmed
              field. */}
          <h1 className="truncate font-serif text-[24px] leading-none text-foreground">
            Firm To-Dos
          </h1>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{firmId}</p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-8 py-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-[13px]">Loading to-dos…</p>
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
            <StandaloneTasksSection firmId={firmId} tasks={tasks} onTasksChanged={setTasks} />
          </div>
        )}
      </main>
    </div>
  );
}

// ---- Standalone to-dos section ----
//
// Structural twin of case-detail-page.tsx's TasksSection, with two
// real differences: (1) POST target is /api/firms/[id]/tasks, not
// /api/cases/[id]/tasks, and the body sends no case-linkage fields at
// all (createTask() sets case_id: null server-side for this route);
// (2) no "advance status" restriction messaging differs — identical
// PATCH/DELETE behavior either way, since TaskService#updateTask()/
// #deleteTask() don't branch on case-linked vs. standalone beyond the
// access-check path they already run internally.

function StandaloneTasksSection({
  firmId,
  tasks,
  onTasksChanged,
}: {
  firmId: string;
  tasks: TaskRow[];
  onTasksChanged: (tasks: TaskRow[]) => void;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeProfileId, setAssigneeProfileId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setAssigneeProfileId('');
    setDueDate('');
    setCreateError(null);
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setCreateError('Title cannot be empty.');
      return;
    }

    setIsCreating(true);
    try {
      // Field names match createTaskInputSchema exactly — see file
      // header's flagged note: this route isn't Zod-validated yet, but
      // this body will validate cleanly once it is.
      const res = await fetch(`/api/firms/${firmId}/tasks`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          description: description.trim() === '' ? null : description.trim(),
          assigneeProfileId: assigneeProfileId.trim() === '' ? null : assigneeProfileId.trim(),
          dueDate: dueDate === '' ? null : dueDate,
        }),
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      const newTask: TaskRow = json.data;

      onTasksChanged([newTask, ...tasks]);
      resetForm();
      setShowCreateForm(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create the to-do.');
    } finally {
      setIsCreating(false);
    }
  };

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
      onTasksChanged(tasks.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      setTaskErrors((prev) => ({
        ...prev,
        [task.id]: err instanceof Error ? err.message : 'Could not update this to-do.',
      }));
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleDelete = async (task: TaskRow) => {
    setBusyTaskId(task.id);
    setTaskErrors((prev) => ({ ...prev, [task.id]: '' }));
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      onTasksChanged(tasks.filter((t) => t.id !== task.id));
    } catch (err) {
      setTaskErrors((prev) => ({
        ...prev,
        [task.id]: err instanceof Error ? err.message : 'Could not delete this to-do.',
      }));
    } finally {
      setBusyTaskId(null);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListTodo className="h-4 w-4 text-primary" strokeWidth={1.75} />
          <h2 className="font-serif text-[18px] text-foreground">Firm To-Dos</h2>
        </div>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted/50"
        >
          <Plus className="h-3.5 w-3.5" />
          {showCreateForm ? 'Cancel' : 'New to-do'}
        </button>
      </div>

      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          className="mb-5 flex flex-col gap-3 rounded-md border border-border bg-background p-4"
          noValidate
        >
          <div className="space-y-1.5">
            <label htmlFor="todo-title" className="text-[12px] font-medium text-foreground">
              Title
            </label>
            <input
              id="todo-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="todo-description" className="text-[12px] font-medium text-foreground">
              Description <span className="text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="todo-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="todo-due-date" className="text-[12px] font-medium text-foreground">
                Due date <span className="text-muted-foreground">(optional)</span>
              </label>
              <input
                id="todo-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="todo-assignee" className="text-[12px] font-medium text-foreground">
                Assignee profile ID <span className="text-muted-foreground">(optional)</span>
              </label>
              <input
                id="todo-assignee"
                type="text"
                placeholder="UUID"
                value={assigneeProfileId}
                onChange={(e) => setAssigneeProfileId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </div>
          </div>

          {createError !== null && (
            <p role="alert" className="text-[12px] text-destructive">
              {createError}
            </p>
          )}

          <button
            type="submit"
            disabled={isCreating}
            className="flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCreating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isCreating ? 'Creating…' : 'Create to-do'}
          </button>
        </form>
      )}

      {tasks.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No standalone to-dos exist for this firm yet.
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
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {formatDueDate(task.due_date)}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {task.assignee_profile_id ?? 'Unassigned'}
                </span>
                <button
                  onClick={() => handleDelete(task)}
                  disabled={busyTaskId === task.id}
                  className="ml-auto flex items-center gap-1 text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              </div>

              {taskErrors[task.id] && (
                <p className="text-[12px] text-destructive">{taskErrors[task.id]}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}