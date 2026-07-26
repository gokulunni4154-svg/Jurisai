// Real path (best guess, matching this project's app-router convention
// confirmed via src/app/hearings/upcoming/page.tsx, real, pasted
// source): src/app/cases/[id]/timeline/page.tsx
//
// NEW PAGE, THIS SESSION. Case Timeline / Activity History frontend --
// consumes GET /api/cases/[id]/timeline (real, pasted this session).
//
// STYLING: deliberately matches src/app/hearings/upcoming/page.tsx's
// existing visual conventions exactly (slate palette, rounded-md
// borders, en-IN locale formatting, same button/chip shapes) rather
// than introducing a new visual identity -- this is one more screen
// inside an existing internal case-management tool, not a standalone
// marketing page, so consistency with the rest of the app is the
// correct call here, not a missed opportunity for a distinctive look.
//
// DATA FETCH: two calls on mount/filter-change --
//   1. GET /api/cases/${id} -- confirmed real usage, copied verbatim
//      from the hearings calendar page's own case-title lookup pattern
//      (same swallowed-failure/fallback-to-raw-id posture).
//   2. GET /api/cases/${id}/timeline?limit=&offset=&actionPrefix= --
//      new this session, returns { data: { events, total } }.
//
// ACTOR NAME RESOLUTION -- RESOLVED, this session (was previously
// flagged as an unverified assumption). Uses
// GET /api/profiles/${actorId}/display-name (real, pasted, confirmed --
// see ProfileService.getPublicDisplayName()), NOT
// GET /api/profiles/${actorId} -- that route is ownership-restricted
// (profile owner or admin only, see ProfileService.getProfileById()) and
// would 403 for the common case of one user viewing another's actions on
// a shared case, silently leaving most actor names unresolved. The
// display-name route requires authentication only, returns ONLY
// { id, full_name }, and is callable by any authenticated user -- built
// specifically for this page's need. Batch-fetches per distinct actor_id
// present in the returned events, exactly mirroring the hearings
// calendar page's own case-title batch-fetch technique (one request per
// DISTINCT id, not per event; failures swallowed per-id so one bad
// lookup doesn't block the rest). If a lookup still fails for any reason,
// the actor name falls back to a shortened id (e.g. "User a1b2c3d4") --
// the page still renders and functions correctly either way.
//
// FLAGGED: hearing events link through to `/cases/${caseId}/hearings`,
// matching the hearings calendar page's own confirmed real link target.
// Task and document events are NOT given a click-through link -- no
// task-detail or document-detail page route has been confirmed anywhere
// in this project's pasted source, so none was invented here. Case and
// access-grant events are also non-clickable for the same reason.
//
// PAGINATION: simple "Load more" (offset-increment), not numbered pages
// -- matches this feature's own read pattern (most-recent-first,
// unbounded scroll-style consumption) better than a page-number UI,
// and avoids inventing a page-number component with no existing
// precedent in this project's pasted source to mirror.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Briefcase,
  Calendar,
  CheckSquare,
  FileText,
  Loader2,
  Shield,
  Trash2,
} from 'lucide-react';

type ActorType = 'user' | 'system' | 'webhook';

interface TimelineEvent {
  id: string;
  action: string;
  actor_type: ActorType;
  actor_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface TimelineResponse {
  events: TimelineEvent[];
  total: number;
}

type FilterKey = 'all' | 'case.' | 'task.' | 'hearing.' | 'case.access_grant.' | 'case.document.';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All activity' },
  { key: 'case.', label: 'Case' },
  { key: 'task.', label: 'Tasks' },
  { key: 'hearing.', label: 'Hearings' },
  { key: 'case.document.', label: 'Documents' },
  { key: 'case.access_grant.', label: 'Access' },
];

/**
 * Display label + icon per known action string. Covers every action
 * this session's instrumentation pass actually writes (case.service.ts,
 * task.service.ts, hearing.service.ts, case-access-grant.service.ts --
 * all real, amended, pasted-back source). An action not in this map
 * falls back to a humanized version of the raw string (dots -> spaces,
 * capitalized) rather than a hardcoded "Unknown event" -- keeps the
 * timeline useful even for an action added later that this map hasn't
 * been updated for yet.
 */
