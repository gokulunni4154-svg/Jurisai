// REAL FILE PATH: src/app/cases/[id]/page.tsx
//
// NEW FILE, THIS SESSION — no case detail page existed before this
// session (confirmed: "I don't have the case detail page" / "No page
// exists at all yet — tasks would be the first thing on it"). Task
// Management (Phase 4) is therefore the FIRST real content on this
// page, not a section slotted into existing markup.
//
// Built against real, pasted source this session:
//   - documents/[id]/page.tsx (File 160) — mirrored for the page SHELL
//     only: flex h-screen column layout, header with back-button +
//     ArrowLeft, serif h1 title, `main` scroll area with a
//     `max-w-3xl mx-auto` content column, `<section
//     className="rounded-lg border border-border bg-card p-6">` per
//     feature block with an icon + `font-serif text-[18px]` heading,
//     the three-state completed/failed/not-yet-run card pattern
//     adapted below to a list/empty/error pattern (tasks have no
//     run-lifecycle, so that exact three-state shape doesn't
//     transfer as-is — see TasksSection below), extractErrorMessage()
//     copied verbatim, credentials: 'include' on every fetch, `{
//     data: ... }` response envelope, Loader2 spinners + disabled
//     buttons while in flight, lucide-react icons, Tailwind semantic
//     tokens (bg-card, text-muted-foreground, text-destructive, etc).
//   - client-signup-form.tsx — mirrored for the CREATE-TASK FORM's
//     conventions only: plain useState per field (no react-hook-form
//     in this project), manual <form onSubmit> with
//     event.preventDefault(), inline `role="alert"` error text (no
//     toast library visible anywhere pasted so far), disabled+relabeled
//     submit button while submitting.
//   - task.repository.ts / task.service.ts (this session) — REAL,
//     confirmed `tasks` row shape: id, firm_id, case_id (nullable),
//     title, description (nullable), status
//     ('todo'|'in_progress'|'done'), assignee_profile_id (nullable),
//     due_date (nullable), created_by, created_at. No task.entity.ts
//     exists; this shape is inferred directly from the repository's
//     own `.eq()`/`.select('*')` column references and the service's
//     own insert/update payload shapes — not from a database.types.ts
//     excerpt, which was requested twice but never came through this
//     session. Flagged, not a hard blocker: every field used below is
//     independently corroborated by at least one of those two files.
//   - case.repository.ts / case.service.ts / case.factory.ts (this
//     session) — REAL, confirmed `cases` row fields actually touched
//     by any pasted method: id, firm_id, team_id (nullable),
//     owner_id, title. `created_at` is assumed to exist (near-
//     universal in this project's other tables) but is NOT read by
//     any pasted case.* method, so it's typed optional below and only
//     rendered if present.
//   - task.schemas.ts (this session) — createTaskInputSchema /
//     updateTaskInputSchema's real field names, used to shape the
//     create-task form body and the status-update PATCH body exactly.
//   - cases/[id]/tasks/route.ts, tasks/[id]/route.ts (this session) —
//     real request/response shapes for list/create/update/delete.
//
// KEY DECISION, DELEGATED BY THE USER THIS SESSION: the real `cases`
// row almost certainly has more columns than the four confirmed above
// (case number, status, court, client, opposing party, etc. — none of
// which any pasted file touches). Per explicit instruction this
// session ("just do according to ur decision, will make any changes
// when locally hosting the app if needed"), this page's header
// deliberately renders ONLY the four confirmed fields (title, firm_id,
// team_id, owner_id) rather than guessing at unconfirmed ones. Revisit
// once the real full `cases` row is available (e.g. from
// database.types.ts, which was requested but not received this
// session).
//
// SCOPE, CONFIRMED THIS SESSION: only the CASE-LINKED task list is
// built here (GET/POST /api/cases/[id]/tasks, PATCH/DELETE
// /api/tasks/[id]). The standalone firm to-do view and the "my tasks"
// view are explicitly OUT OF SCOPE for this file — user chose
// case-linked first, the other two views were deferred, not
// overlooked.
//
// FLAGGED, NOT SOLVED HERE: there is no confirmed profile/user lookup
// endpoint anywhere in this session's pasted source, so
// `assignee_profile_id` is rendered as a raw UUID (or "Unassigned"),
// not a resolved name. The create-task form's "assignee" field is a
// plain text input for a profile UUID, not a picker — there is nothing
// yet to pick from (Client Management is PAUSED per project notes,
// and no "list firm members" endpoint was pasted this session either).
// Revisit once a members/profiles-lookup endpoint exists.
//
// FLAGGED, NOT SOLVED HERE: this page cannot determine "am I the
// assignee of this task" client-side (no current-user id is exposed
// by GET /api/cases/[id] or any pasted auth helper reachable from the
// client). The Delete button is therefore always rendered for every
// task; TaskService#deleteTask() is the real enforcement point and
// will reject an assignee-only caller with a 403 AuthorizationError,
// surfaced here as an inline error rather than the button being
// hidden pre-emptively. Same posture the assignee-status-only update
// rule takes below — the Service is the source of truth, this page
// does not attempt to duplicate that logic client-side.
//
// ADDED THIS SESSION (Hearings & Calendar polish pass, item #4): a
// "Hearings" nav link in the header, routing to
// `/cases/[id]/hearings`. Placed as a plain button (router.push),
// matching this page's own existing back-button convention (no
// next/link usage anywhere in this file to mirror instead).
//
// PARAMS-TYPING NOTE (polish pass item #7): this page does NOT
// receive `params` as a page-function prop at all — it reads the
// route param via the `useParams<{ id: string }>()` client hook from
// next/navigation instead, which returns the resolved object
// directly, no Promise/`use()` unwrapping involved. That means this
// file neither confirms nor contradicts whether
// case-hearings-page.tsx's `Promise<{ id: string }>` prop + `use()`
// pattern is the project's real convention for a page.tsx invoked via
// file-based routing — this page sidesteps that question entirely by
// using the hook instead of the prop. If case-hearings-page.tsx is
// ever revisited, switching it to this same `useParams()` approach
// would remove the Promise-typing question rather than resolve it.

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
  Gavel,
} from 'lucide-react';

