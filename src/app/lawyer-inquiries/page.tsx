// REAL FILE PATH: src/app/lawyer-inquiries/page.tsx
//
// LAWYER TERMINAL — MY INQUIRIES. New page, this session, per the "next
// genuinely missing Lawyer Terminal workflow" audit.
//
// AUDIT FINDINGS (full writeup in the accompanying implementation
// report):
//   - LawyerInquiryService's acceptInquiry()/declineInquiry()/
//     convertInquiry() (all real, pre-existing, untouched by this
//     change) already fully implement the lawyer-facing actions on an
//     inquiry, each gated by requireOwnership(row.target_profile_id) --
//     genuinely self-scoped, lawyer-only actions.
//   - POST /api/lawyer-inquires/[id]/accept, /decline, and /convert (all
//     real, pre-existing, untouched by this change) already wire those
//     three actions up end-to-end.
//   - Despite that, a full-repo search this session found ZERO frontend
//     consumer anywhere in the app that lists a lawyer's OWN inquiries --
//     the only client-side reference to "lawyer inquiry" at all was dead
//     code in documents/[id]/page.tsx (an unused "contact a lawyer"
//     submission flow, a CLIENT-side concern, out of scope here). There
//     was no way for a lawyer to ever discover an inquiry existed in
//     order to act on it -- accept/decline/convert were real, callable,
//     and completely unreachable.
//   - There was also no listing capability at the Repository/Service
//     layer AT ALL (confirmed via grep across lawyer-inquiry.repository.ts
//     and lawyer-inquiry.service.ts) -- not just a missing page. This
//     session added LawyerInquiryRepository#listForTargetProfile() and
//     LawyerInquiryService#listMyInquiries() (self-scoped, no id param,
//     same shape as CaseAccessGrantService#listMyCases()) plus
//     GET /api/lawyer-inquires (new route, same directory as its three
//     sibling action routes) to close that gap BEFORE this page could be
//     built at all. See those files' own diffs / doc comments.
//   - lawyer_inquiries' RLS already has a real, matching SELECT policy
//     (lawyer_inquiries_select_assigned_lawyer: target_profile_id =
//     auth.uid()) for exactly this access pattern -- no RLS change was
//     needed or made. The new repository method still explicitly filters
//     by the authenticated caller's own id (trusted server-side, same
//     posture as every other write in this module), since the repository
//     itself is always constructed with the admin client.
//
// GENUINE GAP THIS PAGE CLOSES: a real "My Inquiries" inbox -- list every
// inquiry currently assigned to the caller, with Accept / Decline actions
// on a pending inquiry and a Convert-to-case action on an accepted one --
// wired to the (now-complete) GET /api/lawyer-inquires list route and the
// pre-existing accept/decline/convert action routes.
//
// STYLING: matches the established Lawyer Terminal visual system --
// AppSidebar shell (same shell profile/page.tsx, tasks/mine/page.tsx, and
// professional-verification/page.tsx all use), semantic tokens
// (border-border, bg-card, text-muted-foreground, bg-primary, etc.), same
// header/loading/error/status-pill markup conventions as those pages.
//
// DISCOVERABILITY: added as a new top-level AppSidebar nav item
// ("Inquiries", between "Matters" and "Hearings & Calendar" -- an
// inquiry is the funnel INTO a matter, so it sits next to it) rather
// than the account dropdown -- unlike "My Profile"/"My Verification",
// this is an action-oriented worklist a lawyer needs to check
// regularly, not an "about me" settings page, so it doesn't belong in
// that same menu. See app-sidebar.tsx's own diff.
//
// DELIBERATELY NOT ADDED:
//   - No "assign" UI -- assignInquiry() is a firm owner/admin action
//     (FIRM_MANAGE_ROLES gate) on a firm-routed, unassigned inquiry.
//     That is Firm Terminal / firm-administration territory, explicitly
//     out of scope for this task. This page only ever lists inquiries
//     that ALREADY have target_profile_id = the caller (assigned,
//     solo-lawyer-direct, or otherwise) -- an unassigned firm inquiry
//     never appears here for anyone.
//   - No raw analysis_result rendering beyond a generic "Analysis
//     attached" indicator -- analysisResult is a real `unknown` jsonb
//     blob (runDocumentAnalysis() itself is an unimplemented stub
//     returning `unknown`, confirmed via anonymous-analysis.service.ts).
//     Asserting specific keys on it would be inventing a shape this
//     codebase has never defined.
//   - No pagination -- listMyInquiries() returns the full, unfiltered
//     set for one lawyer (no query params exist on the route to page
//     through); a client-side lawyer inbox is not expected to be large
//     enough to need it yet, matching this session's "don't invent a
//     query-param shape with no precedent" restraint.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Clock,
  FileText,
  Inbox,
  Loader2,
  Scale,
  X,
} from 'lucide-react';
import { AppSidebar } from '@/shared/components/layout/app-sidebar';
import { NotificationsPanel } from '@/shared/components/notifications/notifications-panel';