const ACTION_META: Record<string, { label: string; Icon: typeof FileText }> = {
  'case.create': { label: 'Case created', Icon: Briefcase },
  'case.document.add': { label: 'Document added', Icon: FileText },
  'case.document.remove': { label: 'Document removed', Icon: Trash2 },
  'task.create': { label: 'Task created', Icon: CheckSquare },
  'task.update': { label: 'Task updated', Icon: CheckSquare },
  'task.delete': { label: 'Task deleted', Icon: Trash2 },
  'hearing.create': { label: 'Hearing scheduled', Icon: Calendar },
  'hearing.update': { label: 'Hearing updated', Icon: Calendar },
  'hearing.delete': { label: 'Hearing removed', Icon: Trash2 },
  'case.access_grant.issue': { label: 'Access granted', Icon: Shield },
  'case.access_grant.revoke': { label: 'Access revoked', Icon: Shield },
};

function humanizeAction(action: string): string {
  const last = action.split('.').pop() ?? action;
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/_/g, ' ');
}

function getActionMeta(action: string): { label: string; Icon: typeof FileText } {
  return ACTION_META[action] ?? { label: humanizeAction(action), Icon: FileText };
}

/**
 * Short, human summary of an event's metadata, per action. Deliberately
 * narrow -- only covers the fields this session's own instrumentation
 * writes (see each service's recordUserAction() calls) -- rather than a
 * generic JSON dump, which would be unreadable in a timeline row.
 * Falls back to nothing (empty string) for an unrecognized action
 * rather than dumping raw JSON, keeping the row clean.
 */
function summarizeMetadata(action: string, metadata: Record<string, unknown> | null): string {
  if (!metadata) return '';

  // FIX, tsc pass — every metadata.xxx access below was a TS4111
  // (index-signature access requires bracket notation): `metadata` is
  // typed Record<string, unknown> | null, which has an index signature,
  // not a fixed set of named properties. Switched all 17 occurrences to
  // bracket notation. No behavior change — same runtime lookup either
  // way, this is purely a type-checking rule.
  switch (action) {
    case 'case.create':
      return typeof metadata['title'] === 'string' ? `"${metadata['title']}"` : '';
    case 'task.create':
      return typeof metadata['title'] === 'string' ? `"${metadata['title']}"` : '';
    case 'task.update':
      return typeof metadata['status'] === 'string' ? `Status: ${metadata['status']}` : '';
    case 'task.delete':
      return typeof metadata['title'] === 'string' ? `"${metadata['title']}"` : '';
    case 'hearing.create':
    case 'hearing.update': {
      const parts: string[] = [];
      if (typeof metadata['hearingDate'] === 'string') {
        parts.push(new Date(metadata['hearingDate']).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }));
      }
      if (typeof metadata['outcome'] === 'string' && metadata['outcome']) {
        parts.push(`Outcome: ${metadata['outcome']}`);
      }
      return parts.join(' · ');
    }
    case 'hearing.delete':
      return typeof metadata['hearingDate'] === 'string'
        ? new Date(metadata['hearingDate']).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : '';
    case 'case.access_grant.issue':
    case 'case.access_grant.revoke':
      return typeof metadata['accessLevel'] === 'string'
        ? `Level: ${(metadata['accessLevel'] as string).replace('_', ' ')}`
        : '';
    default:
      return '';
  }
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

const PAGE_SIZE = 25;

