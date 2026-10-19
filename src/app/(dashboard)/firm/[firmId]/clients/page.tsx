// Real path: FLAGGED, UNVERIFIED (same posture as every sibling firm
// page) -- src/app/(dashboard)/firm/[firmId]/clients/page.tsx
// Route group parentheses assumed not to appear in the URL, same
// convention as firm-dashboard/page.tsx and firm-settings/page.tsx
// (both real, pasted this session).
//
// NEW PAGE, THIS SESSION -- Firm Terminal Clients workspace frontend.
// EXISTING BACKEND, NO GAP: GET/POST /api/firms/[id]/clients (real,
// pasted this session) and ClientService's createClient()/listForFirm()
// (real, pasted this session) were already fully built, tested-by-
// construction, and owner/admin-authorized. This page is the ONLY
// missing layer -- no service, repository, route, or migration change
// was made or needed.
//
// STYLING: deliberately matches firm-settings/page.tsx (real, pasted
// this session) everywhere a direct equivalent exists -- slate palette,
// rounded-md borders, max-w-3xl container, same loading-spinner,
// error-banner, forbidden-state, and "add"-form markup/copy pattern
// (mirrors that page's own "Add member" form almost verbatim, just
// swapping profileId/role for fullName/email/phone). Header block
// (firm name via GET /api/firms/[id], falling back to shortId) copied
// from that same page rather than re-derived.
//
// SEARCH: client-side substring filter over fullName/email only --
// ClientService#listForFirm() takes no query param and there is no
// server-side search endpoint anywhere in this project's pasted
// source, so a server-side "useful filtering" was not invented. This
// is the smallest thing that satisfies the brief's "search" /
// "filtering if existing data supports it" line without adding new
// backend surface.
//
// FIELDS SHOWN: only real, confirmed clients columns -- full_name,
// email, phone (nullable), created_at. No "status" field exists on the
// clients table (confirmed via the real, pasted
// 20260812000000_create_clients_table.sql), so none is shown or
// invented. profile_id (portal-signup link) is not surfaced here --
// no UI need identified for it in this feature.
//
// AUTHORIZATION: not handled here at all. ClientService#listForFirm()/
// #createClient() both call requireFirmRole(['owner','admin']) --
// identical scope to firm-settings/firm-dashboard's own
// requireManageAccess() gating, so this page reuses the exact same
// forbidden-state handling (403 on either GET -> dedicated message,
// not the generic error banner).
//
// EACH CARD LINKS to /firm/[firmId]/clients/[clientId] (new sibling
// page, this same change) -- GET/PATCH /api/firms/[id]/clients/[clientId]
// already exist and were otherwise unreachable from any frontend.

// AMENDMENT -- Navigation + Polish Cleanup task, later session: now
// rendered inside the shared AppSidebar shell (active="clients"),
// matching documents/page.tsx's established wrapping pattern. No
// business logic touched.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { AppShell } from '@/shared/components/layout/app-shell';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

interface FirmRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

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

function shortId(id: string): string {
  return id.slice(0, 8);
}

