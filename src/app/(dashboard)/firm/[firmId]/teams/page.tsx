// Real path: FLAGGED, UNVERIFIED (same posture as every sibling firm
// page) -- src/app/(dashboard)/firm/[firmId]/teams/page.tsx
//
// NEW PAGE, THIS SESSION -- Firm Terminal Teams / Team Management
// frontend. EXISTING BACKEND, NO GAP: a full audit of current `main`
// AND the live Supabase project (list_migrations / list_tables,
// confirmed matching the repo's migrations exactly) found TeamService,
// TeamMemberService, TeamInvitationService, their repositories/
// factories, and every route below already fully built, authorized,
// and RLS-backed with ZERO frontend consumer anywhere in the repo:
//
//   GET/POST   /api/firms/[id]/teams
//   DELETE     /api/firms/[id]/teams/[teamId]
//   GET/POST   /api/firms/[id]/teams/[teamId]/members
//   PATCH/DELETE /api/firms/[id]/teams/[teamId]/members/[profileId]
//   GET/POST   /api/teams/[id]/invitations
//   POST       /api/teams/[id]/invitations/[invitationId]/revoke
//
// This page, plus the AppSidebar amendment enabling the previously
// "Coming soon" Team item, is the only change this task makes. No
// service, repository, route, or migration was touched.
//
// NO RENAME UI: TeamService has no update()/rename method and
// /api/firms/[id]/teams/[teamId]/route.ts's own header comment
// documents this as a deliberate scope omission ("Renaming a team was
// never scoped... this is a deliberate omission, not an oversight"),
// not a gap to fill. This page does not invent one.
//
// STYLING: matches clients/page.tsx and settings/page.tsx exactly --
// same slate palette, rounded-md borders, max-w-3xl container, same
// loading-spinner / error-banner / forbidden-state markup, same
// shortId()/formatTimestamp() helpers duplicated inline (no shared
// utils module exists to import them from, same precedent those two
// pages already establish).
//
// ROLE-AWARE UI, NOT A NEW AUTHORIZATION DECISION: TeamService#listTeams()
// and TeamMemberService#listMembers() are both firm-wide reads -- ANY
// authenticated member of the firm may call them (decision #7 in the
// teams migration header), not just owner/admin. Team creation,
// deletion, member add/remove/role-change, and invitation management
// are all owner/admin-only (requireManageAccess() inside each service).
// This page determines "is the caller owner/admin" client-side by
// fetching the plain GET /api/firms/[id]/members roster (callable by
// any firm member, unlike the enriched .../members/roster endpoint,
// which is itself owner/admin-gated) and finding the row whose
// profile_id matches the caller's own id (from GET /api/profiles/me).
// Ordinary firm lawyers therefore see the full team list and every
// team's roster (read-only, per the backend's own firm-wide scoping)
// but never see create/delete/add/remove/invite controls. This is not
// a new access-control decision -- it mirrors exactly what the
// services already enforce server-side; the UI simply avoids showing
// buttons that would 403 if clicked.
//
// NAME ENRICHMENT: team_members/team_invitations carry only profile_id
// (no join). The enriched GET /api/firms/[id]/members/roster endpoint
// (real, pre-existing, built for Firm Settings) is reused here --
// fetched only when the caller is owner/admin (it 403s otherwise, same
// gate as everything else management-side) -- to resolve profile_id to
// full_name for team rosters, the "Add member" picker, and the "Invite"
// picker. An ordinary firm lawyer viewing a team roster sees shortened
// profile ids instead, same fallback posture firm-settings/page.tsx
// used before that enrichment existed.
//
// ADD vs INVITE, TWO SEPARATE FLOWS, NOT DUPLICATED: mirrors the exact
// same pattern already established on settings/page.tsx for firm
// membership -- "Add member" (POST .../teams/[teamId]/members) is a
// direct, no-invitation add of a profile who is already a firm member
// (TeamMemberService#addMember() enforces that precondition
// server-side); "Invite" (POST /api/teams/[id]/invitations) is the
// separate in-app invitation flow the recipient accepts themselves via
// the existing My Invitations page (already wired, not touched here).
// Both picker dropdowns are sourced from the same enriched firm roster;
// the "Add member" picker additionally excludes profiles already on
// this team's roster (client-side convenience to avoid tripping the
// team_members_team_profile_unique constraint), which the backend does
// not otherwise surface a friendly message for.
//
// TEAM MEMBER ROLE (member/lead): changeRole() is owner/admin-gated,
// NOT team-lead-gated (TeamMemberService's own doc comment: "not
// something a team lead can do to another member") -- being a team
// lead grants no special UI capability here, matching the backend
// exactly. No last-lead protection exists server-side, so none is
// invented here either.

