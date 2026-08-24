// Real path (best guess, matching this project's app-router convention
// confirmed via src/app/cases/[id]/timeline/page.tsx and
// src/app/hearings/upcoming/page.tsx, both real, pasted source):
// src/app/cases/[id]/notes/page.tsx
//
// NEW PAGE, THIS SESSION. Internal Notes and Comments frontend --
// consumes GET/POST /api/cases/${id}/notes and PATCH/DELETE
// /api/notes/${id} (real, this session's own backend, source-verified
// against task.service.ts/case.service.ts precedent, RLS confirmed
// against the real case_access_grants migration).
//
// STYLING: deliberately matches the real, pasted case-timeline page.tsx
// exactly (slate palette, rounded-md borders, en-IN locale formatting,
// same button shapes) -- same "consistency over novelty" reasoning that
// file's own header gives, reused verbatim here rather than
// re-justified.
//
// DATA FETCH:
//   1. GET /api/cases/${id} -- case-title lookup, copied verbatim from
//      the real timeline page's own pattern (swallowed-failure,
//      fallback to raw id).
//   2. GET /api/cases/${id}/notes -- returns { data: CaseNoteRow[] }.
//      No pagination param -- CaseNoteService#listNotesForCase() (real,
//      this session's own source) takes no limit/offset, unlike the
//      timeline's paginated read, so there is no "Load more" UI here.
//
// VISIBILITY HANDLING, NEW THIS SESSION (the timeline page has no
// equivalent case to handle): case-note.service.ts's requireNoteAccess()
// deliberately excludes read-only grantees entirely (see that file's
// own header) -- a read-only grantee's GET will 403. Handled with a
// dedicated message distinct from the generic error banner, rather than
// showing a raw "You do not have permission..." string, since this is
// an expected, not-broken state for that audience.
//
// ACTOR NAME RESOLUTION: reuses the real timeline page's exact
// technique verbatim -- GET /api/profiles/${id}/display-name, batched
// per distinct author_id, failures swallowed per-id, falls back to
// "User <shortId>".
//
// FLAGGED, REAL GAP FOUND WHILE BUILDING THIS FILE: no page in this
// project (including the real, pasted timeline page used as this
// file's own precedent) fetches or exposes the CURRENT user's own id
// client-side -- there is no confirmed "/api/profiles/me"-style route
// anywhere in pasted source. Rather than invent one, this page renders
// Edit/Delete controls on EVERY note and lets the real server-side
// authorization (case-note.service.ts's updateNote()/deleteNote(),
// author-only / author-or-case-owner respectively) be the actual
// enforcement point -- a non-author's edit/delete attempt is rejected
// with a clean 403 surfaced via the same error-banner pattern used
// elsewhere on this page, not silently hidden. Correct behavior either
// way; not ideal UX (a non-author sees controls that will fail) until a
// real current-user mechanism is confirmed and this can be tightened to
// only show controls on the caller's own notes.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Trash2 } from 'lucide-react';

