// src/app/(dashboard)/lawyer/page.tsx
//
// REDESIGN, THIS SESSION. Rebuilt against the real, pasted
// src/app/documents/page.tsx for the actual design-token vocabulary
// (bg-primary rail, bg-background/bg-card, text-muted-foreground,
// border-border, font-serif headings, rounded-md, Loader2/AlertCircle/
// Inbox state icons) -- same "consistency over novelty" reasoning that
// file's own header gives, reused verbatim here. Prior draft of this
// page used an invented ad-hoc palette (arbitrary hex ink/brass/oxblood
// tokens) that did not match the rest of the app -- this replaces that
// entirely.
//
// (dashboard) is a Next.js route group -- this page's real URL is
// /lawyer, not /dashboard/lawyer. CONFIRMED, this session: no shared
// layout.tsx exists for the (dashboard) group (only the root layout
// does) -- so, same as documents/page.tsx's own repeatedly-flagged
// posture, the nav rail below is inline JSX on this one page, not a
// shared shell. Only visible from /lawyer, not from any other page --
// carried forward as the same known, accepted gap documents/page.tsx
// already names, not a new one introduced here.
//
// Rail buttons mirror documents/page.tsx's exactly (Notifications,
// Documents, Billing, Plans, Create firm, Audit log, Settings) with
// "Dashboard" (this page) marked aria-current instead of "Documents" --
// same static, no-pathname-awareness, no-role-awareness posture that
// file's own comments flag for its identical rail. Not re-litigated
// here.
//
// NEW, THIS SESSION -- Add case. Wired against the real, pasted
// POST /api/cases (route.ts), which requires { firmId, teamId, title }
// -- confirmed via case.service.ts#createCase() and its
// requireCaseCreateAccess() gate: a solo case (teamId: null) needs the
// caller to be a member of firmId (any role, Decision #60), not just a
// title. This page therefore has to resolve "the current lawyer's own
// firm id" before it can create a case.
//
// FLAGGED, UNVERIFIED SHAPE, real limitation: this page calls
// GET /api/billing/firms/mine to resolve that firmId (per PROJECT_PROGRESS,
// this route was added during the Billing module build), but that
// route's actual response shape was NOT pasted or source-verified this
// session -- resolveMyFirmId() below assumes the same `{ data: {...} }`
// wrapper every other route in this project uses, with the firm id at
// `data.id`. If the real shape differs, case creation will surface a
// clear inline error ("Couldn't load your firm...") rather than crash,
// but the fix is to paste that route's real source so this assumption
// can be corrected. Every task/hearing/case NEW-CASE-ONLY api call in
// this file is otherwise built directly against real, pasted
// case.service.ts / route.ts source.
//
// Same data contract as before for the dashboard fetch itself
// (GET /api/dashboard/lawyer) -- forbidden/error/loading branches
// unchanged in behavior, only restyled. Search + task grouping +
// hearing countdown features from the prior pass are kept, restyled to
// the real token system.

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Plus,
  FileText,
  Scale,
  LayoutDashboard,
  FolderOpen,
  Bell,
  Settings,
  Loader2,
  AlertCircle,
  Inbox,
  CreditCard,
  ScrollText,
  Tag,
  Building2,
  Gavel,
  MapPin,
  X,
  Sparkles,
  MessageCircle,
  ArrowRight,
} from 'lucide-react';
import { NotificationsPanel } from '@/shared/components/notifications/notifications-panel';

interface CaseRow {
  id: string;
  title: string;
  status: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  case_id: string | null;
}

interface HearingRow {
  id: string;
  case_id: string;
  hearing_type: string;
  hearing_date: string;
  court_name: string | null;
  location: string | null;
}

