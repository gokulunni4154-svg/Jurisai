// src/shared/components/notifications/hearing-reminder-status.tsx
// NEW FILE, THIS SESSION — file number not yet assigned (see Item #53
// for the existing backlog of unnumbered files; this adds one more).
//
// End-user-facing Observability widget (Phase 3, scoped this session:
// admin view deferred because it needs a new admin-scoped backend read
// path that doesn't exist yet -- see PROJECT_PROGRESS.md discussion.
// This end-user view was chosen specifically because it's buildable
// against real, already-existing, already-RLS-scoped source with no
// new backend work.
//
// SOURCE-VERIFIED AGAINST:
//   - notifications-panel.tsx's own header comments, which record real
//     verification this project already did against GET /api/notifications
//     (response shape `{ data: { notifications, total, limit, offset } }`)
//     and the real NotificationRow shape (id, user_id, document_id, type,
//     title, message, hearing_date_snapshot, read_at, created_at).
//   - Same component reused/adapted: fetch logic, error handling shape,
//     and relative-time formatting are copied from notifications-panel.tsx
//     rather than reinvented, to stay consistent with its already-verified
//     behavior.
//
// DELIBERATELY NOT ASSUMED: notifications-panel.tsx's own header flags
// that listNotificationsQuerySchema's real query params were never
// independently re-confirmed beyond limit/offset/unreadOnly -- a `type`
// filter param is NOT confirmed to exist. This component does NOT pass
// a `type` param to the API. Instead it fetches the most recent page
// (limit=20, same page size notifications-panel.tsx already uses) and
// filters client-side for `type === 'hearing_date_reminder'`. FLAGGED
// LIMITATION: if a user has more than 20 notifications of other types
// more recent than their last hearing_date_reminder, this widget will
// incorrectly report "no reminder yet" even if one exists further back.
// Not silently accepted as fine -- revisit if `type` filtering is ever
// confirmed to exist, or increase the fetch limit as a workaround.
//
// PLACEMENT: same flagged, non-established-convention placement as
// notifications-panel.tsx (src/shared/components/notifications/) --
// not proof this is "correct," just consistent with the existing file.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, BellRing, CheckCircle2, Loader2 } from 'lucide-react';

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

const HEARING_REMINDER_TYPE = 'hearing_date_reminder';
const FETCH_LIMIT = 20; // see file-level FLAGGED LIMITATION above

export function HearingReminderStatus() {
  const [lastReminder, setLastReminder] = useState<NotificationRow | null>(null);
  const [hasCheckedOnce, setHasCheckedOnce] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ limit: String(FETCH_LIMIT), offset: '0' });
      const res = await fetch(`/api/notifications?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json: ListNotificationsResponse = await res.json();

      const reminders = json.data.notifications
        .filter((n) => n.type === HEARING_REMINDER_TYPE)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setLastReminder(reminders[0] ?? null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load reminder status.');
    } finally {
      setIsLoading(false);
      setHasCheckedOnce(true);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  if (isLoading && !hasCheckedOnce) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Checking reminder status…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-destructive">
        <AlertCircle className="h-3.5 w-3.5" />
        <span>{loadError}</span>
        <button onClick={fetchStatus} className="font-medium underline underline-offset-2">
          Retry
        </button>
      </div>
    );
  }

  if (!lastReminder) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <BellRing className="h-3.5 w-3.5" />
        <span>No hearing reminders sent yet.</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
      <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
      <span>
        Last reminder sent {formatRelativeTime(lastReminder.created_at)} — hearing on{' '}
        {new Date(lastReminder.hearing_date_snapshot).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </span>
    </div>
  );
}