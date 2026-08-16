// REAL FILE PATH: src/app/notifications/page.tsx
//
// LAWYER TERMINAL — MY NOTIFICATIONS. New page, this session, per the
// "next genuinely missing Lawyer Terminal workflow" audit.
//
// AUDIT FINDING: GET /api/notifications (real, pre-existing,
// unmodified) already accepts limit/offset/unreadOnly and returns
// `{ data: { notifications, total, limit, offset } }` —
// listNotificationsQuerySchema (notifications.schemas.ts) defines all
// three as real, validated query params, and NotificationService
// #listNotifications() already threads them through to
// NotificationRepository#findMany()/#count(). Despite that, the only
// existing frontend consumer anywhere in the repo —
// notifications-panel.tsx, the dropdown mounted from every Lawyer
// Terminal page's header bell — hardcodes `limit=20&offset=0` and never
// sends `unreadOnly` at all. There has never been a way for a lawyer to
// see anything past their 20 most recent notifications, filter to
// unread-only, or page through their history, even though the backend
// already supports all three. PATCH /api/notifications/[id]/read (also
// real, pre-existing, unmodified) is reused as-is for the per-row
// "mark read" action, same call shape notifications-panel.tsx already
// uses.
//
// GENUINE GAP THIS PAGE CLOSES: a real, full-history "My Notifications"
// page — paginated list, unread-only filter, mark-as-read per row, and
// a link from each notification to the resource it's actually about.
//
// NO BACKEND CHANGE. No migration, no new route, no schema change —
// this page only calls the two routes above, already RLS-scoped to
// `user_id = auth.uid()` (notifications_select_own /
// notifications_update_own,
// 20260725010000_create_notifications_table.sql). Priority-1 gap per
// the audit brief: existing backend + API + authorization with a
// missing Lawyer Terminal UI.
//
// ROW SHAPE: mirrors the real `notifications` table exactly, per the
// generated database.types.ts (source-verified this session, NOT the
// narrower 3-type/document-only shape notification.entity.ts and
// notifications.schemas.ts's NotificationType enum still describe —
// those two files are stale relative to the two additive widening
// migrations, 20260811000000_widen_notifications_for_lawyer_inquiries
// .sql and 20260904000001_widen_notifications_for_hearings.sql, which
// added inquiry_id/hearing_id and made document_id/
// hearing_date_snapshot nullable, plus a 4th type value,
// 'hearing_reminder', that the enum never picked up. Flagged as
// pre-existing tech debt, not fixed here — out of scope for "add UI to
// existing functionality," and NotificationService#listNotifications()
// returns the real generated-type row regardless, so this page is not
// blocked by that drift; `type` is read here as `string`, not
// `NotificationType`, specifically because that stale enum cannot be
// trusted to be exhaustive.
//
// PER-ROW "VIEW" LINK: routes by which reference column is populated,
// not by `type`, matching notifications_reference_by_type_check's own
// enforcement that exactly one reference column is set per row:
//   - document_id set -> /documents/[id] (real, existing detail page)
//   - inquiry_id set   -> /lawyer-inquiries (real, existing page; no
//     per-inquiry detail route exists to deep-link to, so this links to
//     the worklist itself rather than inventing one)
//   - hearing_id set, OR document_id set with no hearing_id (the
//     original hearing_date_set/hearing_date_reminder types, which
//     reference a document's hearing_date directly, not a hearings
//     row) -> /hearings/upcoming (real, existing page; there is no
//     GET-by-id hearings route or hearing detail page to deep-link
//     into — hearings/[id]/route.ts only exports PATCH/DELETE,
//     confirmed this session — so this links to the calendar list
//     itself rather than inventing a new page/route)
// Building a real per-inquiry or per-hearing detail deep link is
// flagged as a clean follow-up, not invented here.
//
// STYLING: matches the established Lawyer Terminal visual system —
// AppSidebar shell, semantic tokens (border-border, bg-card,
// text-muted-foreground, bg-primary, etc.), same header/loading/error/
// empty-state markup conventions as invitations/page.tsx and
// lawyer-inquiries/page.tsx.
//
// DISCOVERABILITY:
//   - "My Notifications" added to the AppSidebar account-menu dropdown,
//     alongside My Profile / My Verification / My Invitations — same
//     "status of my own account" placement reasoning invitations/
//     page.tsx's own header comment already gives for why My
//     Invitations lives there rather than as a top-level item. A
//     notification is exactly that same class of self-directed, no
//     external-party-waiting concern.
//   - A "View all" button added to notifications-panel.tsx's header,
//     next to the close button — the dropdown's own natural entry point
//     into the full history it can't itself show. Closes the panel and
//     navigates to /notifications.
//
// DELIBERATELY NOT ADDED:
//   - No "mark all as read" bulk action — no such route exists
//     (PATCH /api/notifications/[notificationId]/read is single-row
//     only, confirmed this session) and adding one would mean a new
//     service method + route, out of scope for "add UI to existing
//     functionality."
//   - No delete action — notifications table has no delete RLS policy
//     (confirmed, same migration) and no delete route exists.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Bell,
  Briefcase,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  FileText,
  Inbox,
  Loader2,
} from 'lucide-react';
import { AppSidebar } from '@/shared/components/layout/app-sidebar';
import { NotificationsPanel } from '@/shared/components/notifications/notifications-panel';

