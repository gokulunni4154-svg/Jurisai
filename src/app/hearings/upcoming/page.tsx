// Real path: src/app/hearings/upcoming/page.tsx
//
// LAWYER TERMINAL, TASK 3 -- HEARINGS & CALENDAR. REBUILT this session
// per the task's own Step 1-2 inspection requirement: the hearing data
// layer (HearingRepository, HearingService, hearing.schemas.ts,
// hearing.factory.ts) and every API route it needs
// (GET /api/hearings/upcoming, GET/POST /api/cases/[id]/hearings,
// PATCH/DELETE /api/hearings/[id]) already existed on main and are
// reused completely unmodified below -- no new repository, service, or
// route was added for this page. The only backend change this task
// made anywhere is a single RLS policy widening
// (20260914000000_widen_hearings_select_for_firm_managers.sql), for the
// documented firm-admin visibility gap; see that migration's own header.
//
// WHAT CHANGED ON THIS PAGE, AND WHY:
//
// 1) VISUAL REDESIGN. The previous version of this page (grouped-list,
//    then a month-grid calendar, both real and pasted in earlier
//    sessions) never adopted this project's real design-token system --
//    it used an ad-hoc `slate-*` palette and had no left rail, so it did
//    not look like it belonged to the same product as
//    (dashboard)/lawyer/page.tsx or src/app/cases/page.tsx (the
//    Matters page). Per this task's Step 8, those two files are the
//    visual source of truth; THIS file's rail markup, header shape,
//    card tokens (bg-card, border-border, text-muted-foreground,
//    font-serif headings, rounded-lg/rounded-md, Loader2/AlertCircle/
//    Inbox state icons, urgencyLabel/daysUntil semantics) are copied
//    from cases/page.tsx nearly verbatim, same "consistency over
//    novelty" posture that file's own header documents for its own
//    copy from (dashboard)/lawyer/page.tsx. Neither of those two files
//    is modified by this change (explicit instruction) -- this page
//    gets its own copy of the same inline rail, same known/accepted gap
//    every page in this family already carries (no shared layout.tsx
//    for this route or for (dashboard)), with "Hearings & Calendar"
//    marked aria-current and working links back to /lawyer and /cases.
//
// 2) REAL MONTH NAVIGATION, NOT JUST A REAL MONTH GRID. The prior
//    version's own header flagged, as a known and unresolved
//    limitation, that /api/hearings/upcoming only accepts a `from`
//    lower bound and is fetched once on mount -- so navigating to a
//    past month always rendered empty, and a future month beyond
//    whatever the initial fetch happened to cover would too. That is
//    fixed here WITHOUT any new endpoint or schema change: `from` is
//    now recomputed as the earlier of "today" and "the first of the
//    displayed month" every time the visible month changes, and the
//    page only re-fetches when that boundary moves earlier than what
//    is already loaded (moving forward within an already-loaded range
//    needs no new request, since the endpoint has no upper bound --
//    same "avoid unnecessary requests" posture Step 18 asks for). This
//    is a real product improvement using the existing, unmodified
//    HearingService#listUpcomingHearings(fromDate) contract, not a new
//    API surface.
//
// 3) SELECTED-DAY PANEL + TODAY/TOMORROW/THIS WEEK GROUPING, NEW ON
//    THIS PAGE. The prior version only ever showed the grid itself.
//    This adds a right-hand panel: quick counts (Today / This week /
//    Next hearing), a selected-day hearing list (defaults to today,
//    updates on grid-cell click), and a chronological Today/Tomorrow/
//    This week/Later rundown -- all derived client-side from the same
//    single fetched+RLS-scoped dataset the grid already uses, not a
//    second API call. Urgency badges reuse the identical
//    daysUntil()/urgencyLabel() semantics as
//    (dashboard)/lawyer/page.tsx's own "Upcoming hearings" section, so
//    the two pages can never disagree about what counts as "today" or
//    "overdue".
//
// 4) NO DUPLICATED CREATE/EDIT/DELETE UI. Per Step 10/13: hearing
//    create/edit/delete already has a complete, working implementation
//    at /cases/[id]/hearings (POST/PATCH/DELETE against the same
//    HearingService this page reads from). This page does not rebuild
//    any of that -- every hearing card and every selected-day entry
//    links out to that case's /cases/[id]/hearings page for detail,
//    editing, or deleting. This page's own job is the calendar/overview
//    experience, not hearing management.
//
// 5) SEARCH / FILTER, NEW ON THIS PAGE. Client-side only, applied to
//    the already-authorized, already-fetched dataset -- same posture
//    Step 12 requires ("client-side filtering is acceptable ONLY after
//    the server has already returned an authorized hearing dataset").
//    Text search matches case title, court name, and location (the
//    only free-text fields the hearings schema + case title join
//    actually has -- no invented fields). A hearing-type dropdown
//    filters against hearingTypeSchema's real fixed enum
//    (hearing.schemas.ts), not an invented list.
//
// 6) FIELDS SHOWN: hearing_date, hearing_type, court_name, location,
//    notes-presence (not the note body itself, to keep cards scannable
//    -- full notes are visible on the case hearings page), and the
//    joined case title. No client name, no case number, no outcome
//    surfaced here -- none of those are reliably available without a
//    second RLS-respecting fetch per hearing this page doesn't need;
//    outcome is visible on /cases/[id]/hearings, which already shows
//    it. Nothing here is invented or hardcoded.
//
// TIMEZONE / "TODAY" CONVENTION: identical to
// (dashboard)/lawyer/page.tsx's own daysUntil()/startOfDay() -- local
// (browser) time via `new Date()` and `Date#getHours` etc., not UTC.
// Deliberately reused verbatim rather than re-derived, so this page and
// the Dashboard can never classify the same hearing as "today" on one
// page and "tomorrow" on the other.

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Scale,
  LayoutDashboard,
  Briefcase,
  CalendarClock,
  FolderOpen,
  Bell,
  CreditCard,
  Tag,
  Building2,
  ScrollText,
  Settings,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  Inbox,
  Gavel,
  MapPin,
  StickyNote,
  ArrowRight,
} from 'lucide-react';
import { NotificationsPanel } from '@/shared/components/notifications/notifications-panel';