export default function CaseTimelinePage({ params }: { params: { id: string } }) {
  const caseId = params.id;

  const [caseTitle, setCaseTitle] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<FilterKey>('all');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Case title -- same swallowed-failure fallback posture as the
  // hearings calendar page's own case-title lookup.
  useEffect(() => {
    let cancelled = false;
    async function loadCase() {
      try {
        const res = await fetch(`/api/cases/${caseId}`);
        const json = await res.json();
        if (!res.ok || cancelled) return;
        setCaseTitle(json.data.title as string);
      } catch {
        // Swallowed -- falls back to raw caseId in the header below.
      }
    }
    loadCase();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  /**
   * Fetches the display name for every DISTINCT actor_id in `newEvents`
   * not already resolved, one request each, via the display-name route
   * (real, pasted, confirmed -- see this file's own header). Failures
   * swallowed per-id, matching the hearings calendar page's identical
   * technique for case titles.
   */
  const resolveActorNames = useCallback(
    async (newEvents: TimelineEvent[]) => {
      const distinctIds = Array.from(
        new Set(
          newEvents
            .filter((e) => e.actor_type === 'user' && e.actor_id)
            .map((e) => e.actor_id as string),
        ),
      ).filter((id) => !(id in actorNames));

      if (distinctIds.length === 0) return;

      const entries = await Promise.all(
        distinctIds.map(async (id): Promise<[string, string] | null> => {
          try {
            const res = await fetch(`/api/profiles/${id}/display-name`);
            const json = await res.json();
            if (!res.ok) return null;
            const name = json?.data?.full_name;
            return typeof name === 'string' && name ? [id, name] : null;
          } catch {
            return null;
          }
        }),
      );

      const resolved = Object.fromEntries(entries.filter((e): e is [string, string] => e !== null));
      if (Object.keys(resolved).length > 0) {
        setActorNames((prev) => ({ ...prev, ...resolved }));
      }
    },
    [actorNames],
  );

  const loadTimeline = useCallback(
    async (nextOffset: number, replace: boolean) => {
      if (replace) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }

      try {
        const searchParams = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        });
        if (filter !== 'all') {
          searchParams.set('actionPrefix', filter);
        }

        const res = await fetch(`/api/cases/${caseId}/timeline?${searchParams.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to load case activity.');

        const data: TimelineResponse = json.data;
        setEvents((prev) => (replace ? data.events : [...prev, ...data.events]));
        setTotal(data.total);
        setOffset(nextOffset);
        await resolveActorNames(data.events);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load case activity.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveActorNames intentionally excluded, see below.
    [caseId, filter],
  );

  // Re-fetch from the top whenever the filter changes -- deliberately
  // NOT including resolveActorNames in loadTimeline's own dep array
  // above; it closes over `actorNames` and would otherwise re-create
  // loadTimeline (and re-trigger this effect) on every resolved name,
  // causing a duplicate-fetch loop.
  useEffect(() => {
    loadTimeline(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, filter]);

  const hasMore = events.length < total;

  const headerTitle = useMemo(
    () => caseTitle ?? `Case ${shortId(caseId)}`,
    [caseTitle, caseId],
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {headerTitle}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Case activity</h1>
        <p className="mt-1 text-sm text-slate-500">
          Everything that&apos;s happened on this case, most recent first.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.key
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-10 flex items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <>
          {events.length === 0 && !error ? (
            <p className="mt-8 text-sm text-slate-500">No activity recorded yet.</p>
          ) : (
            <ol className="mt-6 space-y-0">
              {events.map((event, index) => {
                const { label, Icon } = getActionMeta(event.action);
                const summary = summarizeMetadata(event.action, event.metadata);
                const actorLabel =
                  event.actor_type === 'user'
                    ? (event.actor_id && actorNames[event.actor_id]) ||
                      (event.actor_id ? `User ${shortId(event.actor_id)}` : 'A user')
                    : event.actor_type === 'system'
                      ? 'System'
                      : 'Webhook';

                const isLast = index === events.length - 1;
                const rowContent = (
                  <div className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      {!isLast && <span className="mt-1 w-px flex-1 bg-slate-200" />}
                    </div>
                    <div className="flex-1 pb-6">
                      <p className="text-sm font-medium text-slate-900">{label}</p>
                      {summary && <p className="mt-0.5 text-sm text-slate-600">{summary}</p>}
                      <p className="mt-1 text-xs text-slate-500">
                        {actorLabel} · {formatTimestamp(event.created_at)}
                      </p>
                    </div>
                  </div>
                );

                // Only hearing events get a click-through link -- see
                // this file's own header for why task/document/case/
                // grant events are deliberately left non-clickable.
                if (event.resource_type === 'hearing') {
                  return (
                    <li key={event.id}>
                      <Link
                        href={`/cases/${caseId}/hearings`}
                        className="-mx-2 block rounded-md px-2 hover:bg-slate-50"
                      >
                        {rowContent}
                      </Link>
                    </li>
                  );
                }

                return <li key={event.id}>{rowContent}</li>;
              })}
            </ol>
          )}

          {hasMore && (
            <div className="mt-2 flex justify-center">
              <button
                onClick={() => loadTimeline(offset + PAGE_SIZE, false)}
                disabled={loadingMore}
                className="rounded-md border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : `Load more (${total - events.length} remaining)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}