// Real path: FLAGGED, UNVERIFIED -- src/app/(dashboard)/firm/[firmId]/settings/page.tsx
// Sibling of firm-dashboard's own page (src/app/(dashboard)/firm/[firmId]/page.tsx,
// real, pasted this session) -- same route-group-parentheses-not-in-URL
// assumption that file already flags, not re-verified independently here.
//
// NEW PAGE, THIS SESSION -- Org/Firm Settings frontend. Consumes THREE
// routes, all source-verified this session:
//   - GET/PATCH /api/firms/[id]              (this session's own backend)
//   - GET/POST  /api/firms/[id]/members       (real, pasted earlier this session)
//   - PATCH/DELETE /api/firms/[id]/members/[profileId] (real, pasted this
//     session -- confirmed DELETE returns bare 204, no body; this page's
//     fetch call for removeMember() does NOT attempt to parse a body on
//     success, matching that confirmed convention exactly)
//
// STYLING: deliberately matches firm-dashboard/page.tsx (real, pasted
// this session) everywhere a direct equivalent exists -- slate palette,
// rounded-md borders, max-w-5xl container, same loading-spinner,
// error-banner, and forbidden-state markup and copy pattern, same
// shortId()/formatTimestamp() helpers (duplicated inline rather than
// imported from a shared util -- no shared utils module was confirmed to
// exist this session; firm-dashboard/page.tsx duplicates these same two
// helpers itself rather than importing them, so this follows that same
// precedent, not a new decision).
//
// FLAGGED, NEW -- NO CRUD-FORM PRECEDENT EXISTED THIS SESSION:
// firm-dashboard/page.tsx is read-only (getDashboard() only). This page
// needs three real mutations (rename, add member, change role, remove
// member) with no existing form/button styling in this project's pasted
// source to mirror. Kept minimal and consistent with the read-only
// page's own slate/rounded-md language, but every form-specific class
// name and interaction pattern below is a NEW decision, not a verified
// one -- revisit against a real form page (e.g. billing/firms/new/page.tsx,
// referenced but never pasted this session) if it surfaces later.
//
// FLAGGED, REAL GAP: FirmMemberRepository#findByFirmId() (confirmed via
// its own pasted source) returns bare firm_members rows -- id, firm_id,
// profile_id, role, created_at, updated_at. No profile name/email join
// exists. The roster below can only display a shortened profile_id per
// member, same "swallowed-failure, fallback to shortId" posture
// firm-dashboard/page.tsx already uses for the firm itself. "Add member"
// likewise requires the caller to already know the target's raw
// profileId -- there's no people-search/lookup route confirmed to exist
// this session to resolve a name or email to one.
//
// VISIBILITY HANDLING: identical to firm-dashboard/page.tsx -- a 403 from
// either GET call (caller not 'owner'/'admin' per FirmService's own new
// requireManageAccess(), this session) renders the same dedicated
// forbidden message, not the generic error banner.
//
// AMENDMENT -- Firm Terminal Team/Member Management task, later session:
// added a third section, "Invitations", directly below Members.
// EXISTING BACKEND, NO GAP: GET/POST /api/firms/[id]/invitations and
// POST /api/firms/[id]/invitations/[invitationId]/revoke (all real,
// confirmed this session) plus FirmInvitationService's own
// createInvitation()/listForFirm()/revokeInvitation() (all real,
// confirmed this session, same requireFirmRole(['owner','admin'])
// gating as every method already on this page) were fully built with
// zero frontend consumer anywhere in the repo prior to this change --
// confirmed via full-repo search. This section is the only missing
// layer; no service/repository/route/migration touched.
//
// PLACEMENT DECISION: added as a third sibling section on THIS page
// rather than a new top-level route/nav item. "Add member" above
// already covers direct-by-profileId membership (no invite step);
// Invitations is the complementary invite-by-email flow for people who
// aren't a known profileId yet -- both are the same underlying concern
// (firm membership) and the existing Members section already
// established the "CRUD list + form, all on this one settings page"
// shape this reuses verbatim, rather than inventing a second page/route
// for what is one coherent workflow. The sidebar's separate, still-
// disabled "Team" item is deliberately left untouched -- that label is
// reserved for the real, distinct `teams`/`team_members` subsystem
// (TeamService et al., confirmed this session to be an entirely
// separate feature with its own zero-frontend gap), not repurposed
// here to avoid a naming collision with that future task.
//
// FIELDS SHOWN: only real, confirmed firm_invitations columns (verified
// directly against database.types.ts this session) -- email, role,
// status, expires_at, created_at. token/profile_id/invited_by/
// accepted_at/revoked_at are not surfaced -- no UI need identified for
// them (revoked_at/accepted_at are implied by status; token is only
// meaningful embedded in inviteUrl, itself only returned once at
// creation time, handled below).
//
// STATUS VALUES: 'status' is a bare `text` column (no enum/CHECK
// constraint found in this session's search), but createInvitation()/
// revokeInvitation()/acceptFromList() only ever write
// 'pending'|'revoked'|'accepted'|'expired' -- those four are what this
// page's badge styling below switches on; any other value (a manual DB
// edit, a future status this page doesn't know about) falls back to a
// plain neutral badge rather than crashing.
//
// REVOKE ONLY, NO EDIT/RESEND: revokeInvitation() is the only mutation
// FirmInvitationService exposes on an existing invitation -- no
// "resend" method exists. Re-inviting the same email (which
// createInvitation()'s own Decision #10 handles by auto-revoking the
// old pending row) is the establishment path for that, so the Revoke
// button is offered only on 'pending' rows, and the same "New
// invitation" form below covers re-inviting.
//
// INVITE-LINK DISCLOSURE: createInvitation() returns inviteUrl only
// when the email did NOT match an existing profile (new-user path,
// Decision #3) -- null otherwise (existing-profile path, actioned via
// that user's own My Invitations pending-list instead, a different
// page entirely). When present, this page shows a one-time copyable
// link in the creation form's own success state rather than persisting
// it into invitation list rows -- the token is never re-fetchable after
// creation (no route returns it), so there is nothing to show on
// subsequent loads.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

