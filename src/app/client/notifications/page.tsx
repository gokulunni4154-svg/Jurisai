// src/app/client/notifications/page.tsx
//
// NEW FILE — Client Portal Phase 3, Client Notifications (hearing
// reminders), per JurisAI_Architecture_Audit.md's Client Portal Phase 3
// brief.
//
// API: reuses GET /api/notifications and PATCH
// /api/notifications/[notificationId]/read UNCHANGED (both confirmed
// real, pasted this session) -- both are already role-agnostic,
// RLS-scoped to `user_id = auth.uid()` (notifications_select_own /
// notifications_update_own), with zero role check in
// buildNotificationService()/NotificationService. A 'client'-role
// caller's own notification rows are already the only rows either
// route can return for them -- no client-specific route was needed or
// built, matching the brief's own "prefer reuse over duplication"
// instruction.
//
// SHELL: deliberately mirrors src/app/client/page.tsx's own minimal
// header (wordmark + "Client Portal" label, no Lawyer/Firm icon rail)
// rather than introducing any shared Client Portal layout -- this
// project has no shared layout.tsx anywhere (confirmed across every
// prior real session touching this repo), each page reimplements its
// own header, and this page follows that same established convention
// rather than inventing a new one.
//
// SCOPE: read-only list + mark-as-read only, matching the approved
// feature exactly -- no delete, no notification-type filtering UI, no
// preference center. `notifications-panel.tsx` (the Lawyer/Firm
// left-rail dropdown) was NOT reused here: it's absolutely positioned
// against that rail (`left-16`) which the Client Portal must never
// show, and types its rows narrowly around the older document-scoped
// shape (document_id/hearing_date_snapshot) rather than the real,
// current NotificationRow shape (which also carries hearing_id/
// inquiry_id, all nullable) -- a small purpose-built list was more
// faithful to the current schema than adapting that component.
//
// NAVIGATION: linked from /client's header via a Notifications button
// with an unread-count badge (see that page's own header changes this
// session). Case-linked notifications route back to
// /client/cases/[id] -- that page enforces its own client
// authorization independently (cases_select_client_own RLS via
// ClientCaseService, confirmed real in prior sessions); this link is
// never relied on for security, per the brief's own instruction.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Bell, Gavel, Inbox, Loader2, Scale } from 'lucide-react';

interface NotificationRow {
  id: string;
  user_id: string;
  document_id: string | null;
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

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ClientNotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingReadIds, setMarkingReadIds] = useState<Set<string>>(new Set());

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50', offset: '0', unreadOnly: 'false' });
      const res = await fetch(`/api/notifications?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json: ListNotificationsResponse = await res.json();
      setNotifications(json.data.notifications);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkRead = async (id: string) => {
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
      setError(err instanceof Error ? err.message : 'Could not mark notification as read.');
    } finally {
      setMarkingReadIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const unreadCount = notifications.filter((n) => n.read_at === null).length;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-5 sm:px-8">
        <button
          onClick={() => router.push('/client')}
          className="flex items-center gap-2.5"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
            <Scale className="h-4 w-4 text-primary-foreground" strokeWidth={1.75} />
          </div>
          <div className="text-left">
            <p className="font-serif text-[16px] leading-none text-foreground">JurisAI</p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Client Portal
            </p>
          </div>
        </button>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Client Portal
            </p>
            <h1 className="flex items-center gap-2 font-serif text-[26px] leading-tight text-foreground">
              <Bell className="h-5 w-5 text-primary" strokeWidth={1.75} />
              Notifications
            </h1>
          </div>
          {unreadCount > 0 && (
            <span className="rounded-full bg-primary/10 px-3 py-1 text-[12px] font-medium text-primary">
              {unreadCount} unread
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-[13px]">Loading your notifications…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="text-[13px]">{error}</p>
            <button
              onClick={fetchNotifications}
              className="text-[13px] font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-24 text-muted-foreground">
            <Inbox className="h-5 w-5" />
            <p className="text-[13px]">No notifications yet.</p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`flex items-start gap-3 px-5 py-4 ${n.read_at === null ? 'bg-primary/5' : ''}`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <Gavel className="h-4 w-4 text-primary" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-medium text-foreground">{n.title}</p>
                    {n.read_at === null && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                        aria-label="Unread"
                      />
                    )}
                  </div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                    {n.message}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground/70">
                      {formatRelativeTime(n.created_at)}
                    </span>
                    {n.read_at === null && (
                      <button
                        onClick={() => handleMarkRead(n.id)}
                        disabled={markingReadIds.has(n.id)}
                        className="flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline disabled:opacity-60"
                      >
                        {markingReadIds.has(n.id) && <Loader2 className="h-3 w-3 animate-spin" />}
                        Mark as read
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
