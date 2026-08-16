// Real path: FLAGGED, UNVERIFIED (same posture as every sibling firm
// page) -- src/app/(dashboard)/firm/[firmId]/clients/[clientId]/page.tsx
//
// NEW PAGE, THIS SESSION -- Firm Terminal client detail. Sibling of
// clients/page.tsx (real, this same change) -- see that file's own
// header for the full "existing backend, missing UI only" framing.
//
// Consumes GET/PATCH /api/firms/[id]/clients/[clientId] (real, pasted
// this session) -- both already fully authorized via
// ClientService#getClient()/#updateClient()'s own
// requireFirmRole(['owner','admin']) calls, scoped off the client
// row's own firm_id (see that route file's own FLAGGED note on the
// [id] path segment being decorative -- not re-litigated here).
//
// STYLING: matches clients/page.tsx and firm-settings/page.tsx's
// "rename" form exactly -- slate palette, rounded-md borders,
// max-w-3xl container, same loading/forbidden/error markup, same
// inline-edit-form posture (no separate "edit mode" toggle needed --
// the form is always editable, mirroring firm-settings' rename form
// which has no view/edit toggle either).
//
// FIELDS: full_name, email, phone (nullable) are editable, matching
// UpdateClientInput's exact shape (client.service.ts, real, pasted).
// created_at/updated_at are shown read-only. profile_id is
// deliberately NOT editable here -- same reasoning updateClient()'s
// own doc comment gives (exclusively managed by the client-invitation
// accept flow, not this form) -- but IS shown read-only as a small
// "portal access: linked / not yet linked" indicator, since it's a
// real column or the caller has no way to know status otherwise.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';

interface ClientRow {
  id: string;
  firm_id: string;
  profile_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
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

export default function FirmClientDetailPage({
  params,
}: {
  params: { firmId: string; clientId: string };
}) {
  const { firmId, clientId } = params;

  const [client, setClient] = useState<ClientRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    setNotFound(false);

    try {
      const res = await fetch(`/api/firms/${firmId}/clients/${clientId}`);

      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (res.status === 404) {
        setNotFound(true);
        return;
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to load client.');

      const data = json.data as ClientRow;
      setClient(data);
      setFullName(data.full_name);
      setEmail(data.email);
      setPhone(data.phone ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load client.');
    } finally {
      setLoading(false);
    }
  }, [firmId, clientId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);

    try {
      const res = await fetch(`/api/firms/${firmId}/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          phone: phone.trim().length > 0 ? phone.trim() : null,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to save client.');

      setClient(json.data as ClientRow);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save client.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div>
        <Link
          href={`/firm/${firmId}/clients`}
          className="text-xs font-medium uppercase tracking-wide text-slate-500 hover:text-slate-700"
        >
          ← All clients
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">
          {client ? client.full_name : 'Client'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Visible and editable only by this firm&apos;s owner or admins.
        </p>
      </div>

      {loading ? (
        <div className="mt-10 flex items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : forbidden ? (
        <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          This client record is only visible to this firm&apos;s owner or admins.
        </div>
      ) : notFound ? (
        <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          This client record could not be found.
        </div>
      ) : error ? (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : client ? (
        <div className="mt-6 space-y-6">
          <form
            onSubmit={handleSave}
            className="space-y-4 rounded-md border border-slate-200 bg-white px-4 py-4"
          >
            <div>
              <label className="text-xs font-medium text-slate-500">Full name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Phone</label>
              <input
                type="text"
                placeholder="Not provided"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
              {saveError && <p className="text-xs text-red-700">{saveError}</p>}
              {saved && !saveError && <p className="text-xs text-slate-500">Saved.</p>}
              <button
                type="submit"
                disabled={saving || fullName.trim().length === 0 || email.trim().length === 0}
                className="rounded-md border border-slate-300 bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>

          <section className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <p>Portal access: {client.profile_id ? 'Linked' : 'Not yet linked'}</p>
            <p className="mt-1">Added {formatTimestamp(client.created_at)}</p>
            <p className="mt-1">Last updated {formatTimestamp(client.updated_at)}</p>
          </section>
        </div>
      ) : null}
    </div>
  );
}