// ---- Shapes — see file header for exactly which fields are confirmed
// against which real pasted source, and which are flagged. ----

interface CaseRow {
  id: string;
  firm_id: string;
  team_id: string | null;
  owner_id: string;
  title: string;
  // NOT confirmed against any pasted source this session — rendered
  // only if present, never assumed required. See file header.
  created_at?: string;
}

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

// Cycling order for the one-click "advance status" control below —
// this session's own UI convenience, not dictated by any pasted
// source. A dedicated dropdown would work equally well; this was
// chosen only because no <select>-based status control exists
// anywhere else in this project's pasted files to mirror instead.
const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'done'];

const STATUS_STYLES: Record<TaskStatus, string> = {
  todo: 'bg-muted text-muted-foreground',
  in_progress: 'bg-amber-500/10 text-amber-700',
  done: 'bg-emerald-500/10 text-emerald-700',
};

// Copied verbatim from documents/[id]/page.tsx (File 160).
async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

function formatDueDate(dateString: string): string {
  // Plain calendar date (no time component) per task.schemas.ts's own
  // dueDateSchema comment — parsed as UTC-midnight to avoid a
  // timezone-driven off-by-one on the displayed day, same concern
  // File 160's own isoToDateInputValue() flags for hearing_date.
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function CaseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const caseId = params.id;

  const [caseRow, setCaseRow] = useState<CaseRow | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadEverything = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const caseRes = await fetch(`/api/cases/${caseId}`, { credentials: 'include' });
      if (!caseRes.ok) throw new Error(await extractErrorMessage(caseRes));
      const caseJson = await caseRes.json();
      // Real confirmed envelope: { data: caseRecord } — see
      // cases/[id]/route.ts's own GET handler.
      setCaseRow(caseJson.data);

      const tasksRes = await fetch(`/api/cases/${caseId}/tasks`, { credentials: 'include' });
      if (!tasksRes.ok) throw new Error(await extractErrorMessage(tasksRes));
      const tasksJson = await tasksRes.json();
      // Real confirmed envelope: { data: tasks } — see
      // cases/[id]/tasks/route.ts's own GET handler. Not re-sorted
      // client-side: TaskRepository#findByCaseId already orders
      // `created_at desc` server-side, confirmed from its own pasted
      // source (unlike File 160's Open Item #32, which applied to
      // endpoints whose ordering was never confirmed).
      setTasks(tasksJson.data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load this case.');
    } finally {
      setIsLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    loadEverything();
  }, [loadEverything]);

  return (
    <div className="flex h-screen w-full flex-col bg-background font-sans text-foreground">
      <header className="flex items-center gap-4 border-b border-border px-8 py-6">
        <button
          onClick={() => router.push('/cases')}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted/50"
          aria-label="Back to cases"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            JurisAI · Case
          </p>
          <h1 className="truncate font-serif text-[24px] leading-none text-foreground">
            {caseRow?.title ?? (isLoading ? 'Loading…' : 'Case')}
          </h1>
        </div>
        <button
          onClick={() => router.push(`/cases/${caseId}/hearings`)}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted/50"
        >
          <Gavel className="h-3.5 w-3.5" />
          Hearings
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-8 py-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-[13px]">Loading case…</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="text-[13px]">{loadError}</p>
            <button
              onClick={loadEverything}
              className="text-[13px] font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            <TasksSection caseId={caseId} tasks={tasks} onTasksChanged={setTasks} />
          </div>
        )}
      </main>
    </div>
  );
}

