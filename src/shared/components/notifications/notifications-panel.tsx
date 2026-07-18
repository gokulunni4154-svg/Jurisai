// src/shared/components/notifications/notifications-panel.tsx
// NEW FILE, THIS SESSION.
//
// FLAGGED, DELEGATED DECISION: no shared-component location has been
// established anywhere in this project's history for a cross-page widget
// like this — every prior file has been a page (src/app/**) or a
// core/module file, never something under src/shared/components. Placed
// here because tailwind.config.ts's own `content` globs already include
// `./src/shared/components/**/*.{ts,tsx}`, so this is at least a path the
// project's build is already configured to scan — not proof this is the
// "right" location by any stated convention, just a reasonable, flagged
// default.
//
// SOURCE-VERIFIED AGAINST, THIS SESSION:
//   - GET /api/notifications (route.ts) -> confirmed real response shape
//     `{ data: { notifications, total, limit, offset } }`, flat pagination,
//     query params `limit`/`offset`/`unreadOnly`.
//   - notification.service.ts's NotificationRow shape (via
//     database.types.ts, regenerated and confirmed this session):
//     id, user_id, document_id, type, title, message,
//     hearing_date_snapshot, read_at, created_at.
//   - notifications.schemas.ts's listNotificationsQuerySchema was NOT
//     re-pasted this session — this file assumes `unreadOnly` and
//     `limit`/`offset` are the only real query params, based on
//     notification.service.ts's own listNotifications() destructuring
//     (`query.limit`, `query.offset`, `query.unreadOnly`). Flagged as
//     inferred from the service, not independently confirmed against the
//     schema file itself.
//
// NOT SOURCE-VERIFIED, FLAGGED: the PATCH /api/notifications/[id]/read
// route's real request/response shape has never been pasted in any
// session captured by PROJECT_PROGRESS.md — only NotificationService
// .markAsRead()'s existence and behavior (returns the updated
// NotificationRow) is confirmed. This component assumes the route
// mirrors PATCH /api/documents/[id]'s own confirmed shape (empty body,
// `{ data: { <the updated row> } }` response) since that's the only real
// PATCH-response precedent in this project — NOT drawn from the actual
// route.ts for this specific endpoint, which hasn't been seen. Ask for
// that file if this doesn't work as built.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Bell, Loader2, X } from 'lucide-react';

interface NotificationRow {
  id: string;
  user_id: string;
  document_id: string;
  type: string;
  title: string;
  message: string;
  hearing_date_snapshot: string;
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
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
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

interface NotificationsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  // NEW — lets the parent (File 159's left rail) know the unread count
  // so the Bell icon's badge can reflect it without this panel owning
  // the badge's rendering itself. Called after every successful fetch
  // and after every successful mark-as-read.
  onUnreadCountChange?: (count: number) => void;
}

export function NotificationsPanel({ isOpen, onClose, onUnreadCountChange }: NotificationsPanelProps) {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [markingReadIds, setMarkingReadIds] = useState<Set<string>>(new Set());

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ limit: '20', offset: '0' });
      const res = await fetch(`/api/notifications?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json: ListNotificationsResponse = await res.json();
      setNotifications(json.data.notifications);
      onUnreadCountChange?.(json.data.notifications.filter((n) => n.read_at === null).length);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load notifications.');
    } finally {
      setIsLoading(false);
    }
  }, [onUnreadCountChange]);

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, fetchNotifications]);

  // FLAGGED — see file-level comment: request/response shape assumed
  // from PATCH /api/documents/[id]'s confirmed convention, NOT from this
  // specific route's real source.
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
      setNotifications((prev) => {
        const next = prev.map((n) => (n.id === id ? updated : n));
        onUnreadCountChange?.(next.filter((n) => n.read_at === null).length);
        return next;
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not mark notification as read.');
    } finally {
      setMarkingReadIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="absolute bottom-0 left-16 z-50 flex h-screen w-80 flex-col border-r border-border bg-card shadow-lg"
      role="dialog"
      aria-label="Notifications"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" strokeWidth={1.75} />
          <h2 className="font-serif text-[16px] text-foreground">Notifications</h2>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50"
          aria-label="Close notifications"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-[13px]">Loading…</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center gap-3 px-5 py-16 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="text-center text-[13px]">{loadError}</p>
            <button
              onClick={fetchNotifications}
              className="text-[13px] font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-5 py-16 text-muted-foreground">
            <p className="text-[13px]">No notifications yet.</p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => n.read_at === null && handleMarkRead(n.id)}
                className={`flex flex-col items-start gap-1 px-5 py-3 text-left transition-colors hover:bg-muted/50 ${
                  n.read_at === null ? 'bg-primary/5' : ''
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-foreground">{n.title}</p>
                  {n.read_at === null && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                  )}
                </div>
                <p className="text-[12px] leading-relaxed text-muted-foreground">{n.message}</p>
                <div className="flex w-full items-center justify-between text-[11px] text-muted-foreground/70">
                  <span>{formatRelativeTime(n.created_at)}</span>
                  {markingReadIds.has(n.id) && <Loader2 className="h-3 w-3 animate-spin" />}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}