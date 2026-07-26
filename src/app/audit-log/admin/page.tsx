// src/app/audit-log/admin/page.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, Loader2, ScrollText, ShieldAlert } from 'lucide-react';

import { createClient } from '@/core/supabase/client';

type ActorType = 'user' | 'system' | 'webhook';

interface AuditLogRow {
  id: string;
  action: string;
  actor_id: string | null;
  actor_type: ActorType;
  created_at: string;
  firm_id: string | null;
  resource_id: string | null;
  resource_type: string | null;
}

interface GetAuditLogResponse {
  data: AuditLogRow[];
  total: number;
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
    hour: '2-digit',
    minute: '2-digit',
  });
}

const ACTOR_TYPE_LABELS: Record<ActorType, string> = {
  user: 'User',
  system: 'System',
  webhook: 'Webhook',
};

const ACTOR_TYPE_OPTIONS: Array<{ value: ActorType | ''; label: string }> = [
  { value: '', label: 'All actor types' },
  { value: 'user', label: 'User' },
  { value: 'system', label: 'System' },
  { value: 'webhook', label: 'Webhook' },
];

type RoleCheckStatus = 'checking' | 'authorized' | 'unauthorized';

export default function AdminAuditLogPage() {
  const router = useRouter();

  const [roleStatus, setRoleStatus] = useState<RoleCheckStatus>('checking');
  const [events, setEvents] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actionPrefix, setActionPrefix] = useState('');
  const [actorType, setActorType] = useState<ActorType | ''>('');
  const [appliedActionPrefix, setAppliedActionPrefix] = useState('');
  const [appliedActorType, setAppliedActorType] = useState<ActorType | ''>('');

  const fetchEvents = useCallback(
    async (nextOffset: number, prefix: string, type: ActorType | '') => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        });
        if (prefix.trim()) {
          params.set('actionPrefix', prefix.trim());
        }
        if (type) {
          params.set('actorType', type);
        }
        const res = await fetch(`/api/audit-log/admin?${params.toString()}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(await extractErrorMessage(res));
        const json: GetAuditLogResponse = await res.json();
        setEvents(json.data);
        setTotal(json.total);
        setOffset(nextOffset);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the audit log.');
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();

    supabase.auth.getUser().then(({ data, error: authError }) => {
      if (!isMounted) return;
      // FLAGGED / FIXED -- session 55 (tsc pass): bracket notation.
      // Supabase's real User.app_metadata type is a loose index-signature
      // object, and this project's tsconfig has
      // noPropertyAccessFromIndexSignature enabled, which requires
      // bracket access for index-signature properties. No behavior
      // change -- same runtime value, same admin-role check.
      const role = data.user?.app_metadata?.['role'];
      if (authError || role !== 'admin') {
        setRoleStatus('unauthorized');
      } else {
        setRoleStatus('authorized');
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (roleStatus !== 'authorized') return;
    fetchEvents(0, appliedActionPrefix, appliedActorType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleStatus, appliedActionPrefix, appliedActorType]);

  const handleApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedActionPrefix(actionPrefix);
    setAppliedActorType(actorType);
  };

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
        <h1 className="font-serif text-[22px] leading-none text-foreground">
          Audit log <span className="text-muted-foreground">· All firms</span>
        </h1>
      </header>

      <main className="flex-1 px-8 py-10">
        <div className="mx-auto max-w-3xl">
          {roleStatus === 'checking' ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Checking access…</p>
            </div>
          ) : roleStatus === 'unauthorized' ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-16 text-destructive">
              <ShieldAlert className="h-5 w-5" />
              <p className="text-[13px]">You don't have access to this page.</p>
            </div>
          ) : (
            <>
          <form onSubmit={handleApplyFilters} className="mb-4 flex items-center gap-2">
            <input
              value={actionPrefix}
              onChange={(e) => setActionPrefix(e.target.value)}
              placeholder="Filter by action prefix, e.g. billing."
              className="w-64 rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <select
              value={actorType}
              onChange={(e) => setActorType(e.target.value as ActorType | '')}
              className="rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none"
            >
              {ACTOR_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-2 text-[13px] font-medium text-foreground hover:bg-muted/50"
            >
              Apply
            </button>
          </form>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Loading events…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-16 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">{error}</p>
              <button
                onClick={() => fetchEvents(offset, appliedActionPrefix, appliedActorType)}
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
                        {formatTimestamp(event.created_at)} · {ACTOR_TYPE_LABELS[event.actor_type]}
                        {event.actor_id ? ` (${event.actor_id.slice(0, 8)})` : ''}
                        {event.firm_id ? ` · firm ${event.firm_id.slice(0, 8)}` : ''}
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
                    onClick={() =>
                      fetchEvents(Math.max(0, offset - PAGE_SIZE), appliedActionPrefix, appliedActorType)
                    }
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
                    onClick={() => fetchEvents(offset + PAGE_SIZE, appliedActionPrefix, appliedActorType)}
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