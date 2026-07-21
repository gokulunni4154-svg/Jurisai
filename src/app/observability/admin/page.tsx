// src/app/observability/admin/page.tsx
// JurisAI Observability module — Phase 3

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertCircle, ShieldCheck } from 'lucide-react';

// Same mirrored-shapes convention as src/app/observability/page.tsx and
// src/app/documents/[id]/page.tsx — see that file's own comment for the
// full reasoning.

type ObservabilityModule =
  | 'risk_detection'
  | 'ai_legal_insight'
  | 'ai_recommendation'
  | 'clause_classification'
  | 'compliance_detection'
  | 'legal_health_score'
  | 'missing_clause_detection'
  | 'chat_conversation';

interface ObservabilityRun {
  module: ObservabilityModule;
  id: string;
  documentAnalysisId: string;
  status: string | null;
  providerUsed: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  documentTitle: string | null;
  documentOwnerId: string | null;
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

const MODULE_LABELS: Record<ObservabilityModule, string> = {
  risk_detection: 'Risk Detection',
  ai_legal_insight: 'AI Legal Insight',
  ai_recommendation: 'AI Recommendation',
  clause_classification: 'Clause Classification',
  compliance_detection: 'Compliance Detection',
  legal_health_score: 'Legal Health Score',
  missing_clause_detection: 'Missing Clause Detection',
  chat_conversation: 'AI Legal Chat',
};

function formatTimestamp(isoString: string): string {
  return new Date(isoString).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function StatusPill({ status }: { status: string | null }) {
  if (status === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        Conversation
      </span>
    );
  }

  const styles: Record<string, string> = {
    completed: 'bg-emerald-500/10 text-emerald-600',
    failed: 'bg-destructive/10 text-destructive',
    processing: 'bg-amber-500/10 text-amber-600',
    pending: 'bg-muted text-muted-foreground',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        styles[status] ?? 'bg-muted text-muted-foreground'
      }`}
    >
      {status}
    </span>
  );
}

/**
 * GET /api/observability/admin/runs — admin view, every run across
 * every user/firm, no filter. Role-gated server-side
 * (requireRole('admin'), no override) inside
 * ObservabilityService#getAdminRunHistory — same "no client-side role
 * check" reasoning as the firm-owner page.
 *
 * Shows a documentOwnerId column, unlike the firm-owner page — the
 * admin view's underlying query embeds document owner_id directly
 * (findManyForAdminView's single embedded call), so it's real,
 * available data here in a way it wouldn't add anything for the
 * firm-owner view (every row there already belongs to one known firm).
 * Shown as a raw id, not a resolved name — no user-lookup-by-id
 * endpoint/service has been built or verified this session, so
 * resolving it to a display name would be a guess; the raw id is
 * accurate as-is and still useful for support/debugging lookups.
 */
export default function ObservabilityAdminPage() {
  const [runs, setRuns] = useState<ObservabilityRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/observability/admin/runs', { credentials: 'include' });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      setRuns(json.data as ObservabilityRun[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load run history.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-8 py-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-[15px] font-semibold">Run History — All Firms</h1>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Status, provider, and timing for every AI run across every user and firm.
        </p>
      </header>

      <main className="flex-1 overflow-y-auto px-8 py-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-[13px]">Loading run history…</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="text-[13px]">{loadError}</p>
            <button
              onClick={loadRuns}
              className="text-[13px] font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-24 text-muted-foreground">
            <p className="text-[13px]">No runs yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-muted/50 text-[12px] font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Module</th>
                  <th className="px-4 py-2.5">Document</th>
                  <th className="px-4 py-2.5">Owner</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Provider</th>
                  <th className="px-4 py-2.5">Error</th>
                  <th className="px-4 py-2.5">Started</th>
                  <th className="px-4 py-2.5">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {runs.map((run) => (
                  <tr key={`${run.module}-${run.id}`}>
                    <td className="px-4 py-2.5 whitespace-nowrap">{MODULE_LABELS[run.module]}</td>
                    <td className="px-4 py-2.5">{run.documentTitle ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                      {run.documentOwnerId ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill status={run.status} />
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{run.providerUsed ?? '—'}</td>
                    <td className="px-4 py-2.5 max-w-xs truncate text-destructive">
                      {run.errorMessage ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                      {formatTimestamp(run.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                      {run.completedAt ? formatTimestamp(run.completedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}