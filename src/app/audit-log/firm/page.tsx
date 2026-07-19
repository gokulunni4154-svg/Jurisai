// src/app/audit-log/firm/page.tsx
// NEW FILE, THIS SESSION — closes the "no frontend consumes either Audit
// Log route" open item, firm-owner half. Built directly against the
// real, pasted billing/subscription/page.tsx for conventions: 'use
// client', useCallback/useEffect fetch pattern, extractErrorMessage()
// helper (reused verbatim, same as that file itself notes doing for
// checkout/page.tsx and return/page.tsx before it), loading/error/empty
// states, Tailwind classes, back-button ArrowLeft-to-/documents pattern.
//
// SOURCE-VERIFIED AGAINST, THIS SESSION:
//   - GET /api/audit-log/firm?firmId=... (route.ts, Phase 3 File 21,
//     amended File 31 this session): requires firmId, returns
//     `{ data: AuditLogRow[] }` at 200. Accepts optional limit/offset/
//     actionPrefix query params (File 31's own amendment) — actionPrefix
//     wired into a simple text filter below; actorType is NOT exposed
//     by this route (admin-only, per audit-log.service.ts's own File 30
//     scoping decision), so no actorType filter UI exists on this page.
//   - GET /api/billing/firms/mine (route.ts, pasted a prior session):
//     no params, returns `{ data: FirmRow | null }` — used here to
//     resolve the caller's own firmId before calling the audit-log
//     route, since this page has no other source for firmId (no firm
//     dashboard/URL param exists to arrive here with one already).
//   - audit_log's real Row shape (database.types.ts, pasted this
//     session): action, actor_id, actor_type, created_at, firm_id, id,
//     metadata, resource_id, resource_type — all rendered below except
//     metadata (a raw Json blob; rendering it generically as
//     JSON.stringify was judged noisy for a list view, see render note
//     below) and firm_id (redundant on a page already scoped to one
//     firm).
//
// FLAGGED, JUDGMENT CALL: this page makes TWO sequential fetches on load
// (GET /api/billing/firms/mine, then GET /api/audit-log/firm?firmId=...)
// rather than one — no combined endpoint exists that returns both, and
// building one wasn't asked for. A brief "resolving your firm" loading
// state is shown for the first fetch, separate from the audit log's own
// loading state, so the two don't get silently collapsed into one
// generic spinner that would hide which step is slow if either is.
//
// FLAGGED, JUDGMENT CALL: "no firm" (firms/mine returns `data: null`) is
// rendered as a distinct empty state from "firm exists, but zero audit
// events yet" — these are different facts (the first means this page
// isn't really applicable to this caller yet; the second means it is,
// and there's just nothing to show) and collapsing them into one message
// would be misleading, matching the same non-collapsing judgment
// billing/subscription/page.tsx itself makes between "loading" and "no
// active subscription."
//
// FLAGGED, JUDGMENT CALL: actor_id is rendered as a raw UUID (truncated
// to its first 8 characters) rather than a resolved display name — no
// ProfileRepository/user-lookup endpoint has been pasted in any session
// that this page could call to resolve a UUID into a name/email. Not
// solved here; flagged rather than guessing at a lookup endpoint that
// may not exist.
//
// FLAGGED, JUDGMENT CALL: pagination here is "Previous/Next" over
// offset/limit, same shape documents/page.tsx already uses — chosen for
// consistency with that file's own real, working pattern rather than
// inventing a different pagination UI for this page. PAGE_SIZE here is
// 20, same constant value documents/page.tsx uses, not because
// AuditLogRepository's own DEFAULT_LIMIT (50, Phase 3 File 29) says so —
// flagging in case 50 (matching the backend default) is actually the
// more consistent choice; either way this page always sends an explicit
// `limit`, so the backend default never activates from this page's own
// calls regardless of which number is picked.
//
// AMENDED, THIS SESSION — closes pending item #3 ("no total count").
// GET /api/audit-log/firm's response now includes a real `total` field
// (route.ts's own amendment, made alongside audit-log.service.ts's
// getFirmAuditLog now returning `{ events, total }` instead of a bare
// array). This page reads `total` instead of inferring "next page
// exists" from getting back a full page — closes the old FLAGGED note
// below the old hasNextPage definition, which no longer applies and has
// been removed.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, Loader2, ScrollText } from 'lucide-react';

// Real columns confirmed via database.types.ts, pasted this session.
interface AuditLogRow {
  id: string;
  action: string;
  actor_id: string | null;
  actor_type: 'user' | 'system' | 'webhook';
  created_at: string;
  firm_id: string | null;
  resource_id: string | null;
  resource_type: string | null;
}

interface FirmRow {
  id: string;
  name: string;
  owner_id: string;
}

interface GetFirmResponse {
  data: FirmRow | null;
}

// AMENDED, THIS SESSION: `total` added, matching route.ts's own new
// response field.
interface GetAuditLogResponse {
  data: AuditLogRow[];
  total: number;
}

const PAGE_SIZE = 20;

// Reused verbatim from billing/subscription/page.tsx (which itself notes
// reusing this from checkout/page.tsx and return/page.tsx before it).
async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