type HearingType = 'first_hearing' | 'arguments' | 'evidence' | 'judgment' | 'other';

interface Hearing {
  id: string;
  case_id: string;
  hearing_date: string;
  hearing_type: HearingType;
  court_name: string | null;
  location: string | null;
  notes: string | null;
}

const HEARING_TYPE_LABELS: Record<HearingType, string> = {
  first_hearing: 'First hearing',
  arguments: 'Arguments',
  evidence: 'Evidence',
  judgment: 'Judgment',
  other: 'Other',
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_HEARINGS_PER_CELL = 3;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
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

// Local (browser-timezone) date key -- matches how hearing_date's own
// timestamptz value should be grouped onto a calendar day for the
// viewer. Not UTC -- see file header.
function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b);
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// Identical semantics to (dashboard)/lawyer/page.tsx's own daysUntil()
// -- deliberately reused, not re-derived, so the two pages never
// disagree about "today" / "overdue". See file header.
function daysUntil(iso: string): number {
  return Math.round((startOfDay(new Date(iso)).getTime() - startOfDay(new Date()).getTime()) / 86_400_000);
}

function urgencyLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days <= 7) return `In ${days} days`;
  return new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * Builds the visible grid: always full weeks (Sun-Sat), covering the
 * entire target month plus enough leading/trailing days from adjacent
 * months to fill out whole weeks. Unchanged from the prior version of
 * this page.
 */
function buildGridWeeks(monthAnchor: Date): Date[][] {
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();

  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);

  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  const gridEnd = new Date(lastOfMonth);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  const days: Date[] = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