interface CaseNote {
  id: string;
  case_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

export default function CaseNotesPage({ params }: { params: { id: string } }) {
  const caseId = params.id;

  const [caseTitle, setCaseTitle] = useState<string | null>(null);
  const [notes, setNotes] = useState<CaseNote[]>([]);
  const [authorNames, setAuthorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  // Case title -- same swallowed-failure fallback posture as the real
  // timeline page's own case-title lookup.
  useEffect(() => {
    let cancelled = false;
    async function loadCase() {
      try {
        const res = await fetch(`/api/cases/${caseId}`);
        const json = await res.json();
        if (!res.ok || cancelled) return;
        setCaseTitle(json.data.title as string);
      } catch {
        // Swallowed -- falls back to raw caseId in the header below.
      }
    }
    loadCase();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  /**
   * Fetches the display name for every DISTINCT author_id in `items`
   * not already resolved. Same technique as the real timeline page's
   * resolveActorNames() -- one request per distinct id, failures
   * swallowed per-id.
   */
  const resolveAuthorNames = useCallback(
    async (items: CaseNote[]) => {
      const distinctIds = Array.from(new Set(items.map((n) => n.author_id))).filter(
        (id) => !(id in authorNames),
      );

      if (distinctIds.length === 0) return;

      const entries = await Promise.all(
        distinctIds.map(async (id): Promise<[string, string] | null> => {
          try {
            const res = await fetch(`/api/profiles/${id}/display-name`);
            const json = await res.json();
            if (!res.ok) return null;
            const name = json?.data?.full_name;
            return typeof name === 'string' && name ? [id, name] : null;
          } catch {
            return null;
          }
        }),
      );

      const resolved = Object.fromEntries(entries.filter((e): e is [string, string] => e !== null));
      if (Object.keys(resolved).length > 0) {
        setAuthorNames((prev) => ({ ...prev, ...resolved }));
      }
    },
    [authorNames],
  );

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);

    try {
      const res = await fetch(`/api/cases/${caseId}/notes`);

      if (res.status === 403) {
        setForbidden(true);
        return;
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to load notes.');

      const items: CaseNote[] = json.data;
      setNotes(items);
      await resolveAuthorNames(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notes.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveAuthorNames intentionally excluded, same reasoning as the timeline page's identical exclusion.
  }, [caseId]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  async function handlePost() {
    if (!draft.trim()) return;

    setPosting(true);
    setRowError(null);

    try {
      const res = await fetch(`/api/cases/${caseId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to post note.');

      const created: CaseNote = json.data;
      setNotes((prev) => [created, ...prev]);
      await resolveAuthorNames([created]);
      setDraft('');
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Failed to post note.');
    } finally {
      setPosting(false);
    }
  }

  function startEdit(note: CaseNote) {
    setEditingId(note.id);
    setEditDraft(note.content);
    setRowError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft('');
  }

  async function handleSaveEdit(noteId: string) {
    if (!editDraft.trim()) return;

    setSavingEditId(noteId);
    setRowError(null);

    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editDraft.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to update note.');

      const updated: CaseNote = json.data;
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
      setEditingId(null);
      setEditDraft('');
    } catch (err) {
      // Left inline on the row being edited, not as a page-level error,
      // since this is scoped to one note's action -- e.g. the FLAGGED
      // non-author-attempts-edit case from this file's own header
      // surfaces here as a clean message rather than a crash.
      setRowError(err instanceof Error ? err.message : 'Failed to update note.');
    } finally {
      setSavingEditId(null);
    }
  }

  async function handleDelete(noteId: string) {
    setDeletingId(noteId);
    setRowError(null);

    try {
      const res = await fetch(`/api/notes/${noteId}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? 'Failed to delete note.');
      }
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Failed to delete note.');
    } finally {
      setDeletingId(null);
    }
  }

  const headerTitle = caseTitle ?? `Case ${shortId(caseId)}`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {headerTitle}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Internal notes</h1>
        <p className="mt-1 text-sm text-slate-500">
          Visible only to firm staff with edit access on this case -- not shown to read-only
          clients.
        </p>
      </div>

      {loading ? (
        <div className="mt-10 flex items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : forbidden ? (
        <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Internal notes are only visible to the case owner or firm staff with edit access on
          this case.
        </div>
      ) : (
        <>
          {error && (
            <div className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mt-6 rounded-md border border-slate-300 bg-white p-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add an internal note…"
              rows={3}
              maxLength={10000}
              className="w-full resize-none text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={handlePost}
                disabled={posting || !draft.trim()}
                className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {posting ? 'Posting…' : 'Post note'}
              </button>
            </div>
          </div>

          {rowError && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {rowError}
            </div>
          )}

          {notes.length === 0 && !error ? (
            <p className="mt-8 text-sm text-slate-500">No internal notes yet.</p>
          ) : (
            <ul className="mt-6 space-y-3">
              {notes.map((note) => {
                const authorLabel = authorNames[note.author_id] ?? `User ${shortId(note.author_id)}`;
                const isEditing = editingId === note.id;

                return (
                  <li
                    key={note.id}
                    className="rounded-md border border-slate-200 bg-white px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs text-slate-500">
                        {authorLabel} · {formatTimestamp(note.created_at)}
                        {note.updated_at !== note.created_at && ' · edited'}
                      </p>

                      {!isEditing && (
                        <div className="flex shrink-0 gap-2">
                          <button
                            onClick={() => startEdit(note)}
                            className="text-slate-400 hover:text-slate-600"
                            aria-label="Edit note"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(note.id)}
                            disabled={deletingId === note.id}
                            className="text-slate-400 hover:text-red-600 disabled:opacity-50"
                            aria-label="Delete note"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="mt-2">
                        <textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          rows={3}
                          maxLength={10000}
                          className="w-full resize-none rounded-md border border-slate-300 p-2 text-sm text-slate-900 focus:outline-none"
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            onClick={cancelEdit}
                            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSaveEdit(note.id)}
                            disabled={savingEditId === note.id || !editDraft.trim()}
                            className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            {savingEditId === note.id ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-900">
                        {note.content}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}