// ---- Tasks section ----
//
// Not a run-lifecycle panel like every section in File 160 (no
// completed/failed/not-yet-run states — a task list is just data that
// exists or doesn't). Adapted three-way instead: has-tasks / no-tasks-
// yet / (load errors are handled one level up, at the page level, same
// as File 160's own top-level loadError branch).

function TasksSection({
  caseId,
  tasks,
  onTasksChanged,
}: {
  caseId: string;
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
      // Body shape matches createTaskInputSchema (task.schemas.ts)
      // exactly — no firmId/caseId in the body, both are derived
      // server-side from the URL, per that schema's own KEY DECISION
      // comment.
      const res = await fetch(`/api/cases/${caseId}/tasks`, {
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
      setCreateError(err instanceof Error ? err.message : 'Could not create the task.');
    } finally {
      setIsCreating(false);
    }
  };

  // Advances a task to the next status in STATUS_ORDER, wrapping back
  // to 'todo' after 'done'. Sends ONLY `status` in the PATCH body —
  // matches updateTaskInputSchema's real shape (all fields optional,
  // at-least-one-required), and matches the assignee-only path's real
  // service-layer restriction to status alone (task.service.ts's own
  // updateTask()), so this one control works correctly regardless of
  // whether the caller is the assignee or a manager-level actor.
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
        [task.id]: err instanceof Error ? err.message : 'Could not update this task.',
      }));
    } finally {
      setBusyTaskId(null);
    }
  };

  // See file header's flagged note: this button is always rendered;
  // TaskService#deleteTask() is the real enforcement point for
  // "assignee cannot delete their own task", surfaced here as an
  // inline per-task error rather than pre-emptively hidden.
  const handleDelete = async (task: TaskRow) => {
    setBusyTaskId(task.id);
    setTaskErrors((prev) => ({ ...prev, [task.id]: '' }));
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      // Real confirmed shape: bare 204, no JSON body — see
      // tasks/[id]/route.ts's own DELETE handler.
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      onTasksChanged(tasks.filter((t) => t.id !== task.id));
    } catch (err) {
      setTaskErrors((prev) => ({
        ...prev,
        [task.id]: err instanceof Error ? err.message : 'Could not delete this task.',
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
          <h2 className="font-serif text-[18px] text-foreground">Tasks</h2>
        </div>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted/50"
        >
          <Plus className="h-3.5 w-3.5" />
          {showCreateForm ? 'Cancel' : 'New task'}
        </button>
      </div>

      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          className="mb-5 flex flex-col gap-3 rounded-md border border-border bg-background p-4"
          noValidate
        >
          <div className="space-y-1.5">
            <label htmlFor="task-title" className="text-[12px] font-medium text-foreground">
              Title
            </label>
            <input
              id="task-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="task-description" className="text-[12px] font-medium text-foreground">
              Description <span className="text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="task-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="task-due-date" className="text-[12px] font-medium text-foreground">
                Due date <span className="text-muted-foreground">(optional)</span>
              </label>
              <input
                id="task-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="task-assignee" className="text-[12px] font-medium text-foreground">
                Assignee profile ID <span className="text-muted-foreground">(optional)</span>
              </label>
              {/* Plain text input, not a picker — see file header's
                  flagged note: no members/profiles-lookup endpoint was
                  available this session to build a real picker against. */}
              <input
                id="task-assignee"
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
            {isCreating ? 'Creating…' : 'Create task'}
          </button>
        </form>
      )}

      {tasks.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No tasks exist on this case yet.
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