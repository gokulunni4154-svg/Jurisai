// REAL FILE PATH: src/app/tasks/mine/page.tsx
//
// LAWYER TERMINAL — TASKS & DEADLINES. Rebuilt this session per the
// "Tasks & Deadlines" task brief: INSPECTION-FIRST, reuse existing
// architecture, implement only genuine gaps.
//
// INSPECTION FINDINGS this session (see the implementation report
// delivered alongside this change for the full writeup):
//   - Task Management (TaskRepository/TaskService/task.schemas.ts/API
//     routes: /api/tasks/mine, /api/tasks/[id], /api/cases/[id]/tasks,
//     /api/firms/[id]/tasks) already existed in full, built across
//     earlier sessions. NONE of that was rebuilt.
//   - This page already existed as a real "My Tasks" view (GET
//     /api/tasks/mine, PATCH /api/tasks/[id] to advance status). It is
//     kept as the visibility/data foundation — TaskService#listMyTasks()
//     (assignee-scoped, requires only authentication) is also exactly
//     what LawyerDashboardService#getDashboard() itself uses for "my
//     tasks", so this page's scope matches the project's own established
//     definition of "my tasks" everywhere else it already appears. No
//     new API, Service, or Repository method was created.
//   - src/shared/components/layout/app-sidebar.tsx (the first shared
//     app shell in this project, added for the Documents page) ALREADY
//     lists "Tasks & Deadlines" pointing at this exact route
//     (/tasks/mine) — it just weren't wired to a full page yet, and its
//     `active` prop only accepted 'documents'. That prop was widened to
//     accept 'tasks' (one-line change, shared component, see that
//     file's own diff) so this page can render the same navigation
//     shell used by /documents, matching Step 19's instruction to reuse
//     the established Lawyer Terminal visual system rather than
//     inventing a second sidebar.
//   - RLS on `tasks` (20260814000000_create-tasks-table.sql) already
//     implements every visibility rule the brief asks for (own-firm
//     only, own-case only, assignee always sees their own row, no
//     cross-firm leakage) — verified against the brief's STEP 5/21
//     scenarios. NOT modified. No migration was created for this task.
//
// GENUINE GAP THIS SESSION ADDRESSES: there was no dedicated Tasks &
// Deadlines workspace — only a plain list. This rebuild adds, ON TOP OF
// THE SAME EXISTING DATA FETCH (no additional API calls):
//   - A summary strip (Overdue / Due Today / Due This Week / Completed)
//   - Deadline-bucketed sections (Overdue, Due Today, Due Tomorrow, Due
//     This Week, Upcoming, No Due Date, Completed) — computed client-side
//     from the two real schema fields that exist (`status`, `due_date`);
//     no new fields or enums invented, matching task.schemas.ts's own
//     documented v1 scope (no overdue-tracking column).
//   - Search across title/description/case_id — client-side, over the
//     already-authorized dataset returned by GET /api/tasks/mine (no
//     unauthorized data is ever fetched to filter down from).
//   - A status filter (All / To do / In progress / Done), same schema
//     enum task.schemas.ts already defines.
//   - The same click-to-advance status interaction and "View case" link
//     the prior version of this page had, unchanged in behavior.
//
// DELIBERATELY NOT ADDED, per the brief's own restraint rules:
//   - No task creation UI on this page. createTask() has no
//     "assign-to-self, standalone of any case/firm" path — every task
//     is case-linked or firm-standalone at creation, both of which need
//     context (a case id or firm id) this self-scoped page doesn't
//     have. Case-linked and firm-standalone creation already exist on
//     their own pages (case detail / firm to-dos) and are reused via the
//     "View case" link, not duplicated here.
//   - No Delete action — task.service.ts's own documented rule is that
//     the assignee may never delete their own task (tasks_delete RLS
//     deliberately excludes the assignee path); since every task shown
//     here has the current user as assignee, Delete is correctly never
//     rendered, not merely relied upon to 403.
//   - No new RLS, no new migration, no new Repository/Service methods.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Loader2,
  AlertCircle,
  ListTodo,
  Calendar,
  Briefcase,
  Search,
  Bell,
  Inbox,
  AlertTriangle,
  CheckCircle2,
  Clock,
  CalendarDays,
} from 'lucide-react';
import { AppSidebar } from '@/shared/components/layout/app-sidebar';
import { NotificationsPanel } from '@/shared/components/notifications/notifications-panel';

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