function formatTimestamp(isoString: string): string {
  return new Date(isoString).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const ACTOR_TYPE_LABELS: Record<AuditLogRow['actor_type'], string> = {
  user: 'User',
  system: 'System',
  webhook: 'Webhook',
};

export default function FirmAuditLogPage() {
  const router = useRouter();

  const [firm, setFirm] = useState<FirmRow | null>(null);
  const [isResolvingFirm, setIsResolvingFirm] = useState(true);
  const [firmError, setFirmError] = useState<string | null>(null);

  const [events, setEvents] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [actionPrefix, setActionPrefix] = useState('');
  const [appliedActionPrefix, setAppliedActionPrefix] = useState('');

  // Step 1: resolve the caller's own firm. See file header — this page
  // has no other source for firmId.
  const fetchFirm = useCallback(async () => {
    setIsResolvingFirm(true);
    setFirmError(null);
    try {
      const res = await fetch('/api/billing/firms/mine', { credentials: 'include' });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json: GetFirmResponse = await res.json();
      setFirm(json.data);
    } catch (err) {
      setFirmError(err instanceof Error ? err.message : 'Could not resolve your firm.');
    } finally {
      setIsResolvingFirm(false);
    }
  }, []);

  useEffect(() => {
    fetchFirm();
  }, [fetchFirm]);

  // Step 2: once firm is known, fetch its audit log.
  const fetchEvents = useCallback(
    async (nextOffset: number, prefix: string) => {
      if (!firm) return;
      setIsLoadingEvents(true);
      setEventsError(null);
      try {
        const params = new URLSearchParams({
          firmId: firm.id,
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        });
        if (prefix.trim()) {
          params.set('actionPrefix', prefix.trim());
        }
        const res = await fetch(`/api/audit-log/firm?${params.toString()}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(await extractErrorMessage(res));
        const json: GetAuditLogResponse = await res.json();
        setEvents(json.data);
        setTotal(json.total);
        setOffset(nextOffset);
      } catch (err) {
        setEventsError(err instanceof Error ? err.message : 'Could not load the audit log.');
      } finally {
        setIsLoadingEvents(false);
      }
    },
    [firm],
  );

  useEffect(() => {
    if (firm) {
      fetchEvents(0, appliedActionPrefix);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firm, appliedActionPrefix]);

  const handleApplyFilter = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedActionPrefix(actionPrefix);
  };

  // AMENDED, THIS SESSION: now driven by the real `total` from the API
  // response instead of inferring from `events.length === PAGE_SIZE`.
  const hasNextPage = offset + events.length < total;
  const hasPrevPage = offset > 0;

  return (
    <div className="flex min-h-screen w-full flex-col bg-background font-sans text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-8 py-6">
        <button
          onClick={() => router.push('/documents')}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50"
          aria-label="Back to documents"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="font-serif text-[22px] leading-none text-foreground">Firm audit log</h1>
      </header>

      <main className="flex-1 px-8 py-10">
        <div className="mx-auto max-w-3xl">
          {isResolvingFirm ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Resolving your firm…</p>
            </div>
          ) : firmError ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-16 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">{firmError}</p>
              <button
                onClick={() => fetchFirm()}
                className="text-[13px] font-medium underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          ) : !firm ? (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
              <h2 className="font-serif text-[18px] text-foreground">No firm found</h2>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                You don&apos;t own a firm right now, so there&apos;s no firm audit log to show.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between gap-4">
                <p className="text-[13px] text-muted-foreground">
                  Showing events for <span className="text-foreground">{firm.name}</span>
                </p>
                <form onSubmit={handleApplyFilter} className="flex items-center gap-2">
                  <input
                    value={actionPrefix}
                    onChange={(e) => setActionPrefix(e.target.value)}
                    placeholder="Filter by action prefix, e.g. billing."
                    className="w-64 rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-md border border-border px-3 py-2 text-[13px] font-medium text-foreground hover:bg-muted/50"
                  >
                    Apply
                  </button>
                </form>
              </div>

              {isLoadingEvents ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <p className="text-[13px]">Loading events…</p>
                </div>
              ) : eventsError ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-16 text-destructive">
                  <AlertCircle className="h-5 w-5" />
                  <p className="text-[13px]">{eventsError}</p>
                  <button
                    onClick={() => fetchEvents(offset, appliedActionPrefix)}
                    className="text-[13px] font-medium underline underline-offset-2"
                  >
                    Try again
                  </button>
                </div>
              ) : events.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-muted-foreground">
                  <ScrollText className="h-6 w-6" />
                  <p className="text-[13px]">No audit events match this view yet.</p>
                </div>
              ) : (
                <>
                  <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
                    {events.map((event) => (
                      <div key={event.id} className="flex items-center gap-4 px-5 py-4">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                          <ScrollText className="h-4 w-4 text-primary" strokeWidth={1.5} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-medium text-foreground">
                            {event.action}
                          </p>
                          <p className="mt-0.5 text-[12px] text-muted-foreground">
                            {formatTimestamp(event.created_at)} ·{' '}
                            {ACTOR_TYPE_LABELS[event.actor_type]}
                            {event.actor_id ? ` (${event.actor_id.slice(0, 8)})` : ''}
                            {event.resource_type ? ` · ${event.resource_type}` : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {(hasPrevPage || hasNextPage) && (
                    <div className="mt-4 flex items-center justify-between text-[13px] text-muted-foreground">
                      <button
                        disabled={!hasPrevPage}
                        onClick={() => fetchEvents(Math.max(0, offset - PAGE_SIZE), appliedActionPrefix)}
                        className="flex items-center gap-1 rounded-md px-2 py-1 disabled:opacity-30"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        Previous
                      </button>
                      <span>
                        {offset + 1}–{offset + events.length} of {total}
                      </span>
                      <button
                        disabled={!hasNextPage}
                        onClick={() => fetchEvents(offset + PAGE_SIZE, appliedActionPrefix)}
                        className="flex items-center gap-1 rounded-md px-2 py-1 disabled:opacity-30"
                      >
                        Next
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}