type FirmRole = 'owner' | 'admin' | 'employee' | 'lawyer';

const FIRM_ROLE_VALUES: readonly FirmRole[] = ['owner', 'admin', 'employee', 'lawyer'];

interface FirmRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

interface FirmMemberRow {
  id: string;
  firm_id: string;
  profile_id: string;
  role: FirmRole;
  created_at: string;
  updated_at: string;
  // NEW, THIS SESSION: present only from GET .../members/roster (the new
  // enriched endpoint), not from POST/PATCH .../members responses, which
  // still return the plain FirmMemberRow shape FirmMemberService itself
  // returns. Optional and defensively handled below (falls back to
  // shortId) rather than assumed always-present.
  profile?: ProfileRow | null;
}

interface FirmInvitationRow {
  id: string;
  firm_id: string;
  email: string;
  profile_id: string | null;
  role: FirmRole;
  token: string;
  status: string;
  invited_by: string;
  expires_at: string;
  revoked_at: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

const ALLOWED_INVITE_ROLES: readonly FirmRole[] = ['owner', 'admin', 'employee', 'lawyer'];

function invitationStatusClasses(status: string): string {
  switch (status) {
    case 'pending':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'accepted':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'revoked':
    case 'expired':
      return 'border-slate-200 bg-slate-100 text-slate-500';
    default:
      return 'border-slate-200 bg-slate-100 text-slate-500';
  }
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

export default function FirmSettingsPage({ params }: { params: { firmId: string } }) {
  const firmId = params.firmId;

  const [firm, setFirm] = useState<FirmRow | null>(null);
  const [members, setMembers] = useState<FirmMemberRow[]>([]);
  const [invitations, setInvitations] = useState<FirmInvitationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  // Rename form state -- FLAGGED, NEW: no existing form pattern to mirror.
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Add-member form state -- FLAGGED, NEW: raw profileId input, see
  // header comment on why there's no lookup available.
  const [newProfileId, setNewProfileId] = useState('');
  const [newRole, setNewRole] = useState<FirmRole>('employee');
  const [addingMember, setAddingMember] = useState(false);
  const [addMemberError, setAddMemberError] = useState<string | null>(null);

  // Per-row action state, keyed by member id -- lets one row show a
  // spinner/error without disabling the whole roster.
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string | null>>({});

  // New-invitation form state -- mirrors the "add member" form's own
  // state shape exactly.
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<FirmRole>('employee');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  // Per-row action state for revoking a pending invitation, keyed by
  // invitation id -- same shape as rowBusy/rowError above.
  const [invRowBusy, setInvRowBusy] = useState<Record<string, boolean>>({});
  const [invRowError, setInvRowError] = useState<Record<string, string | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);

    try {
      const [firmRes, membersRes, invitationsRes] = await Promise.all([
        fetch(`/api/firms/${firmId}`),
        // AMENDED, THIS SESSION: was /api/firms/${firmId}/members (plain
        // roster, no names). Now uses the new .../roster endpoint for
        // profile-enriched rows. The plain endpoint is still used
        // elsewhere below (add/role-change/remove all still hit the
        // original /members and /members/[profileId] routes, unchanged).
        fetch(`/api/firms/${firmId}/members/roster`),
        // NEW, THIS SESSION: GET /api/firms/[id]/invitations -- real,
        // pre-existing route, same owner/admin gating as the other two
        // calls here, so a 403 on any of the three is treated
        // identically below (see forbidden-state handling).
        fetch(`/api/firms/${firmId}/invitations`),
      ]);

      if (firmRes.status === 403 || membersRes.status === 403 || invitationsRes.status === 403) {
        setForbidden(true);
        return;
      }

      const firmJson = await firmRes.json();
      if (!firmRes.ok) throw new Error(firmJson?.error?.message ?? 'Failed to load firm.');

      const membersJson = await membersRes.json();
      if (!membersRes.ok) {
        throw new Error(membersJson?.error?.message ?? 'Failed to load members.');
      }

      const invitationsJson = await invitationsRes.json();
      if (!invitationsRes.ok) {
        throw new Error(invitationsJson?.error?.message ?? 'Failed to load invitations.');
      }

      setFirm(firmJson.data as FirmRow);
      setNameInput((firmJson.data as FirmRow).name);
      setMembers(membersJson.data as FirmMemberRow[]);
      setInvitations(invitationsJson.data as FirmInvitationRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load firm settings.');
    } finally {
      setLoading(false);
    }
  }, [firmId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    setSavingName(true);
    setNameError(null);

    try {
      const res = await fetch(`/api/firms/${firmId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to rename firm.');

      setFirm(json.data as FirmRow);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Failed to rename firm.');
    } finally {
      setSavingName(false);
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    setAddingMember(true);
    setAddMemberError(null);

    try {
      const res = await fetch(`/api/firms/${firmId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: newProfileId, role: newRole }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to add member.');

      setMembers((prev) => [...prev, json.data as FirmMemberRow]);
      setNewProfileId('');
      setNewRole('employee');
    } catch (err) {
      setAddMemberError(err instanceof Error ? err.message : 'Failed to add member.');
    } finally {
      setAddingMember(false);
    }
  }

  async function handleRoleChange(member: FirmMemberRow, role: FirmRole) {
    setRowBusy((prev) => ({ ...prev, [member.id]: true }));
    setRowError((prev) => ({ ...prev, [member.id]: null }));

    try {
      const res = await fetch(`/api/firms/${firmId}/members/${member.profile_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to change role.');

      // AMENDED, THIS SESSION: PATCH .../members/[profileId] returns the
      // plain FirmMemberRow shape (confirmed via that route's own pasted
      // source) -- it has no `profile` field. Naively replacing the row
      // would silently drop the enriched name back to the shortId
      // fallback after every role change. Preserving the existing
      // profile from state instead, since the profile itself didn't
      // change, only the role did.
      const updated = json.data as FirmMemberRow;
      setMembers((prev) =>
        prev.map((m) => (m.id === updated.id ? { ...updated, profile: m.profile } : m)),
      );
    } catch (err) {
      setRowError((prev) => ({
        ...prev,
        [member.id]: err instanceof Error ? err.message : 'Failed to change role.',
      }));
    } finally {
      setRowBusy((prev) => ({ ...prev, [member.id]: false }));
    }
  }

  async function handleRemove(member: FirmMemberRow) {
    setRowBusy((prev) => ({ ...prev, [member.id]: true }));
    setRowError((prev) => ({ ...prev, [member.id]: null }));

    try {
      // CONFIRMED convention, this session: DELETE returns bare 204, no
      // body -- do not attempt res.json() on success.
      const res = await fetch(`/api/firms/${firmId}/members/${member.profile_id}`, {
        method: 'DELETE',
      });

      if (res.status !== 204) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? 'Failed to remove member.');
      }

      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (err) {
      setRowError((prev) => ({
        ...prev,
        [member.id]: err instanceof Error ? err.message : 'Failed to remove member.',
      }));
      setRowBusy((prev) => ({ ...prev, [member.id]: false }));
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError(null);
    setInviteUrl(null);

    try {
      const res = await fetch(`/api/firms/${firmId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to send invitation.');

      // Decision #10 (see FirmInvitationService#createInvitation()'s own
      // doc comment): re-inviting the same email revokes the old
      // pending row server-side first. Reload the list wholesale rather
      // than trying to patch that revocation into local state by hand.
      const invitationsRes = await fetch(`/api/firms/${firmId}/invitations`);
      const invitationsJson = await invitationsRes.json();
      if (invitationsRes.ok) {
        setInvitations(invitationsJson.data as FirmInvitationRow[]);
      }

      setInviteEmail('');
      setInviteRole('employee');
      setInviteUrl(json.inviteUrl ?? null);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to send invitation.');
    } finally {
      setInviting(false);
    }
  }

  async function handleRevokeInvitation(invitation: FirmInvitationRow) {
    setInvRowBusy((prev) => ({ ...prev, [invitation.id]: true }));
    setInvRowError((prev) => ({ ...prev, [invitation.id]: null }));

    try {
      const res = await fetch(
        `/api/firms/${firmId}/invitations/${invitation.id}/revoke`,
        { method: 'POST' },
      );

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to revoke invitation.');

      setInvitations((prev) =>
        prev.map((inv) =>
          inv.id === invitation.id ? { ...inv, status: 'revoked' } : inv,
        ),
      );
    } catch (err) {
      setInvRowError((prev) => ({
        ...prev,
        [invitation.id]: err instanceof Error ? err.message : 'Failed to revoke invitation.',
      }));
    } finally {
      setInvRowBusy((prev) => ({ ...prev, [invitation.id]: false }));
    }
  }

  const headerTitle = firm ? firm.name : `Firm ${shortId(firmId)}`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {headerTitle}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Firm settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage firm details and membership -- visible only to firm owners and admins.
        </p>
      </div>

      {loading ? (
        <div className="mt-10 flex items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : forbidden ? (
        <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Firm settings are only visible to this firm&apos;s owner or admins.
        </div>
      ) : error ? (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : firm ? (
        <div className="mt-6 space-y-10">
          {/* Rename */}
          <section>
            <h2 className="text-sm font-semibold text-slate-900">Firm name</h2>
            <form onSubmit={handleRename} className="mt-3 flex items-start gap-3">
              <div className="flex-1">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={255}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
                />
                {nameError && <p className="mt-2 text-xs text-red-700">{nameError}</p>}
              </div>
              <button
                type="submit"
                disabled={savingName || nameInput.trim().length === 0}
                className="rounded-md border border-slate-300 bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {savingName ? 'Saving…' : 'Save'}
              </button>
            </form>
          </section>

          {/* Members */}
          <section>
            <h2 className="text-sm font-semibold text-slate-900">
              Members <span className="font-normal text-slate-400">({members.length})</span>
            </h2>

            {members.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No members yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-md border border-slate-200 bg-white px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {m.profile?.full_name ?? shortId(m.profile_id)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Joined {formatTimestamp(m.created_at)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <select
                          value={m.role}
                          disabled={rowBusy[m.id]}
                          onChange={(e) => handleRoleChange(m, e.target.value as FirmRole)}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 disabled:opacity-50"
                        >
                          {FIRM_ROLE_VALUES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          disabled={rowBusy[m.id]}
                          onClick={() => handleRemove(m)}
                          className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {rowError[m.id] && (
                      <p className="mt-2 text-xs text-red-700">{rowError[m.id]}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* Add member */}
            <form
              onSubmit={handleAddMember}
              className="mt-4 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
            >
              <input
                type="text"
                placeholder="Profile ID"
                value={newProfileId}
                onChange={(e) => setNewProfileId(e.target.value)}
                className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as FirmRole)}
                className="rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900"
              >
                {FIRM_ROLE_VALUES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={addingMember || newProfileId.trim().length === 0}
                className="rounded-md border border-slate-300 bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {addingMember ? 'Adding…' : 'Add'}
              </button>
            </form>
            {addMemberError && <p className="mt-2 text-xs text-red-700">{addMemberError}</p>}
          </section>

          {/* Invitations */}
          <section>
            <h2 className="text-sm font-semibold text-slate-900">
              Invitations{' '}
              <span className="font-normal text-slate-400">({invitations.length})</span>
            </h2>

            {invitations.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No invitations sent yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {invitations.map((inv) => (
                  <li
                    key={inv.id}
                    className="rounded-md border border-slate-200 bg-white px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {inv.email}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {inv.role} · sent {formatTimestamp(inv.created_at)}
                          {inv.status === 'pending'
                            ? ` · expires ${formatTimestamp(inv.expires_at)}`
                            : ''}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${invitationStatusClasses(inv.status)}`}
                        >
                          {inv.status}
                        </span>

                        {inv.status === 'pending' && (
                          <button
                            type="button"
                            disabled={invRowBusy[inv.id]}
                            onClick={() => handleRevokeInvitation(inv)}
                            className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    </div>

                    {invRowError[inv.id] && (
                      <p className="mt-2 text-xs text-red-700">{invRowError[inv.id]}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* New invitation */}
            <form
              onSubmit={handleInvite}
              className="mt-4 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
            >
              <input
                type="email"
                placeholder="Email address"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as FirmRole)}
                className="rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900"
              >
                {ALLOWED_INVITE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={inviting || inviteEmail.trim().length === 0}
                className="rounded-md border border-slate-300 bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {inviting ? 'Sending…' : 'Send invite'}
              </button>
            </form>
            {inviteError && <p className="mt-2 text-xs text-red-700">{inviteError}</p>}
            {inviteUrl && (
              <p className="mt-2 break-all text-xs text-slate-500">
                Invitation sent. Since this email has no existing account, share this link
                directly: <span className="text-slate-700">{inviteUrl}</span>
              </p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}