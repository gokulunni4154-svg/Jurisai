// src/app/cases/page.tsx
//
// NEW FILE -- Lawyer Terminal, Matters Page (Task 2). Per Step 1's own
// inspection requirement: no Matters/cases list page existed anywhere
// in this repo before this file -- only /cases/[id] and its
// /notes /timeline /hearings sub-pages did. This is the first content
// at the bare /cases route, chosen over a new /matters segment so the
// list sits next to its own real sibling detail route
// (/cases/[id]/page.tsx) rather than introducing a second URL family
// for the same resource.
//
// VISUAL SOURCE OF TRUTH: (dashboard)/lawyer/page.tsx (real, pasted,
// read this session) -- rail markup below (icons, primary-rail colors,
// button states, NotificationsPanel wiring), header shape, search
// input, card/list/empty-state tokens (bg-card, border-border,
// text-muted-foreground, font-serif headings, rounded-md/rounded-lg,
// Loader2/AlertCircle/Inbox state icons) are copied from that file
// nearly verbatim, NOT reinvented -- same "consistency over novelty"
// posture that file's own header documents. The dashboard page ITSELF
// is left completely unmodified by this task (explicit instruction);
// this page gets its own copy of the same inline rail (no shared
// layout.tsx exists for the (dashboard) route group or for /cases --
// confirmed, same known/accepted gap every page in this family already
// carries, not introduced here) with "Matters" marked aria-current
// instead of "Dashboard", and a working link back to /lawyer.
//
// DATA LAYER -- entirely reused, nothing new below the Service layer
// except two small additive methods (CaseRepository#findManyVisibleWithClient(),
// CaseService#listMatters()) and this page's own thin GET /api/cases/matters
// route. Visibility (owner / active grant / firm owner-admin override)
// is enforced by cases' own existing, unmodified RLS -- this page does
// not add, weaken, or duplicate any authorization check itself. Client
// name may be blank for a matter that has one on file -- see
// CaseRepository#findManyVisibleWithClient()'s own doc comment: that is
// the correct, RLS-respecting result for a plain firm member who isn't
// their firm's owner/admin, not a bug.
//
// "New matter" reuses the existing POST /api/cases + resolveMyFirmId()
// pattern verbatim from (dashboard)/lawyer/page.tsx's own NewCaseModal
// -- including that file's own flagged, unverified assumption about
// GET /api/billing/firms/mine's response shape (data.id). Not
// re-litigated here.
//
// Search is client-side over the already-authorized, RLS-scoped
// dataset returned by GET /api/cases/matters -- matches this task's
// own Step 7 guidance ("acceptable for a reasonably sized existing
// dataset... do NOT introduce a new search architecture unnecessarily")
// and mirrors the identical client-side search already shipped on the
// Lawyer Dashboard for its own cases/tasks/hearings sections. Filters
// by status only -- the only case field with a fixed, known value set
// (cases_status_check: open/pending/on_hold/closed/won/lost/settled/
// withdrawn); no priority/assigned-lawyer filter is added since
// neither field exists on `cases` today (Step 8: "only implement
// filters that are genuinely supported by the existing schema").
//
// "Next hearing" per matter reuses GET /api/hearings/upcoming
// (unmodified, real, pasted route) fetched in parallel and matched to
// a matter by case_id client-side -- same technique
// LawyerDashboardService#getDashboard() already uses server-side for
// its own "upcoming hearings" section, just recomputed per-matter here
// instead of as one flat list. No new hearings query/route was added.
//
// DELIBERATELY NOT SHOWN, real scope decisions (flagged, not gaps to
// silently paper over): "assigned lawyer" per matter is left off this
// card -- doing it without an N+1 query per matter would need a new
// batch-lookup method on case-access-grant.repository.ts, which is
// more than the "extend a small missing method" allowance this task's
// Step 14 gives, and Task 2's own Step 17 says not to touch unrelated
// pages/modules; "last activity" is approximated by the case's own
// updated_at (already a real column), not a separate activity-feed
// query. Both are reasonable follow-ups, not silently dropped.

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Plus,
  FileText,
  Scale,
  LayoutDashboard,
  CalendarClock,
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
  X,
  ChevronDown,
} from 'lucide-react';
import { NotificationsPanel } from '@/shared/components/notifications/notifications-panel';