export default function UpcomingHearingsPage() {
  const router = useRouter();

  const [hearings, setHearings] = useState<Hearing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [caseTitles, setCaseTitles] = useState<Record<string, string>>({});

  const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<HearingType | 'all'>('all');

  const today = useMemo(() => new Date(), []);
  const [monthAnchor, setMonthAnchor] = useState<Date>(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedDay, setSelectedDay] = useState<Date>(() => startOfDay(today));

  // Tracks the earliest `from` boundary already fetched, so navigating
  // forward within an already-loaded range (the endpoint has no upper
  // bound) never re-fetches -- see file header, item 2.
  const loadedFromRef = useRef<string | null>(null);

  useEffect(() => {
    const startOfMonthAnchor = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
    const desiredFrom = (startOfDay(today) < startOfMonthAnchor ? startOfDay(today) : startOfMonthAnchor).toISOString();

    if (loadedFromRef.current !== null && desiredFrom >= loadedFromRef.current) {
      // Already-loaded data covers this range (no upper bound on the
      // query) -- skip the redundant request.
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setUnauthenticated(false);
      try {
        const res = await fetch(`/api/hearings/upcoming?from=${encodeURIComponent(desiredFrom)}`, {
          credentials: 'include',
        });
        const json = await res.json();
        if (!res.ok) {
          if (res.status === 401) {
            if (!cancelled) setUnauthenticated(true);
            return;
          }
          throw new Error(json?.error?.message ?? 'Failed to load hearings.');
        }
        const data: Hearing[] = json.data;
        if (cancelled) return;
        setHearings(data);
        loadedFromRef.current = desiredFrom;
        await loadCaseTitles(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load hearings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    /**
     * Fetches the case title for every DISTINCT case_id present in
     * `hearings`, once each -- unchanged from the prior version.
     * Failures are swallowed per-id so one bad lookup doesn't block
     * titles for every other case from rendering.
     */
    async function loadCaseTitles(data: Hearing[]) {
      const distinctCaseIds = Array.from(new Set(data.map((h) => h.case_id)));

      const entries = await Promise.all(
        distinctCaseIds.map(async (caseId): Promise<[string, string] | null> => {
          try {
            const res = await fetch(`/api/cases/${caseId}`, { credentials: 'include' });
            const json = await res.json();
            if (!res.ok) return null;
            return [caseId, json.data.title as string];
          } catch {
            return null;
          }
        }),
      );

      if (!cancelled) {
        setCaseTitles((prev) => ({
          ...prev,
          ...Object.fromEntries(entries.filter((e): e is [string, string] => e !== null)),
        }));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthAnchor]);

  // Search + type filter, applied client-side to the already-authorized
  // dataset -- see file header, item 5.
  const filteredHearings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return hearings.filter((h) => {
      if (typeFilter !== 'all' && h.hearing_type !== typeFilter) return false;
      if (!q) return true;
      const caseTitle = caseTitles[h.case_id]?.toLowerCase() ?? '';
      return (
        caseTitle.includes(q) ||
        (h.court_name ?? '').toLowerCase().includes(q) ||
        (h.location ?? '').toLowerCase().includes(q) ||
        HEARING_TYPE_LABELS[h.hearing_type].toLowerCase().includes(q)
      );
    });
  }, [hearings, query, typeFilter, caseTitles]);

  // Hearings grouped by local calendar-day key.
  const hearingsByDay = useMemo(() => {
    const map: Record<string, Hearing[]> = {};
    for (const h of filteredHearings) {
      const key = dateKey(new Date(h.hearing_date));
      (map[key] ??= []).push(h);
    }
    for (const dayHearings of Object.values(map)) {
      dayHearings.sort((a, b) => a.hearing_date.localeCompare(b.hearing_date));
    }
    return map;
  }, [filteredHearings]);

  const weeks = useMemo(() => buildGridWeeks(monthAnchor), [monthAnchor]);

  const monthLabel = monthAnchor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const goToPreviousMonth = () =>
    setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  const goToNextMonth = () =>
    setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  const goToToday = () => {
    setMonthAnchor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDay(startOfDay(today));
  };

  const selectedDayHearings = hearingsByDay[dateKey(selectedDay)] ?? [];

  const todaysCount = hearingsByDay[dateKey(today)]?.length ?? 0;
  const thisWeekCount = useMemo(() => {
    return filteredHearings.filter((h) => {
      const d = daysUntil(h.hearing_date);
      return d >= 0 && d <= 7;
    }).length;
  }, [filteredHearings]);
  const nextHearing = useMemo(() => {
    const future = filteredHearings
      .filter((h) => daysUntil(h.hearing_date) >= 0)
      .sort((a, b) => a.hearing_date.localeCompare(b.hearing_date));
    return future[0] ?? null;
  }, [filteredHearings]);

  // Chronological rundown for the right-hand panel: Today / Tomorrow /
  // This week / Later -- see file header, item 3. Named group variables
  // (not a fixed-index array) so this compiles cleanly under this
  // project's `noUncheckedIndexedAccess` tsconfig setting -- an indexed
  // array access like `groups[0]` is typed `T | undefined` there even
  // when the index is a compile-time constant.
  const rundownGroups = useMemo(() => {
    const sorted = [...filteredHearings]
      .filter((h) => daysUntil(h.hearing_date) >= 0)
      .sort((a, b) => a.hearing_date.localeCompare(b.hearing_date));

    const todayGroup: Hearing[] = [];
    const tomorrowGroup: Hearing[] = [];
    const thisWeekGroup: Hearing[] = [];
    const laterGroup: Hearing[] = [];

    for (const h of sorted) {
      const d = daysUntil(h.hearing_date);
      if (d === 0) todayGroup.push(h);
      else if (d === 1) tomorrowGroup.push(h);
      else if (d <= 7) thisWeekGroup.push(h);
      else laterGroup.push(h);
    }

    const groups: { label: string; items: Hearing[] }[] = [
      { label: 'Today', items: todayGroup },
      { label: 'Tomorrow', items: tomorrowGroup },
      { label: 'This week', items: thisWeekGroup },
      { label: 'Later', items: laterGroup },
    ];

    return groups.filter((g) => g.items.length > 0);
  }, [filteredHearings]);

  const openCaseHearings = (caseId: string) => router.push(`/cases/${caseId}/hearings`);

  return (
    <div className="relative flex h-screen w-full bg-background font-sans text-foreground">
      {/* Left rail -- same inline pattern as (dashboard)/lawyer/page.tsx and
          cases/page.tsx, see file header re: no shared layout for this route family. */}
      <aside className="flex w-16 flex-col items-center bg-primary py-5">
        <div className="mb-8 flex h-9 w-9 items-center justify-center rounded-md bg-primary-foreground/15">
          <Scale className="h-[18px] w-[18px] text-primary-foreground" strokeWidth={1.75} />
        </div>
        <nav className="flex flex-1 flex-col items-center gap-1">
          <button
            onClick={() => router.push('/lawyer')}
            className="flex h-10 w-10 items-center justify-center rounded-md text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
            aria-label="Dashboard"
          >
            <LayoutDashboard className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
          <button
            onClick={() => router.push('/cases')}
            className="flex h-10 w-10 items-center justify-center rounded-md text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
            aria-label="Matters"
          >
            <Briefcase className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-foreground/10 text-primary-foreground"
            aria-current="page"
            aria-label="Hearings & Calendar"
          >
            <CalendarClock className="h-[18px] w-[18px]" strokeWidth={1.75} />
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

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-8 py-6">
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              JurisAI
            </p>
            <h1 className="font-serif text-[26px] leading-none text-foreground">Hearings &amp; Calendar</h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by matter, court, location"
                className="w-56 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as HearingType | 'all')}
              className="rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none"
            >
              <option value="all">All types</option>
              {(Object.keys(HEARING_TYPE_LABELS) as HearingType[]).map((t) => (
                <option key={t} value={t}>
                  {HEARING_TYPE_LABELS[t]}
                </option>
              ))}
            </select>

            <button
              onClick={goToToday}
              className="rounded-md border border-input bg-background px-3 py-2 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              Today
            </button>
            <div className="flex items-center gap-1 rounded-md border border-input bg-background">
              <button
                onClick={goToPreviousMonth}
                aria-label="Previous month"
                className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:bg-muted"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[9rem] text-center text-[13px] font-medium text-foreground">
                {monthLabel}
              </span>
              <button
                onClick={goToNextMonth}
                aria-label="Next month"
                className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:bg-muted"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-8 py-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Loading your calendar…</p>
            </div>
          ) : unauthenticated ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card py-24 text-muted-foreground">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">Please sign in to view your hearings and calendar.</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">{error}</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary strip -- same tokens as (dashboard)/lawyer/page.tsx's own summary strip */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-5 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <Gavel className="h-[18px] w-[18px] text-primary" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-foreground">{todaysCount}</p>
                    <p className="text-[12px] text-muted-foreground">Hearings today</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-5 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <CalendarClock className="h-[18px] w-[18px] text-primary" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-foreground">{thisWeekCount}</p>
                    <p className="text-[12px] text-muted-foreground">This week</p>
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

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                {/* Calendar grid */}
                <div className="xl:col-span-2">
                  <div className="overflow-hidden rounded-lg border border-border">
                    <div className="grid grid-cols-7 border-b border-border bg-muted">
                      {WEEKDAY_LABELS.map((label) => (
                        <div
                          key={label}
                          className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          {label}
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-7">
                      {weeks.map((week, weekIndex) =>
                        week.map((day) => {
                          const inCurrentMonth = day.getMonth() === monthAnchor.getMonth();
                          const isToday = isSameDay(day, today);
                          const isSelected = isSameDay(day, selectedDay);
                          const dayHearings = hearingsByDay[dateKey(day)] ?? [];
                          const visibleHearings = dayHearings.slice(0, MAX_HEARINGS_PER_CELL);
                          const overflowCount = dayHearings.length - visibleHearings.length;

                          return (
                            <button
                              key={dateKey(day)}
                              onClick={() => setSelectedDay(startOfDay(day))}
                              className={`min-h-[104px] border-b border-r border-border p-1.5 text-left last:border-r-0 [&:nth-child(7n)]:border-r-0 ${
                                isSelected ? 'bg-primary/5' : inCurrentMonth ? 'bg-card' : 'bg-muted/40'
                              } ${weekIndex === weeks.length - 1 ? 'border-b-0' : ''} hover:bg-primary/5`}
                            >
                              <span
                                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                                  isToday
                                    ? 'border border-primary font-semibold text-primary'
                                    : inCurrentMonth
                                      ? 'text-foreground'
                                      : 'text-muted-foreground'
                                }`}
                              >
                                {day.getDate()}
                              </span>

                              <div className="mt-1 space-y-1">
                                {visibleHearings.map((h) => {
                                  const d = daysUntil(h.hearing_date);
                                  const urgent = d <= 1;
                                  return (
                                    <span
                                      key={h.id}
                                      title={`${HEARING_TYPE_LABELS[h.hearing_type]} · ${caseTitles[h.case_id] ?? `Case ${h.case_id.slice(0, 8)}`}`}
                                      className={`block truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                        urgent
                                          ? 'bg-destructive/10 text-destructive'
                                          : 'bg-primary/10 text-primary'
                                      }`}
                                    >
                                      {formatTime(h.hearing_date)} · {caseTitles[h.case_id] ?? `Case ${h.case_id.slice(0, 8)}`}
                                    </span>
                                  );
                                })}
                                {overflowCount > 0 && (
                                  <p className="px-1.5 text-[11px] text-muted-foreground">+{overflowCount} more</p>
                                )}
                              </div>
                            </button>
                          );
                        }),
                      )}
                    </div>
                  </div>
                </div>

                {/* Right panel: selected day + rundown */}
                <div className="space-y-6">
                  <section>
                    <h2 className="font-serif text-[17px] text-foreground">
                      {isSameDay(selectedDay, today)
                        ? 'Today'
                        : selectedDay.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
                    </h2>
                    {selectedDayHearings.length === 0 ? (
                      <div className="mt-3 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-10 text-muted-foreground">
                        <Inbox className="h-5 w-5" />
                        <p className="text-[13px]">No hearings scheduled for this day.</p>
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
                        {selectedDayHearings.map((h) => (
                          <button
                            key={h.id}
                            onClick={() => openCaseHearings(h.case_id)}
                            className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-muted"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium text-foreground">
                                {caseTitles[h.case_id] ?? `Case ${h.case_id.slice(0, 8)}`}
                              </p>
                              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                                <span>{formatTime(h.hearing_date)}</span>
                                <span>{HEARING_TYPE_LABELS[h.hearing_type]}</span>
                                {h.court_name && <span>{h.court_name}</span>}
                                {h.location && (
                                  <span className="inline-flex items-center gap-1">
                                    <MapPin className="h-3 w-3" /> {h.location}
                                  </span>
                                )}
                                {h.notes && (
                                  <span className="inline-flex items-center gap-1">
                                    <StickyNote className="h-3 w-3" /> Notes
                                  </span>
                                )}
                              </p>
                            </div>
                            <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          </button>
                        ))}
                      </div>
                    )}
                  </section>

                  <section>
                    <h2 className="font-serif text-[17px] text-foreground">
                      Upcoming{' '}
                      <span className="font-sans text-[13px] font-normal text-muted-foreground">
                        ({filteredHearings.filter((h) => daysUntil(h.hearing_date) >= 0).length})
                      </span>
                    </h2>
                    {rundownGroups.length === 0 ? (
                      <div className="mt-3 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-10 text-muted-foreground">
                        <Inbox className="h-5 w-5" />
                        <p className="text-[13px]">
                          {query || typeFilter !== 'all' ? 'No hearings match your filters.' : 'No upcoming hearings.'}
                        </p>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-4">
                        {rundownGroups.map((group) => (
                          <div key={group.label}>
                            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {group.label}
                            </p>
                            <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
                              {group.items.map((h) => {
                                const d = daysUntil(h.hearing_date);
                                const urgent = d <= 1;
                                const soon = d > 1 && d <= 7;
                                return (
                                  <button
                                    key={h.id}
                                    onClick={() => openCaseHearings(h.case_id)}
                                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted"
                                  >
                                    <div
                                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                                        urgent ? 'bg-destructive/10' : soon ? 'bg-primary/10' : 'bg-muted'
                                      }`}
                                    >
                                      <Gavel
                                        className={`h-4 w-4 ${
                                          urgent ? 'text-destructive' : soon ? 'text-primary' : 'text-muted-foreground'
                                        }`}
                                        strokeWidth={1.5}
                                      />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-[13px] font-medium text-foreground">
                                        {caseTitles[h.case_id] ?? `Case ${h.case_id.slice(0, 8)}`}
                                      </p>
                                      <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                                        {formatDateTime(h.hearing_date)} · {HEARING_TYPE_LABELS[h.hearing_type]}
                                      </p>
                                    </div>
                                    <span
                                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                        urgent
                                          ? 'bg-destructive/10 text-destructive'
                                          : soon
                                            ? 'bg-primary/10 text-primary'
                                            : 'bg-muted text-muted-foreground'
                                      }`}
                                    >
                                      {urgencyLabel(d)}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