// Mirrors the real `notifications` table's generated Row type
// (database.types.ts) field-for-field — same "mirrored, not imported"
// convention every client page in this project follows for a table
// with no shared client-safe types module (see invitations/page.tsx's
// identical posture on PendingFirmInvitation/PendingTeamInvitation).
// `type` is deliberately `string`, not the narrower NotificationType
// enum — see file-header comment on why that enum is stale.
interface NotificationRow {
  id: string;
  user_id: string;
  document_id: string | null;
  hearing_date_snapshot: string | null;
  hearing_id: string | null;
  inquiry_id: string | null;
  type: string;
  title: string;
  message: string;
  read_at: string | null;
  created_at: string;
}

interface ListNotificationsResponse {
  data: {
    notifications: NotificationRow[];
    total: number;
    limit: number;
    offset: number;
  };
}

const PAGE_SIZE = 20;

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

// Icon per notification kind, resolved by reference column — same
// "route by which reference column is set" logic the view-link below
// uses, kept consistent rather than switching on `type` in one place
// and reference columns in another.
function iconFor(n: NotificationRow) {
  if (n.inquiry_id) return Inbox;
  if (n.hearing_id || n.hearing_date_snapshot) return CalendarClock;
  if (n.document_id) return FileText;
  return Bell;
}

function viewHrefFor(n: NotificationRow): { href: string; label: string } | null {
  if (n.document_id) return { href: `/documents/${n.document_id}`, label: 'View document' };
  if (n.inquiry_id) return { href: '/lawyer-inquiries', label: 'View inquiries' };
  if (n.hearing_id || n.hearing_date_snapshot) {
    return { href: '/hearings/upcoming', label: 'View calendar' };
  }
  return null;
}

type FilterMode = 'all' | 'unread';

export default function NotificationsPage() {
  const router = useRouter();

  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<FilterMode>('all');

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [markingReadIds, setMarkingReadIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadNotifications = useCallback(async (currentOffset: number, currentFilter: FilterMode) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(currentOffset),
        unreadOnly: String(currentFilter === 'unread'),
      });
      const res = await fetch(`/api/notifications?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json: ListNotificationsResponse = await res.json();
      setNotifications(json.data.notifications);
      setTotal(json.data.total);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load your notifications.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications(offset, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, filter]);

  const handleFilterChange = (next: FilterMode) => {
    if (next === filter) return;
    setFilter(next);
    setOffset(0);
  };

  const handleMarkRead = async (id: string) => {
    setActionError(null);
    setMarkingReadIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/notifications/${id}/read`, {
        method: 'PATCH',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      const updated: NotificationRow = json.data.notification ?? json.data;
      setNotifications((prev) => prev.map((n) => (n.id === id ? updated : n)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not mark notification as read.');
    } finally {
      setMarkingReadIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canGoPrev = offset > 0;
  const canGoNext = offset + PAGE_SIZE < total;

  return (
    <div className="flex h-screen w-full bg-muted/30 font-sans text-foreground">
      <AppSidebar active="notifications" />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-background px-8 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Bell className="h-5 w-5 text-primary" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-[19px] font-semibold leading-tight text-foreground">
                My Notifications
              </h1>
              <p className="text-[12.5px] text-muted-foreground">
                Everything you&apos;ve been notified about, in one place.
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
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {/* Filter toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleFilterChange('all')}
                className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-input text-muted-foreground hover:bg-muted'
                }`}
              >
                All
              </button>
              <button
                onClick={() => handleFilterChange('unread')}
                className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                  filter === 'unread'
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-input text-muted-foreground hover:bg-muted'
                }`}
              >
                Unread only
              </button>
            </div>

            {actionError && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {actionError}
              </div>
            )}

            {isLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <p className="text-[13px]">Loading your notifications…</p>
              </div>
            ) : loadError ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <p className="text-[13px]">{loadError}</p>
                <button
                  onClick={() => loadNotifications(offset, filter)}
                  className="text-[13px] font-medium underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card px-6 py-16 text-muted-foreground">
                <Briefcase className="h-6 w-6" strokeWidth={1.5} />
                <p className="text-[13px]">
                  {filter === 'unread'
                    ? "You're all caught up — no unread notifications."
                    : "You don't have any notifications yet."}
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  {notifications.map((n) => {
                    const Icon = iconFor(n);
                    const isUnread = n.read_at === null;
                    const isMarking = markingReadIds.has(n.id);
                    const view = viewHrefFor(n);

                    return (
                      <div
                        key={n.id}
                        className={`flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border px-6 py-5 ${
                          isUnread ? 'bg-primary/5' : 'bg-card'
                        }`}
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                            <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-[13.5px] font-medium text-foreground">
                                {n.title}
                              </p>
                              {isUnread && (
                                <span
                                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                                  aria-label="Unread"
                                />
                              )}
                            </div>
                            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                              {n.message}
                            </p>
                            <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                              {formatTimestamp(n.created_at)}
                            </p>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          {view && (
                            <button
                              onClick={() => router.push(view.href)}
                              className="rounded-md border border-input px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-muted"
                            >
                              {view.label}
                            </button>
                          )}
                          {isUnread && (
                            <button
                              onClick={() => handleMarkRead(n.id)}
                              disabled={isMarking}
                              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isMarking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                              Mark read
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between border-t border-border pt-4">
                  <p className="text-[12px] text-muted-foreground">
                    Page {page} of {pageCount} · {total} total
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                      disabled={!canGoPrev}
                      className="flex items-center gap-1 rounded-md border border-input px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Previous
                    </button>
                    <button
                      onClick={() => setOffset((o) => o + PAGE_SIZE)}
                      disabled={!canGoNext}
                      className="flex items-center gap-1 rounded-md border border-input px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
