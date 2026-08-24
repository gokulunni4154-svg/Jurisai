// Real path: FLAGGED, UNVERIFIED -- src/app/(dashboard)/firm/[firmId]/page.tsx
// Route group parentheses assumed not to appear in the URL, same
// confirmed convention as Lawyer Dashboard's own page path
// (src/app/(dashboard)/lawyer/page.tsx -> /lawyer). Not independently
// re-verified this session against a real Next.js config file.
//
// NEW PAGE, THIS SESSION -- Firm Dashboard frontend. Consumes
// GET /api/dashboard/firm/${firmId} (this session's own backend,
// source-verified against firm-member.service.ts/firm.service.ts
// precedent).
//
// STYLING: deliberately matches the real, pasted case-notes page.tsx
// exactly where a direct equivalent exists -- slate palette, rounded-md
// borders, en-IN locale timestamp formatting, same loading-spinner and
// error-banner markup, same "swallowed-failure, fallback to shortId"
// posture for any lookup that might 404 -- same "consistency over
// novelty" reasoning that file's own header gives, reused verbatim
// here rather than re-justified.
//
// FLAGGED, NEW LAYOUT DECISION, NO DIRECT PRECEDENT: case-notes/page.tsx
// renders one flat list; this page renders THREE sections (cases,
// tasks, upcoming hearings) side by side under one header, since that's
// what getDashboard()'s own return shape provides. No existing page in
// this project's pasted source shows a multi-section dashboard layout
// (Lawyer Dashboard's own page.tsx was never pasted this session to
// confirm its section layout, only described in PROJECT_PROGRESS.md as
// "three sections"). Widened the container to max-w-5xl (vs case-notes'
// max-w-3xl) to fit three columns on desktop; stacks to one column
// below the md breakpoint. Revisit against Lawyer Dashboard's real
// page.tsx if it's ever pasted and its section layout differs.
//
// NO FIRM-NAME LOOKUP: case-notes/page.tsx fetches the case's title via
// GET /api/cases/${id} as a swallowed-failure header lookup. No
// equivalent GET /api/firms/${firmId}-style route was pasted or
// confirmed to exist this session, so this page does NOT attempt a
// firm-name lookup -- the header falls back to a shortened firmId only.
// Flagging the gap, not inventing an unconfirmed route.
//
// READ-ONLY PAGE: unlike case-notes/page.tsx (full CRUD -- post/edit/
// delete), this page has no create/edit/delete actions at all --
// FirmDashboardService only exposes getDashboard(), a pure read. Same
// read-only posture Lawyer Dashboard's own page was described as
// having in PROJECT_PROGRESS.md.
//
// VISIBILITY HANDLING: mirrors case-notes/page.tsx's forbidden-state
// handling exactly -- a 403 from the route (caller is not 'owner'/
// 'admin' in firm_members for this firmId, per
// FirmDashboardService#requireManageAccess()) is shown as a dedicated,
// non-error message distinct from the generic error banner, since this
// is an expected, not-broken state for plain employee/lawyer members
// and non-members alike.
//
// NO PAGINATION: matches case-notes/page.tsx's own no-pagination
// posture (CaseNoteService#listNotesForCase() takes no limit/offset) --
// FirmDashboardService#getDashboard() likewise takes no limit/offset,
// so there is no "Load more" UI here either.

// AMENDMENT -- Navigation + Polish Cleanup task, later session: now
// rendered inside the shared AppSidebar shell (active="dashboard"),
// matching documents/page.tsx's established wrapping pattern exactly
// (flex h-screen outer row, sidebar + scrollable content column). This
// page previously had no persistent navigation of any kind -- one of
// six Firm Terminal pages the prior architecture audit flagged for
// this exact inconsistency. No business logic, data fetching, or
// visibility handling below was touched.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AppSidebar } from '@/shared/components/layout/app-sidebar';

interface FirmCase {
  id: string;
  firm_id: string;
  owner_id: string;
  title: string;
  status: string;
  team_id: string | null;
  created_at: string;
  updated_at: string;
}

interface FirmTask {
  id: string;
  firm_id: string;
  case_id: string | null;
  assignee_profile_id: string | null;
  created_by: string;
  title: string;
  description: string | null;
  status: string;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

interface FirmHearing {
  id: string;
  firm_id: string;
  case_id: string;
  created_by: string;
  hearing_date: string;
  hearing_type: string;
  court_name: string | null;
  location: string | null;
  notes: string | null;
  outcome: string | null;
  reminder_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

interface FirmDashboardData {
  firmCases: FirmCase[];
  firmTasks: FirmTask[];
  upcomingHearings: FirmHearing[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTimestamp(iso: string): string {
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

export default function FirmDashboardPage({ params }: { params: { firmId: string } }) {
  const firmId = params.firmId;

  const [data, setData] = useState<FirmDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);

    try {
      const res = await fetch(`/api/dashboard/firm/${firmId}`);

      if (res.status === 403) {
        setForbidden(true);
        return;
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to load firm dashboard.');

      setData(json.data as FirmDashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load firm dashboard.');
    } finally {
      setLoading(false);
    }
  }, [firmId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const headerTitle = `Firm ${shortId(firmId)}`;

  return (
    <div className="flex h-screen w-full bg-muted/30 font-sans text-foreground">
      <AppSidebar active="dashboard" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {headerTitle}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Firm dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Firm-wide cases, tasks, and upcoming hearings -- visible only to firm owners and admins.
        </p>
      </div>

      {loading ? (
        <div className="mt-10 flex items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : forbidden ? (
        <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          The firm dashboard is only visible to this firm&apos;s owner or admins.
        </div>
      ) : error ? (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : data ? (
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Cases */}
          <section>
            <h2 className="text-sm font-semibold text-slate-900">
              Cases <span className="font-normal text-slate-400">({data.firmCases.length})</span>
            </h2>

            {data.firmCases.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No cases yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {data.firmCases.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-md border border-slate-200 bg-white px-4 py-3"
                  >
                    <p className="text-sm font-medium text-slate-900">{c.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {c.status} · {formatDate(c.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Tasks */}
          <section>
            <h2 className="text-sm font-semibold text-slate-900">
              Tasks <span className="font-normal text-slate-400">({data.firmTasks.length})</span>
            </h2>

            {data.firmTasks.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No tasks yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {data.firmTasks.map((t) => (
                  <li
                    key={t.id}
                    className="rounded-md border border-slate-200 bg-white px-4 py-3"
                  >
                    <p className="text-sm font-medium text-slate-900">{t.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {t.status}
                      {t.due_date ? ` · due ${formatDate(t.due_date)}` : ''}
                      {t.case_id ? '' : ' · standalone'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Upcoming hearings */}
          <section>
            <h2 className="text-sm font-semibold text-slate-900">
              Upcoming hearings{' '}
              <span className="font-normal text-slate-400">({data.upcomingHearings.length})</span>
            </h2>

            {data.upcomingHearings.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No upcoming hearings.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {data.upcomingHearings.map((h) => (
                  <li
                    key={h.id}
                    className="rounded-md border border-slate-200 bg-white px-4 py-3"
                  >
                    <p className="text-sm font-medium text-slate-900">{h.hearing_type}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatTimestamp(h.hearing_date)}
                      {h.court_name ? ` · ${h.court_name}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
        </div>
      </div>
    </div>
  );
}