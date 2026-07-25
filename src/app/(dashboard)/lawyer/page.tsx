// CONFIRMED real path, this session:
// src/app/(dashboard)/lawyer/page.tsx
//
// NOTE -- (dashboard) is a Next.js route group: the parenthesized
// segment does NOT appear in the URL. This page's actual route is
// /lawyer, not /dashboard/lawyer as the prior draft's best-guess path
// assumed. Unrelated to and does not change the API route this page
// calls (GET /api/dashboard/lawyer, a literal path segment, not a
// route group) -- only the page's own URL was affected.
//
// NEW PAGE, THIS SESSION. Lawyer Dashboard frontend -- consumes
// GET /api/dashboard/lawyer (real, this session's own backend).
//
// STYLING: deliberately matches the real, pasted case-notes page.tsx
// exactly (slate palette, rounded-md borders, en-IN locale formatting,
// Loader2 spinner) -- same "consistency over novelty" reasoning that
// file's own header gives, reused verbatim here.
//
// NO PAGINATION, NO AUTHOR-NAME RESOLUTION: unlike case-notes/page.tsx,
// none of the three lists here (cases, tasks, hearings) carry an
// author_id needing separate display-name lookup -- each row already
// has a human-readable title/case_id/hearing_type directly. Kept
// deliberately simpler than the notes page for that reason, not an
// oversight.
//
// FORBIDDEN-STATE HANDLING: LawyerDashboardService#getDashboard() 403s
// for any non-'lawyer' UserRole (see that file's own header) -- handled
// here with a dedicated message, same pattern as case-notes/page.tsx's
// own `forbidden` state for read-only grantees, since this is an
// expected "wrong account type" state, not a broken one.
//
// FLAGGED, SAME GAP AS case-notes/page.tsx: no current-user-id route
// exists in this project (see that file's own header for the full
// finding) -- not relevant here, since this page needs no per-item
// "is this mine" UI logic; every row shown already belongs to the
// caller by construction (server-side self-scoping in the Service).

'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

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
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
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

export default function LawyerDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setLoading(true);
      setError(null);
      setForbidden(false);

      try {
        const res = await fetch('/api/dashboard/lawyer');

        if (res.status === 403) {
          if (!cancelled) setForbidden(true);
          return;
        }

        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to load dashboard.');
        if (!cancelled) setData(json.data as DashboardData);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDashboard();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Dashboard</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">My cases, tasks &amp; hearings</h1>
      </div>

      {loading ? (
        <div className="mt-10 flex items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : forbidden ? (
        <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          This dashboard is only available to lawyer accounts.
        </div>
      ) : error ? (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : data ? (
        <div className="mt-6 space-y-10">
          <section>
            <h2 className="text-sm font-semibold text-slate-900">
              My cases <span className="font-normal text-slate-400">({data.myCases.length})</span>
            </h2>
            {data.myCases.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No cases yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.myCases.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">{c.title}</p>
                      <p className="text-xs text-slate-500">Updated {formatDate(c.updated_at)}</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                      {c.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-900">
              My tasks <span className="font-normal text-slate-400">({data.myTasks.length})</span>
            </h2>
            {data.myTasks.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No tasks assigned to you.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.myTasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">{t.title}</p>
                      <p className="text-xs text-slate-500">
                        {t.case_id ? `Case ${shortId(t.case_id)}` : 'Standalone'}
                        {t.due_date ? ` · Due ${formatDate(t.due_date)}` : ''}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                      {t.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-900">
              Upcoming hearings{' '}
              <span className="font-normal text-slate-400">({data.upcomingHearings.length})</span>
            </h2>
            {data.upcomingHearings.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No upcoming hearings.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.upcomingHearings.map((h) => (
                  <li
                    key={h.id}
                    className="rounded-md border border-slate-200 bg-white px-4 py-3"
                  >
                    <p className="text-sm font-medium text-slate-900">
                      {h.hearing_type} · Case {shortId(h.case_id)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(h.hearing_date)}
                      {h.court_name ? ` · ${h.court_name}` : ''}
                      {h.location ? ` · ${h.location}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}