const STATUS_FILTERS: Array<{ value: 'all' | TaskStatus; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

// Copied verbatim from documents/[id]/page.tsx (File 160), same as the
// other task views.
async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

// FIX, tsc pass — dateString.split('-').map(Number) destructured
// directly into year/month/day was TS(2532/18048)-class: with
// noUncheckedIndexedAccess on, each destructured element is typed
// `number | undefined`, so `month - 1` doesn't compile against
// Date.UTC's `number` parameter. Shared helper validates all three
// parts are real numbers once. Throws for a malformed date string
// rather than silently coercing — `due_date` is expected to always be
// a real ISO 'YYYY-MM-DD' string from the API.
function parseIsoDateParts(dateString: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateString.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid ISO date string: "${dateString}"`);
  }
  return { year, month, day };
}

function toUtcMidnight(dateString: string): number {
  const { year, month, day } = parseIsoDateParts(dateString);
  return Date.UTC(year, month - 1, day);
}

function formatDueDate(dateString: string): string {
  const { year, month, day } = parseIsoDateParts(dateString);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function todayUtcMidnight(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

// A due date strictly before today (UTC calendar-date comparison) — used
// for the visual "overdue" cue. NOT a persisted product feature:
// task.schemas.ts's own comment states there is deliberately no
// overdue-tracking column in v1, so this is purely a client-side
// classification derived from the real `due_date` column, same posture
// the previous version of this page already used.
function isOverdue(dateString: string): boolean {
  return toUtcMidnight(dateString) < todayUtcMidnight();
}

type Bucket = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'upcoming' | 'noDueDate' | 'completed';

const BUCKET_META: Record<Bucket, { label: string; icon: typeof Calendar }> = {
  overdue: { label: 'Overdue', icon: AlertTriangle },
  today: { label: 'Due today', icon: Clock },
  tomorrow: { label: 'Due tomorrow', icon: Clock },
  thisWeek: { label: 'Due this week', icon: CalendarDays },
  upcoming: { label: 'Upcoming', icon: CalendarDays },
  noDueDate: { label: 'No due date', icon: ListTodo },
  completed: { label: 'Completed', icon: CheckCircle2 },
};

const BUCKET_DISPLAY_ORDER: Bucket[] = [
  'overdue',
  'today',
  'tomorrow',
  'thisWeek',
  'upcoming',
  'noDueDate',
  'completed',
];

// Buckets a task using only the two real schema fields that exist
// (`status`, `due_date`) — no invented fields or states. `done` tasks
// always land in `completed` regardless of due date, matching how a
// completed item is understood everywhere else in the app (e.g. the
// click-to-advance status pill). Everything else is bucketed purely by
// calendar distance from today (UTC calendar-date comparison, same
// convention formatDueDate/isOverdue already use).
function bucketFor(task: TaskRow): Bucket {
  if (task.status === 'done') return 'completed';
  if (!task.due_date) return 'noDueDate';

  const due = toUtcMidnight(task.due_date);
  const today = todayUtcMidnight();
  const diffDays = Math.round((due - today) / 86_400_000);

  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays <= 7) return 'thisWeek';
  return 'upcoming';
}

export default function TasksAndDeadlinesPage() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');

  const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    setForbidden(false);
    try {
      const res = await fetch('/api/tasks/mine', { credentials: 'include' });
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      // Real confirmed envelope + ordering (due_date asc, nulls last) —
      // not re-sorted client-side; see file header.
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

  const q = query.trim().toLowerCase();

  // Search + filter over the already-authorized dataset only — no
  // additional fetch, no unauthorized data ever touched. Fields match
  // what actually exists on the row (title, description, case_id) —
  // no invented searchable fields.
  const visibleTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q) ||
        (t.case_id ?? '').toLowerCase().includes(q)
      );
    });
  }, [tasks, statusFilter, q]);

  const grouped = useMemo(() => {
    const groups: Record<Bucket, TaskRow[]> = {
      overdue: [],
      today: [],
      tomorrow: [],
      thisWeek: [],
      upcoming: [],
      noDueDate: [],
      completed: [],
    };
    for (const task of visibleTasks) {
      groups[bucketFor(task)].push(task);
    }
    return groups;
  }, [visibleTasks]);

  // Summary strip counts — derived from the unfiltered dataset so the
  // strip reflects the lawyer's real workload regardless of what's
  // typed into search/status filter, same reasoning the Lawyer
  // Dashboard's own briefing/summary cards already use (unfiltered
  // counts, filtered lists).
  const summary = useMemo(() => {
    let overdue = 0;
    let dueToday = 0;
    let dueThisWeek = 0; // today + tomorrow + rest of week
    let completed = 0;
    for (const task of tasks) {
      const bucket = bucketFor(task);
      if (bucket === 'completed') completed += 1;
      if (bucket === 'overdue') overdue += 1;
      if (bucket === 'today') dueToday += 1;
      if (bucket === 'today' || bucket === 'tomorrow' || bucket === 'thisWeek') dueThisWeek += 1;
    }
    return { overdue, dueToday, dueThisWeek, completed };
  }, [tasks]);

  const hasAnyVisibleTasks = visibleTasks.length > 0;
  const isFiltering = q.length > 0 || statusFilter !== 'all';

  return (
    <div className="flex h-screen w-full bg-muted/30 font-sans text-foreground">
      <AppSidebar active="tasks" />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-background px-8 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <ListTodo className="h-5 w-5 text-primary" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-[19px] font-semibold leading-tight text-foreground">
                Tasks &amp; Deadlines
              </h1>
              <p className="text-[12.5px] text-muted-foreground">
                Everything assigned to you, across every case and firm to-do.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title, description, case…"
                className="w-56 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | TaskStatus)}
              className="rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none"
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>

            <button
              onClick={() => setIsNotificationsPanelOpen((v) => !v)}
              className="relative flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" strokeWidth={1.75} />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-destructive-foreground">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        <NotificationsPanel
          isOpen={isNotificationsPanelOpen}
          onClose={() => setIsNotificationsPanelOpen(false)}
          onUnreadCountChange={setUnreadCount}
        />

        <main className="flex-1 overflow-y-auto px-8 py-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Loading your tasks…</p>
            </div>
          ) : forbidden ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card py-24 text-muted-foreground">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">You don&apos;t have access to this workspace.</p>
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
            <div className="mx-auto flex max-w-4xl flex-col gap-6">
              {/* Summary strip */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-5 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-destructive/10">
                    <AlertTriangle className="h-[18px] w-[18px] text-destructive" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-foreground">{summary.overdue}</p>
                    <p className="text-[12px] text-muted-foreground">Overdue</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-5 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <Clock className="h-[18px] w-[18px] text-primary" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-foreground">{summary.dueToday}</p>
                    <p className="text-[12px] text-muted-foreground">Due today</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-5 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <CalendarDays className="h-[18px] w-[18px] text-primary" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-foreground">{summary.dueThisWeek}</p>
                    <p className="text-[12px] text-muted-foreground">Due this week</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-5 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-500/10">
                    <CheckCircle2 className="h-[18px] w-[18px] text-emerald-700" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-foreground">{summary.completed}</p>
                    <p className="text-[12px] text-muted-foreground">Completed</p>
                  </div>
                </div>
              </div>

              {/* Task groups */}
              {!hasAnyVisibleTasks ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card py-20 text-muted-foreground">
                  <Inbox className="h-6 w-6" />
                  <p className="text-[13px]">
                    {isFiltering
                      ? 'No tasks match your search or filter.'
                      : tasks.length === 0
                        ? 'No tasks yet.'
                        : 'No tasks match your search or filter.'}
                  </p>
                  {!isFiltering && tasks.length === 0 && (
                    <p className="text-[12px] text-muted-foreground/80">
                      Tasks assigned to you on a case, or as a firm to-do, will show up here.
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  {BUCKET_DISPLAY_ORDER.map((bucket) => {
                    const rows = grouped[bucket];
                    if (rows.length === 0) return null;
                    const meta = BUCKET_META[bucket];
                    const BucketIcon = meta.icon;

                    return (
                      <section key={bucket}>
                        <div className="mb-2 flex items-center gap-2">
                          <BucketIcon
                            className={`h-4 w-4 ${bucket === 'overdue' ? 'text-destructive' : 'text-muted-foreground'}`}
                            strokeWidth={1.75}
                          />
                          <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
                            {meta.label} ({rows.length})
                          </h2>
                        </div>

                        <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
                          {rows.map((task) => (
                            <div key={task.id} className="flex flex-col gap-2 px-5 py-3.5">
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
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