export default function FirmClientsPage({ params }: { params: { firmId: string } }) {
  const firmId = params.firmId;

  const [firm, setFirm] = useState<FirmRow | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [search, setSearch] = useState('');

  // New-client form state -- mirrors firm-settings/page.tsx's own
  // "add member" form state shape exactly.
  const [showNewForm, setShowNewForm] = useState(false);
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);

    try {
      const [firmRes, clientsRes] = await Promise.all([
        fetch(`/api/firms/${firmId}`),
        fetch(`/api/firms/${firmId}/clients`),
      ]);

      if (firmRes.status === 403 || clientsRes.status === 403) {
        setForbidden(true);
        return;
      }

      const firmJson = await firmRes.json();
      if (!firmRes.ok) throw new Error(firmJson?.error?.message ?? 'Failed to load firm.');

      const clientsJson = await clientsRes.json();
      if (!clientsRes.ok) {
        throw new Error(clientsJson?.error?.message ?? 'Failed to load clients.');
      }

      setFirm(firmJson.data as FirmRow);
      setClients(clientsJson.data as ClientRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clients.');
    } finally {
      setLoading(false);
    }
  }, [firmId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);

    try {
      const res = await fetch(`/api/firms/${firmId}/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: newFullName,
          email: newEmail,
          phone: newPhone.trim().length > 0 ? newPhone.trim() : null,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to create client.');

      setClients((prev) => [...prev, json.data as ClientRow]);
      setNewFullName('');
      setNewEmail('');
      setNewPhone('');
      setShowNewForm(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create client.');
    } finally {
      setCreating(false);
    }
  }

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length === 0) return clients;
    return clients.filter(
      (c) => c.full_name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
    );
  }, [clients, search]);

  const headerTitle = firm ? firm.name : `Firm ${shortId(firmId)}`;

  return (
    <AppShell active="clients" terminal="firm" firmId={firmId}>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-10">
      <div>
        <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
          {headerTitle}
        </p>
        <h1 className="mt-1 text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-page-title">Clients</h1>
        <p className="mt-1 text-ui text-muted-foreground">
          Firm-wide client roster -- visible only to firm owners and admins.
        </p>
      </div>

      {loading ? (
        <div className="mt-10 flex items-center justify-center text-ui text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : forbidden ? (
        <div className="mt-6 rounded-md border border-border bg-muted px-4 py-3 text-ui text-muted-foreground">
          Clients are only visible to this firm&apos;s owner or admins.
        </div>
      ) : error ? (
        <div className="mt-6 rounded-md border border-destructive bg-destructive-subtle px-4 py-3 text-ui text-destructive-subtle-foreground">
          {error}
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {/* Search + New client */}
          <div className="flex items-center gap-3">
            <Input aria-label="Search clients by name or email"
              className="flex-1"
              type="text"
              placeholder="Search by name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button
              className="shrink-0"
              type="button"
              onClick={() => setShowNewForm((v) => !v)}
            >
              {showNewForm ? 'Cancel' : '+ New client'}
            </Button>
          </div>

          {/* New client form */}
          {showNewForm && (
            <form
              onSubmit={handleCreate}
              className="space-y-3 rounded-md border border-border bg-muted px-4 py-3"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Input aria-label="Full name"
                  type="text"
                  placeholder="Full name"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                />
                <Input aria-label="Email"
                  type="email"
                  placeholder="Email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
                <Input aria-label="Phone (optional)"
                  type="text"
                  placeholder="Phone (optional)"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-end gap-3">
                {createError && <p className="text-meta text-destructive">{createError}</p>}
                <Button
                  type="submit"
                  disabled={
                    creating || newFullName.trim().length === 0 || newEmail.trim().length === 0
                  }
                >
                  {creating ? 'Creating…' : 'Create client'}
                </Button>
              </div>
            </form>
          )}

          {/* Client list */}
          <section>
            <h2 className="text-subsection font-semibold text-foreground">
              All clients{' '}
              <span className="font-normal text-muted-foreground">({filteredClients.length})</span>
            </h2>

            {clients.length === 0 ? (
              <p className="mt-3 text-ui text-muted-foreground">
                No clients yet -- use &ldquo;+ New client&rdquo; to add the first one.
              </p>
            ) : filteredClients.length === 0 ? (
              <p className="mt-3 text-ui text-muted-foreground">No clients match your search.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {filteredClients.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/firm/${firmId}/clients/${c.id}`}
                      className="block rounded-md border border-border bg-card px-4 py-3 hover:border-primary"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-ui font-medium text-foreground">
                            {c.full_name}
                          </p>
                          <p className="mt-1 truncate text-meta text-muted-foreground">
                            {c.email}
                            {c.phone ? ` · ${c.phone}` : ''}
                          </p>
                        </div>
                        <p className="shrink-0 text-meta text-muted-foreground">
                          Added {formatTimestamp(c.created_at)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
        </div>
      </div>
    </AppShell>
  );
}
