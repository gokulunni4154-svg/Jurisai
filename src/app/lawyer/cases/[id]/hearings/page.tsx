// Real path: src/app/cases/[id]/hearings/page.tsx
//
// Standalone page rather than a section folded into
// src/app/cases/[id]/page.tsx -- that file's real content was never
// pasted this session (only described in prior progress notes), so
// editing it directly would violate the Source Verification Rule. This
// mirrors the same non-invasive choice firm-todos-page.tsx made for an
// analogous gap in the Task Management session.
//
// Client component: fetches from /api/cases/[id]/hearings (GET/POST)
// and /api/hearings/[id] (PATCH/DELETE), built this session. No
// picker/lookup UI beyond plain text inputs -- same reasoning as the
// task views: no profile/member-lookup endpoint exists to build a
// richer picker against (not applicable here anyway, since hearings
// have no assignee field).
//
// Delete is always rendered, same posture as the task case-linked
// view: the caller's exact relationship to the case isn't reliably
// knowable client-side here, so the real 403 from
// HearingService#deleteHearing() (case owner / active read_write
// grantee only) is the actual enforcement point, not this UI.
//
// RESOLVED THIS PASS (polish-pass item #7): params was previously
// typed as `Promise<{ id: string }>` and unwrapped via React's `use()`
// -- an unconfirmed guess at the time, flagged as such in this file's
// own prior comment. Two pieces of real evidence now settle it: (1)
// this project's Route Handlers already confirmed next@14.2.35 does
// NOT Promise-wrap dynamic route params server-side (that's a Next 15
// behavior, not applicable here); (2) `src/app/cases/[id]/page.tsx`'s
// real pasted source (case detail page, same project, same Next
// version) reads its own route id via the `useParams<{ id: string
// }>()` client hook from next/navigation instead of receiving `params`
// as a prop at all -- which sidesteps the Promise question by design
// and is the pattern actually proven to work in this project. This
// page now matches that: `useParams()` instead of a `params` prop +
// `use()`. The prior `Promise<{ id: string }>` typing was very likely
// simply wrong for this project's real Next version -- `use()` on a
// plain object would either throw or silently misbehave depending on
// the exact React/Next version, so this was a real, live bug, not
// just a stylistic mismatch.
//
// UPDATED A PRIOR PASS: header shows the case's real title, fetched
// from GET /api/cases/[id] (real, pasted that session -- returns
// `{ data: caseRecord }` via CaseService#getCaseById(), which 404s as
// NotFoundError for a caller with no visibility, same posture this
// page's own hearings calls already rely on). A separate fetch, not
// embedded into the hearings response -- keeps hearing.repository.ts's
// query shape untouched, per the two-options tradeoff discussed before
// building this.

'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type HearingType = 'first_hearing' | 'arguments' | 'evidence' | 'judgment' | 'other';

interface Hearing {
  id: string;
  case_id: string;
  hearing_date: string;
  hearing_type: HearingType;
  court_name: string | null;
  location: string | null;
  notes: string | null;
  outcome: string | null;
  created_at: string;
}