interface MatterRow {
  id: string;
  title: string;
  status: string;
  case_number: string | null;
  client_id: string | null;
  client_full_name: string | null;
  updated_at: string;
}

interface HearingRow {
  id: string;
  case_id: string;
  hearing_type: string;
  hearing_date: string;
}

const STATUS_OPTIONS = [
  'open',
  'pending',
  'on_hold',
  'closed',
  'won',
  'lost',
  'settled',
  'withdrawn',
] as const;

function statusLabel(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'open':
    case 'pending':
      return 'bg-primary/10 text-primary';
    case 'won':
    case 'settled':
      return 'bg-emerald-500/10 text-emerald-700';
    case 'lost':
    case 'withdrawn':
      return 'bg-destructive/10 text-destructive';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Same FLAGGED, UNVERIFIED SHAPE assumption as
 * (dashboard)/lawyer/page.tsx's own resolveMyFirmId() -- copied
 * verbatim, not re-derived. See that file's header.
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

function extractErrorMessage(json: unknown, fallback: string): string {
  if (json && typeof json === 'object' && 'error' in json) {
    const err = (json as { error?: { message?: string } }).error;
    if (err?.message) return err.message;
  }
  return fallback;
}

function NewMatterModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (newMatter: MatterRow) => void;
}) {
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Give the matter a title.');
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
        throw new Error(extractErrorMessage(json, 'Failed to create matter.'));
      }

      const created = json.data as { id: string; title: string; status: string; updated_at: string };
      onCreated({
        id: created.id,
        title: created.title,
        status: created.status,
        updated_at: created.updated_at,
        case_number: null,
        client_id: null,
        client_full_name: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create matter.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-[19px] text-foreground">New matter</h2>
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
            <label htmlFor="matter-title" className="mb-1.5 block text-[13px] font-medium text-foreground">
              Matter title
            </label>
            <input
              id="matter-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sharma vs. Patel — Property Dispute"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12px] text-destructive"
            >
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
              {isSubmitting ? 'Creating…' : 'Create matter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MattersPage() {
  const router = useRouter();

  const [matters, setMatters] = useState<MatterRow[] | null>(null);
  const [hearings, setHearings] = useState<HearingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const [isNewMatterOpen, setIsNewMatterOpen] = useState(false);

  const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setForbidden(false);

      try {
        const [mattersRes, hearingsRes] = await Promise.all([
          fetch('/api/cases/matters', { credentials: 'include' }),
          fetch('/api/hearings/upcoming', { credentials: 'include' }),
        ]);

        if (mattersRes.status === 403) {
          if (!cancelled) setForbidden(true);
          return;
        }

        const mattersJson = await mattersRes.json();
        if (!mattersRes.ok) {
          throw new Error(extractErrorMessage(mattersJson, 'Failed to load matters.'));
        }
        if (!cancelled) setMatters(mattersJson.data as MatterRow[]);

        // Hearings are a secondary, non-critical enhancement (next-
        // hearing-per-matter) -- a failure here should not block the
        // matters list itself from rendering.
        if (hearingsRes.ok) {
          const hearingsJson = await hearingsRes.json();
          if (!cancelled) setHearings((hearingsJson.data as HearingRow[]) ?? []);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load matters.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const nextHearingByCaseId = useMemo(() => {
    const map = new Map<string, HearingRow>();
    const sorted = [...hearings].sort(
      (a, b) => new Date(a.hearing_date).getTime() - new Date(b.hearing_date).getTime(),
    );
    for (const h of sorted) {
      if (!map.has(h.case_id)) map.set(h.case_id, h);
    }
    return map;
  }, [hearings]);

  const q = query.trim().toLowerCase();

  const filteredMatters = useMemo(() => {
    if (!matters) return [];
    return matters.filter((m) => {
      if (statusFilter && m.status !== statusFilter) return false;
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        (m.case_number ?? '').toLowerCase().includes(q) ||
        (m.client_full_name ?? '').toLowerCase().includes(q)
      );
    });
  }, [matters, statusFilter, q]);

  const handleMatterCreated = (newMatter: MatterRow) => {
    setMatters((prev) => (prev ? [newMatter, ...prev] : [newMatter]));
    setIsNewMatterOpen(false);
  };

  return (
    <div className="relative flex h-screen w-full bg-background font-sans text-foreground">
      {/* Left rail -- same inline pattern as (dashboard)/lawyer/page.tsx, see file header */}
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
            className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-foreground/10 text-primary-foreground"
            aria-current="page"
            aria-label="Matters"
          >
            <FileText className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
          <button
            onClick={() => router.push('/hearings/upcoming')}
            className="flex h-10 w-10 items-center justify-center rounded-md text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
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

      {isNewMatterOpen && (
        <NewMatterModal onClose={() => setIsNewMatterOpen(false)} onCreated={handleMatterCreated} />
      )}

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex flex-col gap-4 border-b border-border px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              JurisAI
            </p>
            <h1 className="font-serif text-[26px] leading-none text-foreground">Matters</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title, case no., client"
                className="w-full bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none sm:w-56"
              />
            </div>

            <div className="relative">
              <button
                onClick={() => setIsStatusMenuOpen((prev) => !prev)}
                className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground"
                aria-expanded={isStatusMenuOpen}
              >
                {statusFilter ? statusLabel(statusFilter) : 'All statuses'}
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
              </button>
              {isStatusMenuOpen && (
                <>
                  <button
                    className="fixed inset-0 z-10 cursor-default"
                    aria-hidden="true"
                    tabIndex={-1}
                    onClick={() => setIsStatusMenuOpen(false)}
                  />
                  <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-border bg-card py-1 shadow-lg">
                    <button
                      onClick={() => {
                        setStatusFilter(null);
                        setIsStatusMenuOpen(false);
                      }}
                      className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-muted ${
                        statusFilter === null ? 'font-medium text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      All statuses
                    </button>
                    {STATUS_OPTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setStatusFilter(s);
                          setIsStatusMenuOpen(false);
                        }}
                        className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-muted ${
                          statusFilter === s ? 'font-medium text-foreground' : 'text-muted-foreground'
                        }`}
                      >
                        {statusLabel(s)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => setIsNewMatterOpen(true)}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              New matter
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Loading your matters…</p>
            </div>
          ) : forbidden ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card py-24 text-muted-foreground">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">You don&apos;t have access to this page.</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">{error}</p>
            </div>
          ) : filteredMatters.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-24 text-muted-foreground">
              <Inbox className="h-6 w-6" />
              <p className="text-[13px]">
                {q || statusFilter ? 'No matters match your search.' : 'No matters yet.'}
              </p>
              {!q && !statusFilter && (
                <button
                  onClick={() => setIsNewMatterOpen(true)}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                  Create your first matter
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
              {filteredMatters.map((m) => {
                const nextHearing = nextHearingByCaseId.get(m.id) ?? null;
                return (
                  <button
                    key={m.id}
                    onClick={() => router.push(`/cases/${m.id}`)}
                    className="flex flex-col gap-3 px-5 py-4 text-left transition-colors hover:bg-muted sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                      <FileText className="h-[18px] w-[18px] text-primary" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-foreground">{m.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                        {m.case_number && <span>{m.case_number}</span>}
                        <span>{m.client_full_name ?? 'No client on file'}</span>
                        <span>Updated {formatDate(m.updated_at)}</span>
                      </p>
                    </div>
                    {nextHearing && (
                      <div className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                        <Gavel className="h-3.5 w-3.5" strokeWidth={1.5} />
                        {nextHearing.hearing_type} · {formatDate(nextHearing.hearing_date)}
                      </div>
                    )}
                    <span
                      className={`shrink-0 self-start rounded-full px-2.5 py-1 text-[11px] font-medium sm:self-auto ${statusBadgeClass(
                        m.status,
                      )}`}
                    >
                      {statusLabel(m.status)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
