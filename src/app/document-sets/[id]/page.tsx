// src/app/document-sets/[id]/page.tsx
// Multi-document module. Built directly against real, pasted source for
// every API call below -- same audit-log/admin/page.tsx conventions as
// document-sets/page.tsx before it ('use client', useCallback/useEffect
// fetch pattern, extractErrorMessage() reused verbatim, loading/error/
// empty states, Tailwind classes, back-button pattern).
//
// SOURCE-VERIFIED AGAINST, THIS SESSION:
//   - GET /api/document-sets/[id] -> { data: DocumentSetRow } at 200.
//   - GET /api/document-sets/[id]/members -> { data: DocumentRow[] } at
//     200 -- FULL document rows (DocumentSetRepository#findMemberDocuments
//     embeds the real `documents` row via Postgrest, not just ids).
//   - POST /api/document-sets/[id]/members, body { documentId } -> 204
//     No Content (no response body).
//   - DELETE /api/document-sets/[id]/members/[documentId] -> 204 No
//     Content.
//   - GET /api/document-sets/[id]/analyses -> { data: DocumentSetAnalysis[] }
//     at 200, most recent first (DocumentSetAnalysisRepository#findByDocumentSetId
//     orders by created_at desc).
//   - POST /api/document-sets/[id]/analyses -> { data: DocumentSetAnalysis }
//     at 201. CONFIRMED SYNCHRONOUS: the route does createSetAnalysis()
//     then inline-awaits runSetAnalysis() before responding (File 67's
//     inline-await convention, Next.js 14.2.15 has neither waitUntil()
//     nor after() in Route Handlers) -- so there is no polling here, the
//     completed (or failed) result comes back directly from this one
//     call. maxDuration=60 on the route, so the button below just needs a
//     loading state for up to that long.
//     ALSO CONFIRMED: this route does its own readiness check (each
//     member needs a completed document-analysis, not just set
//     membership) BEFORE creating a 'pending' row, throwing
//     ValidationError if fewer than 2 members are ready -- surfaced here
//     as an ordinary fetch error, not a special case.
//   - DocumentSetAnalysis real fields (document-set-analysis.repository.ts):
//     id, document_set_id, status ('pending'|'processing'|'completed'|'failed'),
//     result (DocumentSetAnalysisResult | null), provider_used
//     ('openai'|'gemini'|null), error_message (string|null), completed_at
//     (string|null), created_at.
//   - DocumentSetAnalysisResult real fields (document-set-analysis.schemas.ts):
//     setOverview (string), keyThemes (string[]), crossDocumentInsights
//     (array of { title, narrative, sourceDocumentIds[], sourceDocumentTitles[] }),
//     recommendedActions (string[]).
//   - GET /api/document-sets/[id]/analyses/[analysisId] -> { data: DocumentSetAnalysis }
//     at 200. NOT called by this page -- listSetAnalyses() already returns
//     full rows including `result`, so there is nothing this single-fetch
//     route would add for a page that already has the list. Left
//     available for a future deep-link-to-one-run feature, not used here.
//
// ADD-MEMBER PICKER: built against the real, earlier-confirmed
// GET /api/documents (File 50/route.ts, this session) -- { data: {
// documents, total, limit, offset } }. Fetches one page of up to 100 of
// the caller's own documents (RLS-scoped, same as everywhere else) and
// filters out ids already in this set, client-side. FLAGGED: no real
// pagination UI for the picker itself -- if a user has more than 100
// documents this list will not show all of them. No precedent exists
// yet for a searchable/paginated document picker; revisit if this
// becomes a real limitation.
//
// SYNTHESIS RESULT RENDERING: setOverview, keyThemes, crossDocumentInsights,
// recommendedActions are rendered directly from real schema fields --
// nothing here is invented; a 'failed' run shows error_message instead.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  FileText,
  Layers,
  Loader2,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';