// AMENDMENT -- Navigation + Polish Cleanup task, later session: this
// page's own header comment above claimed it already used the shared
// AppSidebar shell -- that was NOT true in the current repo (re-
// verified this task per its own "audit the current repo, don't
// assume the prior audit's findings still hold" instruction): the page
// rendered as a bare, unshelled container the same as its Firm
// Terminal siblings. Now actually wrapped in AppSidebar
// (active="teams"), matching documents/page.tsx's established
// wrapping pattern. No business logic touched.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { AppSidebar } from '@/shared/components/layout/app-sidebar';

type FirmRole = 'owner' | 'admin' | 'employee' | 'lawyer';
type TeamMemberRole = 'member' | 'lead';

const TEAM_MEMBER_ROLE_VALUES: readonly TeamMemberRole[] = ['member', 'lead'];
const MANAGE_ROLES: readonly FirmRole[] = ['owner', 'admin'];

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
}

interface EnrichedFirmMemberRow extends FirmMemberRow {
  profile: ProfileRow | null;
}

interface TeamRow {
  id: string;
  firm_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface TeamMemberRow {
  id: string;
  team_id: string;
  profile_id: string;
  role: TeamMemberRole;
  created_at: string;
  updated_at: string;
}

interface TeamInvitationRow {
  id: string;
  team_id: string;
  profile_id: string;
  status: string;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
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

export default function FirmTeamsPage({ params }: { params: { firmId: string } }) {
  const firmId = params.firmId;

  const [firm, setFirm] = useState<FirmRow | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [isManager, setIsManager] = useState(false);
  const [profileById, setProfileById] = useState<Record<string, ProfileRow | null>>({});
  const [firmMembers, setFirmMembers] = useState<EnrichedFirmMemberRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  // New-team form state (owner/admin only) -- mirrors clients/page.tsx's
  // own "new" form shape.
  const [showNewTeamForm, setShowNewTeamForm] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [createTeamError, setCreateTeamError] = useState<string | null>(null);

  // Per-team delete state.
  const [teamRowBusy, setTeamRowBusy] = useState<Record<string, boolean>>({});
  const [teamRowError, setTeamRowError] = useState<Record<string, string | null>>({});

  // Expansion + per-team roster/invitation state, keyed by team id.
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<Record<string, TeamMemberRow[]>>({});
  const [teamInvitations, setTeamInvitations] = useState<Record<string, TeamInvitationRow[]>>({});
  const [panelLoading, setPanelLoading] = useState<Record<string, boolean>>({});
  const [panelError, setPanelError] = useState<Record<string, string | null>>({});

  // Per-member-row action state, keyed by team_members.id.
  const [memberRowBusy, setMemberRowBusy] = useState<Record<string, boolean>>({});
  const [memberRowError, setMemberRowError] = useState<Record<string, string | null>>({});

  // Add-member form state, keyed by team id.
  const [addMemberProfileId, setAddMemberProfileId] = useState<Record<string, string>>({});
  const [addingMember, setAddingMember] = useState<Record<string, boolean>>({});
  const [addMemberError, setAddMemberError] = useState<Record<string, string | null>>({});

  // Invite form state, keyed by team id.
  const [inviteProfileId, setInviteProfileId] = useState<Record<string, string>>({});
  const [inviting, setInviting] = useState<Record<string, boolean>>({});
  const [inviteError, setInviteError] = useState<Record<string, string | null>>({});

  // Per-invitation-row action state, keyed by team_invitations.id.
  const [invRowBusy, setInvRowBusy] = useState<Record<string, boolean>>({});
  const [invRowError, setInvRowError] = useState<Record<string, string | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);

