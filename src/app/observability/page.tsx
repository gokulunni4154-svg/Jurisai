// src/app/observability/page.tsx
// JurisAI Observability module — Phase 3

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertCircle, Activity } from 'lucide-react';

// ---- Shapes, mirrored from ObservabilityService/ObservabilityRun ----
// Same convention as src/app/documents/[id]/page.tsx's own "Shapes,
// source-verified against the entities/schemas listed above" section —
// this page does not (and should not) import server-only Service types
// directly; these are a local, deliberately-narrowed mirror of
// ObservabilityRun (observability.service.ts), containing only the
// fields this page actually renders.

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

// Same local-helper convention as src/app/documents/[id]/page.tsx's own
// extractErrorMessage — not imported from a shared util, since no such
// shared util was found in what's been verified this session; each page
// in this project defines its own copy.
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

/**
 * Status pill. FLAGGED: chat_conversation rows always have `status:
 * null` — not because data is missing, but because chat_conversations
 * genuinely has no status column (confirmed against the real
 * database.types.ts and reflected in ObservabilityService's own doc
 * comments). Rendered here as a distinct neutral "Conversation" pill,
 * never as a blank/missing value, so it reads as "this module doesn't
 * have a status" rather than "we failed to load this run's status".
 */
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
 * GET /api/observability/runs — firm-owner view. Role-gated server-side
 * (requireRole('law_firm', 'admin') inside ObservabilityService); this
 * page has no client-side role check of its own, same "authorization
 * lives in the Service layer, not the frontend/route" division of
 * responsibility already established throughout this project. A caller
 * without the right role reaching this page will simply see loadError
 * populated from the 403 AuthorizationError handleApiError translates
 * server-side.
 */
export default function ObservabilityFirmPage() {
  const [runs, setRuns] = useState<ObservabilityRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/observability/runs', { credentials: 'include' });
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
          <Activity className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-[15px] font-semibold">Run History</h1>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Status, provider, and timing for every AI run across your firm&apos;s documents.
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
            <p className="text-[13px]">No runs yet for your firm&apos;s documents.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-muted/50 text-[12px] font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Module</th>
                  <th className="px-4 py-2.5">Document</th>
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