const HEARING_TYPE_LABELS: Record<HearingType, string> = {
  first_hearing: 'First hearing',
  arguments: 'Arguments',
  evidence: 'Evidence',
  judgment: 'Judgment',
  other: 'Other',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Converts an ISO datetime into the local-timezone `yyyy-MM-ddThh:mm`
 * shape a `<input type="datetime-local">` requires as its `value`.
 * `Date#toISOString()` always returns UTC, which would silently shift
 * the displayed time for any user not in UTC -- this builds the string
 * from the Date object's own local getters instead, same reasoning
 * `formatDateTime()` above already gets for free from
 * `toLocaleString()`.
 */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface EditDraft {
  hearingDate: string;
  hearingType: HearingType;
  courtName: string;
  location: string;
  notes: string;
  outcome: string;
}

function draftFromHearing(hearing: Hearing): EditDraft {
  return {
    hearingDate: toDatetimeLocalValue(hearing.hearing_date),
    hearingType: hearing.hearing_type,
    courtName: hearing.court_name ?? '',
    location: hearing.location ?? '',
    notes: hearing.notes ?? '',
    outcome: hearing.outcome ?? '',
  };
}

export default function CaseHearingsPage() {
  // See file header's RESOLVED THIS PASS note: caseId now comes from
  // the useParams() client hook, matching case-detail-page.tsx's real
  // confirmed convention, instead of a Promise-wrapped `params` prop.
  const params = useParams<{ id: string }>();
  const caseId = params.id;

  const [hearings, setHearings] = useState<Hearing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [caseTitle, setCaseTitle] = useState<string | null>(null);
  const [caseTitleError, setCaseTitleError] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [hearingDate, setHearingDate] = useState('');
  const [hearingType, setHearingType] = useState<HearingType>('other');
  const [courtName, setCourtName] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  async function loadHearings() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/hearings`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to load hearings.');
      setHearings(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load hearings.');
    } finally {
      setLoading(false);
    }
  }

  /**
   * NEW THIS PASS. Deliberately isolated from loadHearings()'s own
   * error state -- a failure fetching the case title (e.g. a
   * transient error, or a caller who can somehow reach this page
   * without case visibility, which RLS should already prevent via the
   * hearings query itself) should not block the hearings list from
   * rendering. Falls back to the raw caseId in the header on failure,
   * same "known gap, not blocking" posture as the firm to-dos page's
   * raw-firmId fallback from the Task Management session.
   */
  async function loadCaseTitle() {
    try {
      const res = await fetch(`/api/cases/${caseId}`);
      const json = await res.json();
      if (!res.ok) throw new Error();
      setCaseTitle(json.data.title);
    } catch {
      setCaseTitleError(true);
    }
  }

  useEffect(() => {
    loadHearings();
    loadCaseTitle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!hearingDate) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/hearings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hearingDate: new Date(hearingDate).toISOString(),
          hearingType,
          courtName: courtName || null,
          location: location || null,
          notes: notes || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to create hearing.');
      setHearingDate('');
      setHearingType('other');
      setCourtName('');
      setLocation('');
      setNotes('');
      setShowForm(false);
      await loadHearings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create hearing.');
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Saves every editable field at once (hearingDate, hearingType,
   * courtName, location, notes, outcome) -- replaces the prior
   * outcome-only handler. `updateHearingInputSchema` (hearing.schemas.ts)
   * already accepts all six fields; this was previously only exercised
   * for `outcome` because no UI sent the rest. Empty-string fields are
   * sent as `null`, matching the create form's own "empty means unset"
   * convention rather than persisting empty strings.
   */
  async function handleSaveEdit(hearingId: string) {
    if (!editDraft) return;
    setSavingEdit(true);
    setError(null);
    try {
      const res = await fetch(`/api/hearings/${hearingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hearingDate: new Date(editDraft.hearingDate).toISOString(),
          hearingType: editDraft.hearingType,
          courtName: editDraft.courtName || null,
          location: editDraft.location || null,
          notes: editDraft.notes || null,
          outcome: editDraft.outcome || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to save hearing.');
      setEditingId(null);
      setEditDraft(null);
      await loadHearings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save hearing.');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(hearingId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/hearings/${hearingId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? 'Failed to delete hearing.');
      }
      await loadHearings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete hearing.');
    }
  }

  const now = Date.now();
  const upcoming = hearings.filter((h) => new Date(h.hearing_date).getTime() >= now);
  const past = hearings.filter((h) => new Date(h.hearing_date).getTime() < now);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {caseTitleError ? `Case ${caseId}` : caseTitle ?? 'Loading case…'}
          </p>
          <h1 className="text-xl font-semibold text-slate-900">Hearings</h1>
          <p className="mt-1 text-sm text-slate-500">Hearing dates and listings for this case.</p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {showForm ? 'Cancel' : 'Add hearing'}
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-8 space-y-4 rounded-lg border border-slate-200 bg-white p-5"
        >
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Date &amp; time</span>
              <input
                type="datetime-local"
                required
                value={hearingDate}
                onChange={(e) => setHearingDate(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Type</span>
              <select
                value={hearingType}
                onChange={(e) => setHearingType(e.target.value as HearingType)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {Object.entries(HEARING_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Court name</span>
              <input
                type="text"
                value={courtName}
                onChange={(e) => setCourtName(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Location</span>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save hearing'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : hearings.length === 0 ? (
        <p className="text-sm text-slate-500">No hearings recorded for this case yet.</p>
      ) : (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Upcoming
              </h2>
              <ul className="space-y-3">
                {upcoming.map((h) => (
                  <HearingRow
                    key={h.id}
                    hearing={h}
                    editing={editingId === h.id}
                    draft={editDraft}
                    saving={savingEdit}
                    onEditStart={() => {
                      setEditingId(h.id);
                      setEditDraft(draftFromHearing(h));
                    }}
                    onDraftChange={setEditDraft}
                    onSave={() => handleSaveEdit(h.id)}
                    onCancel={() => {
                      setEditingId(null);
                      setEditDraft(null);
                    }}
                    onDelete={() => handleDelete(h.id)}
                  />
                ))}
              </ul>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Past
              </h2>
              <ul className="space-y-3">
                {past.map((h) => (
                  <HearingRow
                    key={h.id}
                    hearing={h}
                    editing={editingId === h.id}
                    draft={editDraft}
                    saving={savingEdit}
                    onEditStart={() => {
                      setEditingId(h.id);
                      setEditDraft(draftFromHearing(h));
                    }}
                    onDraftChange={setEditDraft}
                    onSave={() => handleSaveEdit(h.id)}
                    onCancel={() => {
                      setEditingId(null);
                      setEditDraft(null);
                    }}
                    onDelete={() => handleDelete(h.id)}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * NEW THIS PASS: replaces the prior outcome-only edit box with a full
 * edit form covering every field `updateHearingInputSchema` accepts
 * (hearingDate, hearingType, courtName, location, notes, outcome) --
 * see the file header for why this was previously narrower than the
 * schema actually supports. `draft` is `null` whenever `editing` is
 * false for this row (only one row is ever mid-edit at a time, per the
 * parent's single `editingId`/`editDraft` state) -- the `editing &&
 * draft` guard below is what TypeScript needs to narrow past that.
 */
function HearingRow({
  hearing,
  editing,
  draft,
  saving,
  onEditStart,
  onDraftChange,
  onSave,
  onCancel,
  onDelete,
}: {
  hearing: Hearing;
  editing: boolean;
  draft: EditDraft | null;
  saving: boolean;
  onEditStart: () => void;
  onDraftChange: (d: EditDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  if (editing && draft) {
    return (
      <li className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Date &amp; time</span>
              <input
                type="datetime-local"
                value={draft.hearingDate}
                onChange={(e) => onDraftChange({ ...draft, hearingDate: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Type</span>
              <select
                value={draft.hearingType}
                onChange={(e) =>
                  onDraftChange({ ...draft, hearingType: e.target.value as HearingType })
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {Object.entries(HEARING_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Court name</span>
              <input
                type="text"
                value={draft.courtName}
                onChange={(e) => onDraftChange({ ...draft, courtName: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Location</span>
              <input
                type="text"
                value={draft.location}
                onChange={(e) => onDraftChange({ ...draft, location: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Notes</span>
            <textarea
              value={draft.notes}
              onChange={(e) => onDraftChange({ ...draft, notes: e.target.value })}
              rows={2}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Outcome</span>
            <textarea
              value={draft.outcome}
              onChange={(e) => onDraftChange({ ...draft, outcome: e.target.value })}
              rows={2}
              placeholder="Outcome / notes from this hearing"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onCancel}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-900">{formatDateTime(hearing.hearing_date)}</p>
          <p className="mt-0.5 text-xs text-slate-500">{HEARING_TYPE_LABELS[hearing.hearing_type]}</p>
          {(hearing.court_name || hearing.location) && (
            <p className="mt-1 text-xs text-slate-500">
              {[hearing.court_name, hearing.location].filter(Boolean).join(' · ')}
            </p>
          )}
          {hearing.notes && <p className="mt-2 text-sm text-slate-600">{hearing.notes}</p>}
        </div>
        <div className="flex shrink-0 gap-3">
          <button onClick={onEditStart} className="text-xs font-medium text-slate-500 hover:text-slate-700">
            Edit
          </button>
          <button onClick={onDelete} className="text-xs font-medium text-red-600 hover:text-red-700">
            Delete
          </button>
        </div>
      </div>

      {hearing.outcome && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-sm text-slate-700">
            <span className="font-medium text-slate-500">Outcome: </span>
            {hearing.outcome}
          </p>
        </div>
      )}
    </li>
  );
}