// src/app/document-sets/page.tsx
// Multi-document module. Built directly against the real, pasted
// audit-log/admin/page.tsx for the 'use client' + useCallback/useEffect
// fetch pattern, extractErrorMessage() reused verbatim, loading/error/
// empty states, Tailwind classes, and back-button ArrowLeft-to-/documents
// pattern.
//
// SOURCE-VERIFIED AGAINST, THIS SESSION:
//   - GET /api/document-sets: no params, returns `{ data: DocumentSetRow[] }`
//     at 200 -- a PLAIN ARRAY, not the { documents, total, limit, offset }
//     shape /api/documents' own list route uses. Confirmed via the real,
//     pasted document-set.service.ts (listDocumentSets() returns
//     DocumentSetRow[] directly, a plain findManyForOwner() with no
//     pagination args) and route.ts (`const data = await
//     documentSetService.listDocumentSets(); return NextResponse.json({ data })`).
//     Deliberately NOT building audit-log's offset/limit/Previous/Next UI
//     here -- there is nothing on the real API to page through yet.
//   - POST /api/document-sets: body is `{ name: string }`, validated
//     inline server-side (not Zod -- route.ts's own flagged gap; no
//     document-sets.schemas.ts request-validation file exists yet this
//     session). Returns `{ data: DocumentSetRow }` at 201.
//   - DocumentSetRow's real columns, confirmed via
//     20260801000000_create_document_sets_tables.sql: id, owner_id, name,
//     created_at, updated_at. No member count is returned by
//     listDocumentSets() (a plain read over document_sets alone, no join
//     to document_set_members) -- so member counts are NOT shown in this
//     list. Faking one with a placeholder "0" would be worse than
//     omitting it; flagged as a real gap instead, closeable later with a
//     dedicated count query if wanted.
//
// NO ROLE CHECK: unlike audit-log/admin, this is a normal owner-scoped
// page (document_sets_select_own RLS policy), not an admin-only view --
// the UX-only client-side role-check pattern audit-log/admin/page.tsx
// introduced doesn't apply here. A 401/403 from the API is surfaced as
// an ordinary fetch error, same as any other module's non-admin page.
//
// Clicking a set, or successfully creating one, navigates to
// /document-sets/[id] -- that page (members, trigger synthesis, view
// results) is the next file in this module's frontend, not yet built.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, FolderPlus, ArrowLeft, Layers, Loader2, Plus } from 'lucide-react';

// Real columns confirmed via 20260801000000_create_document_sets_tables.sql,
// pasted this session.
interface DocumentSetRow {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface GetDocumentSetsResponse {
  data: DocumentSetRow[];
}

interface CreateDocumentSetResponse {
  data: DocumentSetRow;
}

// Reused verbatim from audit-log/admin/page.tsx.
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

export default function DocumentSetsPage() {
  const router = useRouter();

  const [sets, setSets] = useState<DocumentSetRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchSets = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/document-sets', { credentials: 'include' });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json: GetDocumentSetsResponse = await res.json();
      setSets(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load document sets.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSets();
  }, [fetchSets]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;

    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/document-sets', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json: CreateDocumentSetResponse = await res.json();
      setNewName('');
      // Straight into the new set's detail page -- adding members is the
      // natural next step, and that lives there, not here.
      router.push(`/document-sets/${json.data.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create the document set.');
    } finally {
      setIsCreating(false);
    }
  };

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
        <h1 className="font-serif text-[22px] leading-none text-foreground">Document sets</h1>
      </header>

      <main className="flex-1 px-8 py-10">
        <div className="mx-auto max-w-3xl">
          <form onSubmit={handleCreate} className="mb-6 flex items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New set name, e.g. Smith v. Acme — discovery docs"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="submit"
              disabled={isCreating || !newName.trim()}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[13px] font-medium text-foreground hover:bg-muted/50 disabled:opacity-40"
            >
              {isCreating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Create set
            </button>
          </form>

          {createError && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {createError}
            </div>
          )}

          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Loading document sets…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-16 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">{error}</p>
              <button
                onClick={() => fetchSets()}
                className="text-[13px] font-medium underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          ) : sets.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-muted-foreground">
              <FolderPlus className="h-6 w-6" />
              <p className="text-[13px]">No document sets yet. Create one above to get started.</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
              {sets.map((set) => (
                <button
                  key={set.id}
                  onClick={() => router.push(`/document-sets/${set.id}`)}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-muted/30"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <Layers className="h-4 w-4 text-primary" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-foreground">{set.name}</p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      Created {formatTimestamp(set.created_at)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}