// Mirrors lawyer-inquiry.service.ts's own LawyerInquiryListing DTO
// field-for-field -- same "mirrored, not imported" convention every
// other client page in this project follows for a table with no
// shared client-safe types module.
type InquiryStatus = 'pending' | 'accepted' | 'converted_to_case';

interface LawyerInquiryListing {
  id: string;
  clientProfileId: string;
  targetProfileId: string | null;
  targetFirmId: string;
  teamId: string | null;
  status: InquiryStatus;
  documentStoragePath: string;
  analysisResult: unknown;
  createdAt: string;
}

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
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Last path segment of document_storage_path, decoded, as a
// human-readable filename -- same "closest existing equivalent, labeled
// honestly" posture as app-sidebar.tsx's own "Document Sets" comment.
function filenameFromStoragePath(path: string): string {
  const segment = path.split('/').pop() ?? path;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function StatusPill({ status }: { status: InquiryStatus }) {
  const styles: Record<InquiryStatus, string> = {
    pending: 'bg-amber-500/10 text-amber-600',
    accepted: 'bg-primary/10 text-primary',
    converted_to_case: 'bg-emerald-500/10 text-emerald-600',
  };
  const labels: Record<InquiryStatus, string> = {
    pending: 'Pending your response',
    accepted: 'Accepted',
    converted_to_case: 'Converted to case',
  };
  const Icon: Record<InquiryStatus, typeof Clock> = {
    pending: Clock,
    accepted: CheckCircle2,
    converted_to_case: Scale,
  };
  const IconComponent = Icon[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${styles[status]}`}
    >
      <IconComponent className="h-3.5 w-3.5" strokeWidth={2} />
      {labels[status]}
    </span>
  );
}

export default function LawyerInquiriesPage() {
  const [inquiries, setInquiries] = useState<LawyerInquiryListing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'all' | InquiryStatus>('all');
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [convertTitle, setConvertTitle] = useState('');

  const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadInquiries = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/lawyer-inquires', { credentials: 'include' });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      // Real confirmed envelope: { data: LawyerInquiryListing[] } -- see
      // src/app/api/lawyer-inquires/route.ts's own GET handler.
      setInquiries(json.data as LawyerInquiryListing[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load your inquiries.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInquiries();
  }, [loadInquiries]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return inquiries;
    return inquiries.filter((i) => i.status === statusFilter);
  }, [inquiries, statusFilter]);

  const counts = useMemo(
    () => ({
      pending: inquiries.filter((i) => i.status === 'pending').length,
      accepted: inquiries.filter((i) => i.status === 'accepted').length,
      converted: inquiries.filter((i) => i.status === 'converted_to_case').length,
    }),
    [inquiries],
  );

  async function handleAccept(id: string) {
    setActionError(null);
    setActioningId(id);
    try {
      const res = await fetch(`/api/lawyer-inquires/${id}/accept`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      const updated: LawyerInquiryListing = json.data;
      setInquiries((prev) => prev.map((i) => (i.id === id ? updated : i)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not accept this inquiry.');
    } finally {
      setActioningId(null);
    }
  }

  async function handleDecline(id: string) {
    setActionError(null);
    setActioningId(id);
    try {
      const res = await fetch(`/api/lawyer-inquires/${id}/decline`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      // declineInquiry() deletes the row outright (§4.2) -- drop it from
      // the list rather than trying to update it in place.
      setInquiries((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not decline this inquiry.');
    } finally {
      setActioningId(null);
    }
  }

  function openConvert(id: string) {
    setActionError(null);
    setConvertTitle('');
    setConvertingId(id);
  }

  async function handleConvertSubmit() {
    if (!convertingId) return;
    const trimmed = convertTitle.trim();
    if (trimmed.length === 0) {
      setActionError('A case title is required to convert this inquiry.');
      return;
    }

    setActionError(null);
    setActioningId(convertingId);
    try {
      const res = await fetch(`/api/lawyer-inquires/${convertingId}/convert`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      const updated: LawyerInquiryListing = json.data;
      setInquiries((prev) => prev.map((i) => (i.id === convertingId ? updated : i)));
      setConvertingId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not convert this inquiry.');
    } finally {
      setActioningId(null);
    }
  }

  const filterTabs: Array<{ key: 'all' | InquiryStatus; label: string; count: number }> = [
    { key: 'all', label: 'All', count: inquiries.length },
    { key: 'pending', label: 'Pending', count: counts.pending },
    { key: 'accepted', label: 'Accepted', count: counts.accepted },
    { key: 'converted_to_case', label: 'Converted', count: counts.converted },
  ];

  return (
    <div className="flex h-screen w-full bg-muted/30 font-sans text-foreground">
      <AppSidebar active="inquiries" />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-background px-8 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Inbox className="h-5 w-5 text-primary" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-[19px] font-semibold leading-tight text-foreground">
                My Inquiries
              </h1>
              <p className="text-[12.5px] text-muted-foreground">
                Contact requests routed to you. Accept, decline, or convert into a matter.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
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
              <p className="text-[13px]">Loading your inquiries…</p>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">{loadError}</p>
              <button
                onClick={loadInquiries}
                className="text-[13px] font-medium underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-5">
              {/* Filter tabs */}
              <div className="flex flex-wrap items-center gap-2">
                {filterTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setStatusFilter(tab.key)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                      statusFilter === tab.key
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    {tab.label}
                    <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              {actionError && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {actionError}
                </div>
              )}

              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card px-6 py-16 text-muted-foreground">
                  <Inbox className="h-6 w-6" strokeWidth={1.5} />
                  <p className="text-[13px]">
                    {statusFilter === 'all'
                      ? "You don't have any inquiries yet."
                      : `No ${statusFilter === 'converted_to_case' ? 'converted' : statusFilter} inquiries.`}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {filtered.map((inquiry) => {
                    const isBusy = actioningId === inquiry.id;
                    return (
                      <div
                        key={inquiry.id}
                        className="flex flex-col gap-4 rounded-lg border border-border bg-card px-6 py-5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                              <FileText className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-[13.5px] font-medium text-foreground">
                                {filenameFromStoragePath(inquiry.documentStoragePath)}
                              </p>
                              <p className="text-[12px] text-muted-foreground">
                                Received {formatTimestamp(inquiry.createdAt)}
                              </p>
                            </div>
                          </div>
                          <StatusPill status={inquiry.status} />
                        </div>

                        {inquiry.analysisResult !== null && inquiry.analysisResult !== undefined && (
                          <p className="text-[12px] text-muted-foreground">
                            Analysis attached — full detail unlocks once accepted.
                          </p>
                        )}

                        {inquiry.status === 'pending' && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleAccept(inquiry.id)}
                              disabled={isBusy}
                              className="flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                              Accept
                            </button>
                            <button
                              onClick={() => handleDecline(inquiry.id)}
                              disabled={isBusy}
                              className="flex items-center gap-2 rounded-md border border-input px-3.5 py-2 text-[13px] font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Decline
                            </button>
                          </div>
                        )}

                        {inquiry.status === 'accepted' &&
                          (convertingId === inquiry.id ? (
                            <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 px-3.5 py-3">
                              <label
                                htmlFor={`convert-title-${inquiry.id}`}
                                className="text-[12.5px] font-medium text-foreground"
                              >
                                Case title
                              </label>
                              <input
                                id={`convert-title-${inquiry.id}`}
                                type="text"
                                value={convertTitle}
                                onChange={(e) => setConvertTitle(e.target.value)}
                                placeholder="e.g. Sharma v. Sharma — Property Dispute"
                                className="rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={handleConvertSubmit}
                                  disabled={isBusy}
                                  className="flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                  Create case
                                </button>
                                <button
                                  onClick={() => setConvertingId(null)}
                                  disabled={isBusy}
                                  className="flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] text-muted-foreground hover:bg-muted"
                                >
                                  <X className="h-3.5 w-3.5" />
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <button
                                onClick={() => openConvert(inquiry.id)}
                                className="flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground"
                              >
                                <Scale className="h-3.5 w-3.5" strokeWidth={1.75} />
                                Convert to case
                              </button>
                            </div>
                          ))}

                        {inquiry.status === 'converted_to_case' && (
                          <p className="text-[12.5px] text-muted-foreground">
                            This inquiry has already been converted into a matter.
                          </p>
                        )}
                      </div>
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