// Real columns confirmed via 20260801000000_create_document_sets_tables.sql.
interface DocumentSetRow {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

// Partial projection of the real `documents` row -- only the fields this
// page actually renders (title, mime_type). Full row has more columns
// (storage_path, size_bytes, hearing_date, deleted_at, etc.) confirmed
// elsewhere this session but not needed here.
interface DocumentRow {
  id: string;
  title: string;
  mime_type: string;
}

type DocumentSetAnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface CrossDocumentInsight {
  title: string;
  narrative: string;
  sourceDocumentIds: string[];
  sourceDocumentTitles: string[];
}

interface DocumentSetAnalysisResult {
  setOverview: string;
  keyThemes: string[];
  crossDocumentInsights: CrossDocumentInsight[];
  recommendedActions: string[];
}

interface DocumentSetAnalysis {
  id: string;
  document_set_id: string;
  status: DocumentSetAnalysisStatus;
  result: DocumentSetAnalysisResult | null;
  provider_used: 'openai' | 'gemini' | null;
  error_message: string | null;
  completed_at: string | null;
  created_at: string;
}

// Reused verbatim from audit-log/admin/page.tsx and document-sets/page.tsx.
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

const STATUS_LABELS: Record<DocumentSetAnalysisStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
};

export default function DocumentSetDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const documentSetId = params.id;

  const [set, setSet] = useState<DocumentSetRow | null>(null);
  const [members, setMembers] = useState<DocumentRow[]>([]);
  const [analyses, setAnalyses] = useState<DocumentSetAnalysis[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showPicker, setShowPicker] = useState(false);
  const [availableDocs, setAvailableDocs] = useState<DocumentRow[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [setRes, membersRes, analysesRes] = await Promise.all([
        fetch(`/api/document-sets/${documentSetId}`, { credentials: 'include' }),
        fetch(`/api/document-sets/${documentSetId}/members`, { credentials: 'include' }),
        fetch(`/api/document-sets/${documentSetId}/analyses`, { credentials: 'include' }),
      ]);

      if (!setRes.ok) throw new Error(await extractErrorMessage(setRes));
      if (!membersRes.ok) throw new Error(await extractErrorMessage(membersRes));
      if (!analysesRes.ok) throw new Error(await extractErrorMessage(analysesRes));

      const setJson: { data: DocumentSetRow } = await setRes.json();
      const membersJson: { data: DocumentRow[] } = await membersRes.json();
      const analysesJson: { data: DocumentSetAnalysis[] } = await analysesRes.json();

      setSet(setJson.data);
      setMembers(membersJson.data);
      setAnalyses(analysesJson.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this document set.');
    } finally {
      setIsLoading(false);
    }
  }, [documentSetId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const openPicker = async () => {
    setShowPicker(true);
    setPickerLoading(true);
    setPickerError(null);
    try {
      const res = await fetch('/api/documents?limit=100&offset=0', { credentials: 'include' });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json: { data: { documents: DocumentRow[] } } = await res.json();
      const memberIds = new Set(members.map((m) => m.id));
      setAvailableDocs(json.data.documents.filter((d) => !memberIds.has(d.id)));
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : 'Could not load your documents.');
    } finally {
      setPickerLoading(false);
    }
  };

  const handleAddMember = async (documentId: string) => {
    setAddingId(documentId);
    setPickerError(null);
    try {
      const res = await fetch(`/api/document-sets/${documentSetId}/members`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      setAvailableDocs((prev) => prev.filter((d) => d.id !== documentId));
      await fetchAll();
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : 'Could not add this document.');
    } finally {
      setAddingId(null);
    }
  };

  const handleRemoveMember = async (documentId: string) => {
    setRemovingId(documentId);
    setError(null);
    try {
      const res = await fetch(`/api/document-sets/${documentSetId}/members/${documentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      setMembers((prev) => prev.filter((m) => m.id !== documentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this document.');
    } finally {
      setRemovingId(null);
    }
  };

  const handleRunSynthesis = async () => {
    setIsRunning(true);
    setRunError(null);
    try {
      const res = await fetch(`/api/document-sets/${documentSetId}/analyses`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json: { data: DocumentSetAnalysis } = await res.json();
      setAnalyses((prev) => [json.data, ...prev]);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Could not run synthesis.');
    } finally {
      setIsRunning(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-background text-destructive">
        <AlertCircle className="h-5 w-5" />
        <p className="text-[13px]">{error}</p>
        <button onClick={() => fetchAll()} className="text-[13px] font-medium underline underline-offset-2">
          Try again
        </button>
      </div>
    );
  }

  if (!set) return null;

  return (
    <div className="flex min-h-screen w-full flex-col bg-background font-sans text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-8 py-6">
        <button
          onClick={() => router.push('/document-sets')}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50"
          aria-label="Back to document sets"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" strokeWidth={1.5} />
          <h1 className="font-serif text-[22px] leading-none text-foreground">{set.name}</h1>
        </div>
      </header>

      <main className="flex-1 px-8 py-10">
        <div className="mx-auto flex max-w-3xl flex-col gap-10">
          {/* Members */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-medium text-foreground">
                Documents <span className="text-muted-foreground">({members.length})</span>
              </h2>
              <button
                onClick={openPicker}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted/50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add document
              </button>
            </div>

            {members.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-10 text-muted-foreground">
                <FileText className="h-5 w-5" />
                <p className="text-[13px]">No documents in this set yet.</p>
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
                {members.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                    <p className="min-w-0 flex-1 truncate text-[13px] text-foreground">{doc.title}</p>
                    <button
                      onClick={() => handleRemoveMember(doc.id)}
                      disabled={removingId === doc.id}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted/50 hover:text-destructive disabled:opacity-40"
                      aria-label={`Remove ${doc.title}`}
                    >
                      {removingId === doc.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {showPicker && (
              <div className="mt-3 rounded-lg border border-border bg-card p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[13px] font-medium text-foreground">Add a document</p>
                  <button
                    onClick={() => setShowPicker(false)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Close"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {pickerLoading ? (
                  <div className="flex items-center justify-center py-6 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : pickerError ? (
                  <p className="text-[13px] text-destructive">{pickerError}</p>
                ) : availableDocs.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    No other documents available to add.
                  </p>
                ) : (
                  <div className="flex max-h-64 flex-col divide-y divide-border overflow-y-auto">
                    {availableDocs.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-3 py-2">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                        <p className="min-w-0 flex-1 truncate text-[13px] text-foreground">{doc.title}</p>
                        <button
                          onClick={() => handleAddMember(doc.id)}
                          disabled={addingId === doc.id}
                          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] font-medium text-foreground hover:bg-muted/50 disabled:opacity-40"
                        >
                          {addingId === doc.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Synthesis */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-medium text-foreground">Combined synthesis</h2>
              <button
                onClick={handleRunSynthesis}
                disabled={isRunning || members.length < 2}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted/50 disabled:opacity-40"
              >
                {isRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {isRunning ? 'Running synthesis…' : 'Run synthesis'}
              </button>
            </div>

            {members.length < 2 && (
              <p className="mb-3 text-[13px] text-muted-foreground">
                Add at least 2 documents before running a combined synthesis.
              </p>
            )}

            {runError && (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {runError}
              </div>
            )}

            {analyses.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-10 text-muted-foreground">
                <Sparkles className="h-5 w-5" />
                <p className="text-[13px]">No synthesis runs yet.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {analyses.map((run) => (
                  <div key={run.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          run.status === 'completed'
                            ? 'bg-primary/10 text-primary'
                            : run.status === 'failed'
                              ? 'bg-destructive/10 text-destructive'
                              : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {STATUS_LABELS[run.status]}
                      </span>
                      <span className="text-[12px] text-muted-foreground">
                        {formatTimestamp(run.created_at)}
                      </span>
                    </div>

                    {run.status === 'failed' && run.error_message && (
                      <p className="text-[13px] text-destructive">{run.error_message}</p>
                    )}

                    {run.status === 'completed' && run.result && (
                      <div className="flex flex-col gap-4">
                        <p className="text-[13px] leading-relaxed text-foreground">
                          {run.result.setOverview}
                        </p>

                        {run.result.keyThemes.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {run.result.keyThemes.map((theme, i) => (
                              <span
                                key={i}
                                className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                              >
                                {theme}
                              </span>
                            ))}
                          </div>
                        )}

                        {run.result.crossDocumentInsights.length > 0 && (
                          <div className="flex flex-col gap-2">
                            <p className="text-[12px] font-medium text-muted-foreground">
                              Cross-document insights
                            </p>
                            {run.result.crossDocumentInsights.map((insight, i) => (
                              <div key={i} className="rounded-md border border-border p-3">
                                <p className="text-[13px] font-medium text-foreground">{insight.title}</p>
                                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                                  {insight.narrative}
                                </p>
                                <p className="mt-1.5 text-[11px] text-muted-foreground">
                                  {insight.sourceDocumentTitles.join(', ')}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        {run.result.recommendedActions.length > 0 && (
                          <div className="flex flex-col gap-1">
                            <p className="text-[12px] font-medium text-muted-foreground">
                              Recommended actions
                            </p>
                            <ul className="list-disc pl-4 text-[13px] text-foreground">
                              {run.result.recommendedActions.map((action, i) => (
                                <li key={i}>{action}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}