interface DashboardData {
  myCases: CaseRow[];
  myTasks: TaskRow[];
  upcomingHearings: HearingRow[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysUntil(iso: string): number {
  return Math.round((startOfDay(new Date(iso)).getTime() - startOfDay(new Date()).getTime()) / 86_400_000);
}

function urgencyLabel(days: number): string {
  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

/**
 * Today's Legal Briefing -- deterministic sentence built purely from
 * counts already derived from the existing dashboard fetch (no AI call,
 * no extra request). hearingsToday = hearings landing on today's date;
 * pendingTasks reuses the same "overdue + due this week" definition
 * already shown in the summary strip's "Tasks due within 7 days" card,
 * so the sentence and the card can never disagree.
 */
function buildBriefing(hearingsToday: number, pendingTasks: number): string {
  if (hearingsToday === 0 && pendingTasks === 0) {
    return "You're all clear today. No hearings or urgent tasks are scheduled.";
  }

  const parts: string[] = [];
  if (hearingsToday > 0) {
    parts.push(`${hearingsToday} hearing${hearingsToday === 1 ? '' : 's'}`);
  }
  if (pendingTasks > 0) {
    parts.push(`${pendingTasks} pending task${pendingTasks === 1 ? '' : 's'}`);
  }

  return `You have ${parts.join(' and ')} today.`;
}

/**
 * FLAGGED, UNVERIFIED SHAPE -- see file header. Assumes
 * GET /api/billing/firms/mine returns `{ data: { id: string, ... } }`,
 * matching every other route in this project's confirmed `{ data }`
 * wrapper convention, with the firm id at `data.id`. Not independently
 * source-verified this session.
 */
async function resolveMyFirmId(): Promise<string> {
  const res = await fetch('/api/billing/firms/mine', { credentials: 'include' });
  if (!res.ok) {
    throw new Error('Could not resolve your firm.');
  }
  const json = await res.json();
  const firmId = json?.data?.id;
  if (typeof firmId !== 'string' || firmId.length === 0) {
    throw new Error('Could not resolve your firm.');
  }
  return firmId;
}

function NewCaseModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (newCase: CaseRow) => void;
}) {
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Give the case a title.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const firmId = await resolveMyFirmId();

      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ firmId, teamId: null, title: trimmed }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? 'Failed to create case.');
      }

      onCreated(json.data as CaseRow);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create case.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-[19px] text-foreground">New case</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="case-title" className="mb-1.5 block text-[13px] font-medium text-foreground">
              Case title
            </label>
            <input
              id="case-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sharma vs. Patel — Property Dispute"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isSubmitting ? 'Creating…' : 'Create case'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LawyerDashboardPage() {
  const router = useRouter();

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [query, setQuery] = useState('');
  const [isNewCaseOpen, setIsNewCaseOpen] = useState(false);

  const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setLoading(true);
      setError(null);
      setForbidden(false);

      try {
        const res = await fetch('/api/dashboard/lawyer', { credentials: 'include' });

        if (res.status === 403) {
          if (!cancelled) setForbidden(true);
          return;
        }

        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to load dashboard.');
        if (!cancelled) setData(json.data as DashboardData);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDashboard();
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();

  const filteredCases = useMemo(() => {
    if (!data) return [];
    if (!q) return data.myCases;
    return data.myCases.filter((c) => c.title.toLowerCase().includes(q) || c.status.toLowerCase().includes(q));
  }, [data, q]);

  const filteredTasks = useMemo(() => {
    if (!data) return [];
    const base = !q
      ? data.myTasks
      : data.myTasks.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.status.toLowerCase().includes(q) ||
            (t.case_id ?? '').toLowerCase().includes(q),
        );
    return [...base].sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    });
  }, [data, q]);

  const filteredHearings = useMemo(() => {
    if (!data) return [];
    const base = !q
      ? data.upcomingHearings
      : data.upcomingHearings.filter(
          (h) =>
            h.hearing_type.toLowerCase().includes(q) ||
            (h.court_name ?? '').toLowerCase().includes(q) ||
            (h.location ?? '').toLowerCase().includes(q) ||
            h.case_id.toLowerCase().includes(q),
        );
    return [...base].sort((a, b) => new Date(a.hearing_date).getTime() - new Date(b.hearing_date).getTime());
  }, [data, q]);

  const taskGroups = useMemo(() => {
    const overdue: TaskRow[] = [];
    const thisWeek: TaskRow[] = [];
    const later: TaskRow[] = [];
    for (const t of filteredTasks) {
      if (!t.due_date) {
        later.push(t);
        continue;
      }
      const d = daysUntil(t.due_date);
      if (d < 0) overdue.push(t);
      else if (d <= 7) thisWeek.push(t);
      else later.push(t);
    }
    return { overdue, thisWeek, later };
  }, [filteredTasks]);

  const nextHearing = filteredHearings[0] ?? null;

  // Today's Legal Briefing -- derived entirely from data already fetched
  // by the existing GET /api/dashboard/lawyer call above (data.upcomingHearings,
  // taskGroups). No additional request, no AI call. Uses the unfiltered
  // dashboard data (not filteredHearings/filteredTasks) so the search box
  // never changes what "today" reports.
  const hearingsToday = useMemo(() => {
    if (!data) return 0;
    return data.upcomingHearings.filter((h) => daysUntil(h.hearing_date) === 0).length;
  }, [data]);

  // Unfiltered (not taskGroups, which is derived from the search-box-
  // filtered list) -- the briefing should reflect the lawyer's real
  // workload regardless of what they've typed into the search box.
  const pendingTasksCount = useMemo(() => {
    if (!data) return 0;
    return data.myTasks.filter((t) => t.due_date !== null && daysUntil(t.due_date) <= 7).length;
  }, [data]);

  const briefing = useMemo(
    () => buildBriefing(hearingsToday, pendingTasksCount),
    [hearingsToday, pendingTasksCount],
  );

  const handleCaseCreated = (newCase: CaseRow) => {
    setData((prev) => (prev ? { ...prev, myCases: [newCase, ...prev.myCases] } : prev));
    setIsNewCaseOpen(false);
  };

  return (
    <div className="relative flex h-screen w-full bg-background font-sans text-foreground">
      {/* Left rail -- inline, see file header re: no shared (dashboard) layout */}
      <aside className="flex w-16 flex-col items-center bg-primary py-5">
        <div className="mb-8 flex h-9 w-9 items-center justify-center rounded-md bg-primary-foreground/15">
          <Scale className="h-[18px] w-[18px] text-primary-foreground" strokeWidth={1.75} />
        </div>
        <nav className="flex flex-1 flex-col items-center gap-1">
          <button
            className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-foreground/10 text-primary-foreground"
            aria-current="page"
            aria-label="Dashboard"
          >
            <LayoutDashboard className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
          <button
            onClick={() => router.push('/documents')}
            className="flex h-10 w-10 items-center justify-center rounded-md text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
            aria-label="Documents"
          >
            <FolderOpen className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
          <button
            onClick={() => setIsNotificationsPanelOpen((prev) => !prev)}
            className="relative flex h-10 w-10 items-center justify-center rounded-md text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
            aria-label="Notifications"
            aria-expanded={isNotificationsPanelOpen}
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-destructive-foreground">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          <button
            onClick={() => router.push('/billing/subscription')}
            className="flex h-10 w-10 items-center justify-center rounded-md text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
            aria-label="Billing"
          >
            <CreditCard className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
          <button
            onClick={() => router.push('/pricing')}
            className="flex h-10 w-10 items-center justify-center rounded-md text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
            aria-label="Plans"
          >
            <Tag className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
          <button
            onClick={() => router.push('/billing/firms/new')}
            className="flex h-10 w-10 items-center justify-center rounded-md text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
            aria-label="Create firm"
          >
            <Building2 className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
          <button
            onClick={() => router.push('/audit-log/firm')}
            className="flex h-10 w-10 items-center justify-center rounded-md text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
            aria-label="Audit log"
          >
            <ScrollText className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-md text-primary-foreground/40"
            aria-label="Settings"
          >
            <Settings className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
        </nav>
      </aside>

      <NotificationsPanel
        isOpen={isNotificationsPanelOpen}
        onClose={() => setIsNotificationsPanelOpen(false)}
        onUnreadCountChange={setUnreadCount}
      />

      {isNewCaseOpen && (
        <NewCaseModal onClose={() => setIsNewCaseOpen(false)} onCreated={handleCaseCreated} />
      )}

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-border px-8 py-6">
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              JurisAI
            </p>
            <h1 className="font-serif text-[26px] leading-none text-foreground">
              My cases, tasks &amp; hearings
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search cases, tasks, hearings"
                className="w-56 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
            <button
              onClick={() => setIsNewCaseOpen(true)}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              New case
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-8 py-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Loading your docket…</p>
            </div>
          ) : forbidden ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card py-24 text-muted-foreground">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">This dashboard is only available to lawyer accounts.</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">{error}</p>
            </div>
          ) : data ? (
            <div className="space-y-10">
              {/* Today's Legal Briefing + Ask JurisAI */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-5 py-4 lg:col-span-2">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <Sparkles className="h-[18px] w-[18px] text-primary" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Today&apos;s legal briefing
                    </p>
                    <p className="mt-1 text-[15px] text-foreground">{briefing}</p>
                  </div>
                </div>
                <button
                  onClick={() => router.push('/documents')}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-5 py-4 text-left transition-colors hover:bg-muted"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <MessageCircle className="h-[18px] w-[18px] text-primary" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-foreground">Ask JurisAI</p>
                    <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                      Chat about a document&apos;s analysis
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                </button>
              </div>

              {/* Summary strip */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-5 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <FileText className="h-[18px] w-[18px] text-primary" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-foreground">{data.myCases.length}</p>
                    <p className="text-[12px] text-muted-foreground">Active cases</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-5 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <FileText className="h-[18px] w-[18px] text-primary" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-foreground">
                      {taskGroups.overdue.length + taskGroups.thisWeek.length}
                    </p>
                    <p className="text-[12px] text-muted-foreground">Tasks due within 7 days</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-5 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <Gavel className="h-[18px] w-[18px] text-primary" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-[15px] font-semibold text-foreground">
                      {nextHearing ? urgencyLabel(daysUntil(nextHearing.hearing_date)) : '—'}
                    </p>
                    <p className="text-[12px] text-muted-foreground">Next hearing</p>
                  </div>
                </div>
              </div>

              {/* Hearings */}
              <section>
                <h2 className="font-serif text-[17px] text-foreground">
                  Upcoming hearings{' '}
                  <span className="font-sans text-[13px] font-normal text-muted-foreground">
                    ({filteredHearings.length})
                  </span>
                </h2>
                {filteredHearings.length === 0 ? (
                  <div className="mt-3 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-muted-foreground">
                    <Inbox className="h-5 w-5" />
                    <p className="text-[13px]">
                      {q ? 'No hearings match your search.' : 'No hearings on the docket.'}
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
                    {filteredHearings.map((h) => {
                      const d = daysUntil(h.hearing_date);
                      const urgent = d <= 1;
                      const soon = d > 1 && d <= 7;
                      return (
                        <div key={h.id} className="flex items-center gap-4 px-5 py-4">
                          <div
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${
                              urgent ? 'bg-destructive/10' : soon ? 'bg-primary/10' : 'bg-muted'
                            }`}
                          >
                            <Gavel
                              className={`h-[18px] w-[18px] ${
                                urgent ? 'text-destructive' : soon ? 'text-primary' : 'text-muted-foreground'
                              }`}
                              strokeWidth={1.5}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[14px] font-medium text-foreground">
                              {h.hearing_type} · Case {shortId(h.case_id)}
                            </p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                              <span>{formatDateTime(h.hearing_date)}</span>
                              {h.court_name && <span>{h.court_name}</span>}
                              {h.location && (
                                <span className="inline-flex items-center gap-1">
                                  <MapPin className="h-3 w-3" /> {h.location}
                                </span>
                              )}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                              urgent
                                ? 'bg-destructive/10 text-destructive'
                                : soon
                                  ? 'bg-primary/10 text-primary'
                                  : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {urgencyLabel(d)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Tasks */}
              <section>
                <h2 className="font-serif text-[17px] text-foreground">
                  My tasks{' '}
                  <span className="font-sans text-[13px] font-normal text-muted-foreground">
                    ({filteredTasks.length})
                  </span>
                </h2>
                {filteredTasks.length === 0 ? (
                  <div className="mt-3 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-muted-foreground">
                    <Inbox className="h-5 w-5" />
                    <p className="text-[13px]">{q ? 'No tasks match your search.' : 'Nothing assigned to you.'}</p>
                  </div>
                ) : (
                  <div className="mt-3 space-y-5">
                    {(
                      [
                        ['Overdue', taskGroups.overdue],
                        ['Due this week', taskGroups.thisWeek],
                        ['Later', taskGroups.later],
                      ] as const
                    ).map(([label, rows]) =>
                      rows.length === 0 ? null : (
                        <div key={label}>
                          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {label} ({rows.length})
                          </p>
                          <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
                            {rows.map((t) => (
                              <div key={t.id} className="flex items-center gap-4 px-5 py-3.5">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[14px] font-medium text-foreground">{t.title}</p>
                                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                                    {t.case_id ? `Case ${shortId(t.case_id)}` : 'Standalone'}
                                    {t.due_date ? ` · Due ${formatDate(t.due_date)}` : ''}
                                  </p>
                                </div>
                                <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                  {t.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </section>

              {/* Cases */}
              <section>
                <h2 className="font-serif text-[17px] text-foreground">
                  My cases{' '}
                  <span className="font-sans text-[13px] font-normal text-muted-foreground">
                    ({filteredCases.length})
                  </span>
                </h2>
                {filteredCases.length === 0 ? (
                  <div className="mt-3 flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-muted-foreground">
                    <Inbox className="h-6 w-6" />
                    <p className="text-[13px]">{q ? 'No cases match your search.' : 'No cases yet.'}</p>
                    {!q && (
                      <button
                        onClick={() => setIsNewCaseOpen(true)}
                        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                        Create your first case
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
                    {filteredCases.map((c) => (
                      <div key={c.id} className="flex items-center gap-4 px-5 py-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                          <FileText className="h-[18px] w-[18px] text-primary" strokeWidth={1.5} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-medium text-foreground">{c.title}</p>
                          <p className="mt-0.5 text-[12px] text-muted-foreground">
                            Updated {formatDate(c.updated_at)}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                          {c.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}