    try {
      const [profileRes, firmRes, membersRes, teamsRes] = await Promise.all([
        fetch('/api/profiles/me', { credentials: 'include' }),
        fetch(`/api/firms/${firmId}`),
        // Plain roster -- callable by ANY firm member (unlike the
        // enriched .../roster endpoint below), used only to resolve the
        // caller's own FirmRole.
        fetch(`/api/firms/${firmId}/members`),
        fetch(`/api/firms/${firmId}/teams`),
      ]);

      if (firmRes.status === 403 || membersRes.status === 403 || teamsRes.status === 403) {
        setForbidden(true);
        return;
      }

      const firmJson = await firmRes.json();
      if (!firmRes.ok) throw new Error(firmJson?.error?.message ?? 'Failed to load firm.');

      const membersJson = await membersRes.json();
      if (!membersRes.ok) {
        throw new Error(membersJson?.error?.message ?? 'Failed to load firm members.');
      }

      const teamsJson = await teamsRes.json();
      if (!teamsRes.ok) throw new Error(teamsJson?.error?.message ?? 'Failed to load teams.');

      setFirm(firmJson.data as FirmRow);
      setTeams(teamsJson.data as TeamRow[]);

      let myFirmRole: FirmRole | null = null;
      if (profileRes.ok) {
        const profileJson = await profileRes.json();
        const myProfileId = profileJson?.data?.id as string | undefined;
        const myMembership = (membersJson.data as FirmMemberRow[]).find(
          (m) => m.profile_id === myProfileId,
        );
        myFirmRole = myMembership?.role ?? null;
      }

      const manager = myFirmRole !== null && MANAGE_ROLES.includes(myFirmRole);
      setIsManager(manager);

      // Enriched roster (names) is owner/admin-gated server-side, same
      // as every management control below -- only fetched when it will
      // actually succeed, and only needed to power management UI.
      if (manager) {
        const rosterRes = await fetch(`/api/firms/${firmId}/members/roster`);
        if (rosterRes.ok) {
          const rosterJson = await rosterRes.json();
          const roster = rosterJson.data as EnrichedFirmMemberRow[];
          setFirmMembers(roster);
          setProfileById(Object.fromEntries(roster.map((m) => [m.profile_id, m.profile])));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load teams.');
    } finally {
      setLoading(false);
    }
  }, [firmId]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadTeamPanel(teamId: string) {
    setPanelLoading((prev) => ({ ...prev, [teamId]: true }));
    setPanelError((prev) => ({ ...prev, [teamId]: null }));

    try {
      const membersPromise = fetch(`/api/firms/${firmId}/teams/${teamId}/members`);
      const invitationsPromise = isManager
        ? fetch(`/api/teams/${teamId}/invitations`)
        : Promise.resolve(null);

      const [membersRes, invitationsRes] = await Promise.all([
        membersPromise,
        invitationsPromise,
      ]);

      const membersJson = await membersRes.json();
      if (!membersRes.ok) {
        throw new Error(membersJson?.error?.message ?? 'Failed to load team roster.');
      }
      setTeamMembers((prev) => ({ ...prev, [teamId]: membersJson.data as TeamMemberRow[] }));

      if (isManager && invitationsRes) {
        const invitationsJson = await invitationsRes.json();
        if (invitationsRes.ok) {
          setTeamInvitations((prev) => ({
            ...prev,
            [teamId]: invitationsJson.data as TeamInvitationRow[],
          }));
        }
      }
    } catch (err) {
      setPanelError((prev) => ({
        ...prev,
        [teamId]: err instanceof Error ? err.message : 'Failed to load team roster.',
      }));
    } finally {
      setPanelLoading((prev) => ({ ...prev, [teamId]: false }));
    }
  }

  function toggleTeam(teamId: string) {
    if (expandedTeamId === teamId) {
      setExpandedTeamId(null);
      return;
    }
    setExpandedTeamId(teamId);
    if (!teamMembers[teamId]) {
      loadTeamPanel(teamId);
    }
  }

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    setCreatingTeam(true);
    setCreateTeamError(null);

    try {
      const res = await fetch(`/api/firms/${firmId}/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTeamName }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to create team.');

      setTeams((prev) => [...prev, json.data as TeamRow]);
      setNewTeamName('');
      setShowNewTeamForm(false);
    } catch (err) {
      setCreateTeamError(err instanceof Error ? err.message : 'Failed to create team.');
    } finally {
      setCreatingTeam(false);
    }
  }

  async function handleDeleteTeam(team: TeamRow) {
    setTeamRowBusy((prev) => ({ ...prev, [team.id]: true }));
    setTeamRowError((prev) => ({ ...prev, [team.id]: null }));

    try {
      // CONFIRMED convention: DELETE returns bare 204, no body.
      const res = await fetch(`/api/firms/${firmId}/teams/${team.id}`, { method: 'DELETE' });

      if (res.status !== 204) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? 'Failed to delete team.');
      }

      setTeams((prev) => prev.filter((t) => t.id !== team.id));
      if (expandedTeamId === team.id) setExpandedTeamId(null);
    } catch (err) {
      setTeamRowError((prev) => ({
        ...prev,
        [team.id]: err instanceof Error ? err.message : 'Failed to delete team.',
      }));
      setTeamRowBusy((prev) => ({ ...prev, [team.id]: false }));
    }
  }

  async function handleAddMember(teamId: string, e: React.FormEvent) {
    e.preventDefault();
    const profileId = addMemberProfileId[teamId];
    if (!profileId) return;

    setAddingMember((prev) => ({ ...prev, [teamId]: true }));
    setAddMemberError((prev) => ({ ...prev, [teamId]: null }));

    try {
      const res = await fetch(`/api/firms/${firmId}/teams/${teamId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to add member.');

      setTeamMembers((prev) => ({
        ...prev,
        [teamId]: [...(prev[teamId] ?? []), json.data as TeamMemberRow],
      }));
      setAddMemberProfileId((prev) => ({ ...prev, [teamId]: '' }));
    } catch (err) {
      setAddMemberError((prev) => ({
        ...prev,
        [teamId]: err instanceof Error ? err.message : 'Failed to add member.',
      }));
    } finally {
      setAddingMember((prev) => ({ ...prev, [teamId]: false }));
    }
  }

  async function handleRoleChange(teamId: string, member: TeamMemberRow, role: TeamMemberRole) {
    setMemberRowBusy((prev) => ({ ...prev, [member.id]: true }));
    setMemberRowError((prev) => ({ ...prev, [member.id]: null }));

    try {
      const res = await fetch(
        `/api/firms/${firmId}/teams/${teamId}/members/${member.profile_id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        },
      );

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to change role.');

      const updated = json.data as TeamMemberRow;
      setTeamMembers((prev) => ({
        ...prev,
        [teamId]: (prev[teamId] ?? []).map((m) => (m.id === updated.id ? updated : m)),
      }));
    } catch (err) {
      setMemberRowError((prev) => ({
        ...prev,
        [member.id]: err instanceof Error ? err.message : 'Failed to change role.',
      }));
    } finally {
      setMemberRowBusy((prev) => ({ ...prev, [member.id]: false }));
    }
  }

  async function handleRemoveMember(teamId: string, member: TeamMemberRow) {
    setMemberRowBusy((prev) => ({ ...prev, [member.id]: true }));
    setMemberRowError((prev) => ({ ...prev, [member.id]: null }));

    try {
      const res = await fetch(
        `/api/firms/${firmId}/teams/${teamId}/members/${member.profile_id}`,
        { method: 'DELETE' },
      );

      if (res.status !== 204) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? 'Failed to remove member.');
      }

      setTeamMembers((prev) => ({
        ...prev,
        [teamId]: (prev[teamId] ?? []).filter((m) => m.id !== member.id),
      }));
    } catch (err) {
      setMemberRowError((prev) => ({
        ...prev,
        [member.id]: err instanceof Error ? err.message : 'Failed to remove member.',
      }));
      setMemberRowBusy((prev) => ({ ...prev, [member.id]: false }));
    }
  }

  async function handleInvite(teamId: string, e: React.FormEvent) {
    e.preventDefault();
    const profileId = inviteProfileId[teamId];
    if (!profileId) return;

    setInviting((prev) => ({ ...prev, [teamId]: true }));
    setInviteError((prev) => ({ ...prev, [teamId]: null }));

    try {
      const res = await fetch(`/api/teams/${teamId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to send invitation.');

      // createInvitation() revokes any existing pending invite to the
      // same profile before creating the new one server-side (same
      // Decision #10 behavior firm invitations use) -- reload wholesale
      // rather than patching that revocation into local state by hand.
      const invitationsRes = await fetch(`/api/teams/${teamId}/invitations`);
      if (invitationsRes.ok) {
        const invitationsJson = await invitationsRes.json();
        setTeamInvitations((prev) => ({
          ...prev,
          [teamId]: invitationsJson.data as TeamInvitationRow[],
        }));
      }

      setInviteProfileId((prev) => ({ ...prev, [teamId]: '' }));
    } catch (err) {
      setInviteError((prev) => ({
        ...prev,
        [teamId]: err instanceof Error ? err.message : 'Failed to send invitation.',
      }));
    } finally {
      setInviting((prev) => ({ ...prev, [teamId]: false }));
    }
  }

  async function handleRevokeInvitation(teamId: string, invitation: TeamInvitationRow) {
    setInvRowBusy((prev) => ({ ...prev, [invitation.id]: true }));
    setInvRowError((prev) => ({ ...prev, [invitation.id]: null }));

    try {
      const res = await fetch(
        `/api/teams/${teamId}/invitations/${invitation.id}/revoke`,
        { method: 'POST' },
      );

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to revoke invitation.');

      setTeamInvitations((prev) => ({
        ...prev,
        [teamId]: (prev[teamId] ?? []).map((inv) =>
          inv.id === invitation.id ? { ...inv, status: 'revoked' } : inv,
        ),
      }));
    } catch (err) {
      setInvRowError((prev) => ({
        ...prev,
        [invitation.id]: err instanceof Error ? err.message : 'Failed to revoke invitation.',
      }));
    } finally {
      setInvRowBusy((prev) => ({ ...prev, [invitation.id]: false }));
    }
  }

  function profileLabel(profileId: string): string {
    return profileById[profileId]?.full_name ?? shortId(profileId);
  }

  const headerTitle = firm ? firm.name : `Firm ${shortId(firmId)}`;

  return (
    <div className="flex h-screen w-full bg-muted/30 font-sans text-foreground">
      <AppSidebar active="teams" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {headerTitle}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Teams</h1>
        <p className="mt-1 text-sm text-slate-500">
          Firm-wide team roster -- visible to every firm member; only firm owners and admins can
          create, delete, or manage membership.
        </p>
      </div>

      {loading ? (
        <div className="mt-10 flex items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : forbidden ? (
        <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Teams are only visible to members of this firm.
        </div>
      ) : error ? (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {isManager && (
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowNewTeamForm((v) => !v)}
                className="shrink-0 rounded-md border border-slate-300 bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                {showNewTeamForm ? 'Cancel' : '+ New team'}
              </button>
            </div>
          )}

          {isManager && showNewTeamForm && (
            <form
              onSubmit={handleCreateTeam}
              className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
            >
              <input
                type="text"
                placeholder="Team name"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                maxLength={255}
                className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
              />
              <div className="flex items-center gap-3">
                {createTeamError && <p className="text-xs text-red-700">{createTeamError}</p>}
                <button
                  type="submit"
                  disabled={creatingTeam || newTeamName.trim().length === 0}
                  className="rounded-md border border-slate-300 bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {creatingTeam ? 'Creating…' : 'Create team'}
                </button>
              </div>
            </form>
          )}

          <section>
            <h2 className="text-sm font-semibold text-slate-900">
              All teams <span className="font-normal text-slate-400">({teams.length})</span>
            </h2>

            {teams.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                {isManager
                  ? 'No teams yet -- use "+ New team" to create the first one.'
                  : 'No teams exist in this firm yet.'}
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {teams.map((team) => {
                  const isExpanded = expandedTeamId === team.id;
                  const members = teamMembers[team.id] ?? [];
                  const invitations = teamInvitations[team.id] ?? [];
                  const memberProfileIds = new Set(members.map((m) => m.profile_id));
                  const eligibleForAdd = firmMembers.filter(
                    (fm) => !memberProfileIds.has(fm.profile_id),
                  );

                  return (
                    <li key={team.id} className="rounded-md border border-slate-200 bg-white">
                      <div className="flex items-center justify-between gap-3 px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleTeam(team.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {team.name}
                            </p>
                            <p className="mt-1 truncate text-xs text-slate-500">
                              Created {formatTimestamp(team.created_at)}
                            </p>
                          </div>
                        </button>

                        {isManager && (
                          <button
                            type="button"
                            disabled={teamRowBusy[team.id]}
                            onClick={() => handleDeleteTeam(team)}
                            className="shrink-0 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        )}
                      </div>

                      {teamRowError[team.id] && (
                        <p className="px-4 pb-2 text-xs text-red-700">{teamRowError[team.id]}</p>
                      )}

                      {isExpanded && (
                        <div className="space-y-6 border-t border-slate-200 bg-slate-50 px-4 py-4">
                          {panelLoading[team.id] ? (
                            <div className="flex items-center justify-center py-4 text-sm text-slate-500">
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Loading…
                            </div>
                          ) : panelError[team.id] ? (
                            <p className="text-sm text-red-700">{panelError[team.id]}</p>
                          ) : (
                            <>
                              {/* Members */}
                              <div>
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Members{' '}
                                  <span className="font-normal text-slate-400">
                                    ({members.length})
                                  </span>
                                </h3>

                                {members.length === 0 ? (
                                  <p className="mt-2 text-sm text-slate-500">
                                    No members on this team yet.
                                  </p>
                                ) : (
                                  <ul className="mt-2 space-y-2">
                                    {members.map((m) => (
                                      <li
                                        key={m.id}
                                        className="rounded-md border border-slate-200 bg-white px-3 py-2"
                                      >
                                        <div className="flex items-center justify-between gap-3">
                                          <div className="min-w-0">
                                            <p className="truncate text-sm text-slate-900">
                                              {profileLabel(m.profile_id)}
                                            </p>
                                            <p className="mt-0.5 text-xs text-slate-500">
                                              Joined {formatTimestamp(m.created_at)}
                                            </p>
                                          </div>

                                          {isManager ? (
                                            <div className="flex shrink-0 items-center gap-2">
                                              <select
                                                value={m.role}
                                                disabled={memberRowBusy[m.id]}
                                                onChange={(e) =>
                                                  handleRoleChange(
                                                    team.id,
                                                    m,
                                                    e.target.value as TeamMemberRole,
                                                  )
                                                }
                                                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 disabled:opacity-50"
                                              >
                                                {TEAM_MEMBER_ROLE_VALUES.map((role) => (
                                                  <option key={role} value={role}>
                                                    {role}
                                                  </option>
                                                ))}
                                              </select>
                                              <button
                                                type="button"
                                                disabled={memberRowBusy[m.id]}
                                                onClick={() => handleRemoveMember(team.id, m)}
                                                className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
                                              >
                                                Remove
                                              </button>
                                            </div>
                                          ) : (
                                            <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-600">
                                              {m.role}
                                            </span>
                                          )}
                                        </div>
                                        {memberRowError[m.id] && (
                                          <p className="mt-2 text-xs text-red-700">
                                            {memberRowError[m.id]}
                                          </p>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}

                                {isManager && (
                                  <form
                                    onSubmit={(e) => handleAddMember(team.id, e)}
                                    className="mt-3 flex items-start gap-2"
                                  >
                                    <select
                                      value={addMemberProfileId[team.id] ?? ''}
                                      onChange={(e) =>
                                        setAddMemberProfileId((prev) => ({
                                          ...prev,
                                          [team.id]: e.target.value,
                                        }))
                                      }
                                      className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                                    >
                                      <option value="">Select a firm member to add…</option>
                                      {eligibleForAdd.map((fm) => (
                                        <option key={fm.profile_id} value={fm.profile_id}>
                                          {fm.profile?.full_name ?? shortId(fm.profile_id)}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="submit"
                                      disabled={
                                        addingMember[team.id] || !addMemberProfileId[team.id]
                                      }
                                      className="shrink-0 rounded-md border border-slate-300 bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                                    >
                                      {addingMember[team.id] ? 'Adding…' : 'Add'}
                                    </button>
                                  </form>
                                )}
                                {isManager && addMemberError[team.id] && (
                                  <p className="mt-2 text-xs text-red-700">
                                    {addMemberError[team.id]}
                                  </p>
                                )}
                              </div>

                              {/* Invitations -- owner/admin only */}
                              {isManager && (
                                <div>
                                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Invitations{' '}
                                    <span className="font-normal text-slate-400">
                                      ({invitations.length})
                                    </span>
                                  </h3>

                                  {invitations.length === 0 ? (
                                    <p className="mt-2 text-sm text-slate-500">
                                      No invitations sent yet.
                                    </p>
                                  ) : (
                                    <ul className="mt-2 space-y-2">
                                      {invitations.map((inv) => (
                                        <li
                                          key={inv.id}
                                          className="rounded-md border border-slate-200 bg-white px-3 py-2"
                                        >
                                          <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                              <p className="truncate text-sm text-slate-900">
                                                {profileLabel(inv.profile_id)}
                                              </p>
                                              <p className="mt-0.5 text-xs text-slate-500">
                                                sent {formatTimestamp(inv.created_at)}
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
                                                  onClick={() =>
                                                    handleRevokeInvitation(team.id, inv)
                                                  }
                                                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
                                                >
                                                  Revoke
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                          {invRowError[inv.id] && (
                                            <p className="mt-2 text-xs text-red-700">
                                              {invRowError[inv.id]}
                                            </p>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  )}

                                  <form
                                    onSubmit={(e) => handleInvite(team.id, e)}
                                    className="mt-3 flex items-start gap-2"
                                  >
                                    <select
                                      value={inviteProfileId[team.id] ?? ''}
                                      onChange={(e) =>
                                        setInviteProfileId((prev) => ({
                                          ...prev,
                                          [team.id]: e.target.value,
                                        }))
                                      }
                                      className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                                    >
                                      <option value="">Select a firm member to invite…</option>
                                      {firmMembers.map((fm) => (
                                        <option key={fm.profile_id} value={fm.profile_id}>
                                          {fm.profile?.full_name ?? shortId(fm.profile_id)}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="submit"
                                      disabled={inviting[team.id] || !inviteProfileId[team.id]}
                                      className="shrink-0 rounded-md border border-slate-300 bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                                    >
                                      {inviting[team.id] ? 'Sending…' : 'Send invite'}
                                    </button>
                                  </form>
                                  {inviteError[team.id] && (
                                    <p className="mt-2 text-xs text-red-700">
                                      {inviteError[team.id]}
                                    </p>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
