// Real path: src/app/hearings/upcoming/page.tsx
//
// UPDATED THIS PASS (polish-pass item #6): the grouped chronological
// list is replaced with a real month-grid calendar view, per explicit
// user request ("will go with 6"). The grouped-list version's own
// header previously explained why a grid was deliberately skipped (no
// grid precedent existed in the project) -- that's no longer a
// blocker now that a grid is specifically wanted, so this is a genuine
// UI-pattern addition to the project, not a mirror of an existing one.
// Flagged as such rather than presented as if a grid precedent already
// existed somewhere else.
//
// DATA FETCH UNCHANGED: still a single GET /api/hearings/upcoming call
// on mount, plus the same batched case-title lookup (one request per
// DISTINCT case_id, not per hearing) from the previous pass -- both
// copied over verbatim from the real pasted source, including the
// per-id swallowed-failure/fallback-to-raw-case_id posture.
//
// FLAGGED, NEW LIMITATION INTRODUCED BY GOING TO A GRID, NOT SOLVED
// HERE: /api/hearings/upcoming's real route source has never been
// pasted in any session, so its actual date range (all future
// hearings? capped at N days/items?) is unconfirmed. A grid invites
// month-by-month navigation, but this page still only ever fetches
// once on mount with no date-range/month param -- so navigating to a
// future month beyond whatever window the endpoint actually returns
// will render as empty, and navigating to a past month will always be
// empty (the endpoint is "upcoming", not "all"). "Today" and next-
// month navigation work correctly for whatever the endpoint already
// returns; anything past that window is a known gap, not a bug fixed
// here. Revisit if/when the real route source is available and a
// month param is worth adding.
//
// GRID CONVENTIONS, NEW JUDGMENT CALLS THIS PASS (no precedent to
// mirror, flagged rather than silently decided): week starts Sunday
// (matches this file's own existing `en-IN` locale formatting
// elsewhere, consistent choice not a confirmed product decision);
// leading/trailing days from adjacent months are rendered dimmed and
// still clickable-through-their-hearings (a hearing landing just
// outside the visible month, e.g. from a "today" edge case, is never
// silently dropped); a day cell shows up to 3 hearings inline before
// collapsing the rest into a "+N more" label (no interactive
// expand/collapse widget added -- kept simple, revisit if a real
// per-day detail view is wanted); "Today" is outlined, not filled, to
// stay distinct from a selected/active state that doesn't exist here.

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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

// Local (browser-timezone) date key, not UTC -- matches how
// hearing_date's own timestamptz value should be grouped onto a
// calendar day for the viewer, same reasoning the grouped-list
// version's dayKey() applied via toLocaleDateString.
function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b);
}

/**
 * Builds the visible grid: always full weeks (Sun-Sat), covering the
 * entire target month plus enough leading/trailing days from adjacent
 * months to fill out whole weeks. Returns 5 or 6 rows depending on the
 * month, not padded to a fixed 6 -- avoids an always-present blank
 * trailing week for months that don't need one.
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
  const [hearings, setHearings] = useState<Hearing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [caseTitles, setCaseTitles] = useState<Record<string, string>>({});

  const today = useMemo(() => new Date(), []);
  const [monthAnchor, setMonthAnchor] = useState<Date>(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/hearings/upcoming');
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to load hearings.');
        const data: Hearing[] = json.data;
        setHearings(data);
        await loadCaseTitles(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load hearings.');
      } finally {
        setLoading(false);
      }
    }

    /**
     * Fetches the case title for every DISTINCT case_id present in
     * `hearings`, once each -- unchanged from the grouped-list
     * version. Failures are swallowed per-id so one bad lookup doesn't
     * block titles for every other case from rendering.
     */
    async function loadCaseTitles(data: Hearing[]) {
      const distinctCaseIds = Array.from(new Set(data.map((h) => h.case_id)));

      const entries = await Promise.all(
        distinctCaseIds.map(async (caseId): Promise<[string, string] | null> => {
          try {
            const res = await fetch(`/api/cases/${caseId}`);
            const json = await res.json();
            if (!res.ok) return null;
            return [caseId, json.data.title as string];
          } catch {
            return null;
          }
        }),
      );

      setCaseTitles(
        Object.fromEntries(entries.filter((e): e is [string, string] => e !== null)),
      );
    }

    load();
  }, []);

  // Hearings grouped by local calendar-day key -- see dateKey()'s own
  // comment on why local time, not UTC, is used here.
  const hearingsByDay = useMemo(() => {
    const map: Record<string, Hearing[]> = {};
    for (const h of hearings) {
      const key = dateKey(new Date(h.hearing_date));
      (map[key] ??= []).push(h);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => a.hearing_date.localeCompare(b.hearing_date));
    }
    return map;
  }, [hearings]);

  const weeks = useMemo(() => buildGridWeeks(monthAnchor), [monthAnchor]);

  const monthLabel = monthAnchor.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  const goToPreviousMonth = () =>
    setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  const goToNextMonth = () =>
    setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  const goToToday = () => setMonthAnchor(new Date(today.getFullYear(), today.getMonth(), 1));

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Upcoming hearings</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every hearing coming up across cases you own or have access to.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={goToToday}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Today
          </button>
          <div className="flex items-center gap-1 rounded-md border border-slate-300">
            <button
              onClick={goToPreviousMonth}
              aria-label="Previous month"
              className="flex h-8 w-8 items-center justify-center text-slate-500 hover:bg-slate-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[9rem] text-center text-sm font-medium text-slate-900">
              {monthLabel}
            </span>
            <button
              onClick={goToNextMonth}
              aria-label="Next month"
              className="flex h-8 w-8 items-center justify-center text-slate-500 hover:bg-slate-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500"
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
                const dayHearings = hearingsByDay[dateKey(day)] ?? [];
                const visibleHearings = dayHearings.slice(0, MAX_HEARINGS_PER_CELL);
                const overflowCount = dayHearings.length - visibleHearings.length;

                return (
                  <div
                    key={dateKey(day)}
                    className={`min-h-[104px] border-b border-r border-slate-200 p-1.5 last:border-r-0 [&:nth-child(7n)]:border-r-0 ${
                      inCurrentMonth ? 'bg-white' : 'bg-slate-50/60'
                    } ${weekIndex === weeks.length - 1 ? 'border-b-0' : ''}`}
                  >
                    <span
                      className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                        isToday
                          ? 'border border-slate-900 font-semibold text-slate-900'
                          : inCurrentMonth
                            ? 'text-slate-700'
                            : 'text-slate-400'
                      }`}
                    >
                      {day.getDate()}
                    </span>

                    <div className="mt-1 space-y-1">
                      {visibleHearings.map((h) => (
                        <Link
                          key={h.id}
                          href={`/cases/${h.case_id}/hearings`}
                          title={`${HEARING_TYPE_LABELS[h.hearing_type]} · ${caseTitles[h.case_id] ?? `Case ${h.case_id}`}`}
                          className="block truncate rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200"
                        >
                          {formatTime(h.hearing_date)} · {caseTitles[h.case_id] ?? `Case ${h.case_id}`}
                        </Link>
                      ))}
                      {overflowCount > 0 && (
                        <p className="px-1.5 text-[11px] text-slate-500">+{overflowCount} more</p>
                      )}
                    </div>
                  </div>
                );
              }),
            )}
          </div>
        </div>
      )}

      {!loading && hearings.length === 0 && !error && (
        <p className="mt-4 text-sm text-slate-500">No upcoming hearings on record.</p>
      )}
    </div>
  );
}