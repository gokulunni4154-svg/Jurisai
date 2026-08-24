// REAL FILE PATH: src/app/invitations/page.tsx
//
// LAWYER TERMINAL — MY INVITATIONS. New page, this session, per the
// "next genuinely missing Lawyer Terminal workflow" audit.
//
// AUDIT FINDINGS (full writeup in the accompanying implementation
// report):
//   - FirmInvitationService#listPendingForCurrentUser()/acceptFromList()
//     and TeamInvitationService#listPendingForCurrentUser()/
//     acceptInvitation() (all real, pre-existing) already fully
//     implement the lawyer-facing read/accept actions on a pending
//     firm or team invitation.
//   - GET /api/invitations/firm/pending, POST
//     /api/invitations/firm/[id]/accept, GET
//     /api/invitations/team/pending, and POST
//     /api/invitations/team/[id]/accept (all real, pre-existing,
//     untouched by this change) already wire those actions up
//     end-to-end.
//   - Despite that, a full-repo search this session found ZERO frontend
//     consumer anywhere in the app for any of the four routes above —
//     there was no way for a lawyer to ever discover a pending firm or
//     team invitation in order to accept it. The only existing UI for
//     this table pair is the FIRM-ADMIN side (issuing/revoking
//     invitations from Firm Settings), a completely different surface.
//   - The one real gap at the Service layer: listPendingForCurrentUser()
//     on both services returned bare invitation rows (firm_id/
//     invited_by / team_id as raw UUIDs, no names) — useless to render.
//     This session added firmName/teamName/invitedByName enrichment to
//     both methods (firm-invitation.service.ts / team-invitation.
//     service.ts), backed by two new read-only repository dependencies
//     each (FirmRepository, ProfileRepository) wired through both
//     factories. No RLS change: both services already run on the
//     admin client (see each factory's own doc comment on why —
//     firm_invitations/team_invitations have no client-writable RLS
//     policy, and the caller isn't a firm/team member yet, so an
//     RLS-respecting client couldn't read the firm/team name either).
//
// GENUINE GAP THIS PAGE CLOSES: a real "My Invitations" inbox — list
// every pending firm and team invitation addressed to the caller, with
// an Accept action on each, wired to the (now-enriched) GET
// /api/invitations/{firm,team}/pending routes and the pre-existing
// accept routes.
//
// STYLING: matches the established Lawyer Terminal visual system —
// AppSidebar shell (same shell lawyer-inquiries/page.tsx, profile/
// page.tsx, tasks/mine/page.tsx all use), semantic tokens (border-
// border, bg-card, text-muted-foreground, bg-primary, etc.), same
// header/loading/error/empty-state markup conventions as
// lawyer-inquiries/page.tsx in particular (closest structural analog:
// a personal worklist of pending items with a single accept action).
//
// DISCOVERABILITY: added to the AppSidebar account-menu dropdown
// ("My Invitations", alongside "My Profile" / "My Verification") —
// NOT a new top-level nav item like "Inquiries" got. Reasoning:
// Inquiries are externally-driven (a client is waiting on the lawyer's
// response) and check-often by nature — app-sidebar.tsx's own comment
// on that item says so explicitly. A firm/team membership invitation
// has no external party waiting on an SLA the same way; it's a
// self-directed "status of my own account" concern, matching My
// Profile / My Verification's placement rather than Inquiries'. See
// app-sidebar.tsx's own diff.
//
// DELIBERATELY NOT ADDED:
//   - No Decline action. firm_invitations.status / team_invitations.
//     status both have a 4-value CHECK constraint (pending / accepted /
//     revoked / expired — confirmed via
//     20260806000000_create_invitations_tables.sql) with no 'declined'
//     value, and neither service has a decline method. Adding one would
//     mean a real migration (widening the CHECK constraint) plus two
//     new service methods and two new routes — out of scope for "add
//     UI to existing functionality." Flagged as real, clean follow-up
//     work in the implementation report, not invented here.
//   - No unread/pending badge on the sidebar's account-menu entry —
//     would need an extra fetch on every page's sidebar mount just to
//     compute a count; My Profile/My Verification carry no such badge
//     either, so this matches that existing (unbadged) precedent rather
//     than inventing a new one.
//   - No pagination — both list endpoints return the caller's full
//     pending set, unfiltered, with no query-param shape to page
//     through; a personal invitation inbox is not expected to be large
//     enough to need one, matching lawyer-inquiries/page.tsx's identical
//     restraint.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Bell, Briefcase, Loader2, Mail, UserSquare2 } from 'lucide-react';
import { AppSidebar } from '@/shared/components/layout/app-sidebar';
import { NotificationsPanel } from '@/shared/components/notifications/notifications-panel';

// Mirrors firm-invitation.service.ts's PendingFirmInvitation /
// team-invitation.service.ts's PendingTeamInvitation DTOs field-for-
// field — same "mirrored, not imported" convention every other client
// page in this project follows for a table with no shared client-safe
// types module (see lawyer-inquiries/page.tsx's identical posture on
// LawyerInquiryListing).
interface PendingFirmInvitation {
  id: string;
  firm_id: string;
  firmName: string;
  email: string;
  role: 'owner' | 'admin' | 'employee' | 'lawyer';
  status: string;
  invited_by: string;
  invitedByName: string | null;
  expires_at: string;
  created_at: string;
}

interface PendingTeamInvitation {
  id: string;
  team_id: string;
  teamName: string;
  firm_id: string;
  firmName: string;
  status: string;
  invited_by: string;
  invitedByName: string | null;
  expires_at: string;
  created_at: string;
}

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
  });
}

const ROLE_LABELS: Record<PendingFirmInvitation['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  employee: 'Employee',
  lawyer: 'Lawyer',
};

export default function InvitationsPage() {
  const [firmInvitations, setFirmInvitations] = useState<PendingFirmInvitation[]>([]);
  const [teamInvitations, setTeamInvitations] = useState<PendingTeamInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadInvitations = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [firmRes, teamRes] = await Promise.all([
        fetch('/api/invitations/firm/pending', { credentials: 'include' }),
        fetch('/api/invitations/team/pending', { credentials: 'include' }),
      ]);
      if (!firmRes.ok) throw new Error(await extractErrorMessage(firmRes));
      if (!teamRes.ok) throw new Error(await extractErrorMessage(teamRes));

      const firmJson = await firmRes.json();
      const teamJson = await teamRes.json();
      // Real confirmed envelope on both: { data: [...] } — see each
      // route.ts's own GET handler.
      setFirmInvitations(firmJson.data as PendingFirmInvitation[]);
      setTeamInvitations(teamJson.data as PendingTeamInvitation[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load your invitations.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInvitations();
  }, [loadInvitations]);

  async function handleAcceptFirm(id: string) {
    setActionError(null);
    setActioningId(id);
    try {
      const res = await fetch(`/api/invitations/firm/${id}/accept`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      setFirmInvitations((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not accept this invitation.');
    } finally {
      setActioningId(null);
    }
  }

  async function handleAcceptTeam(id: string) {
    setActionError(null);
    setActioningId(id);
    try {
      const res = await fetch(`/api/invitations/team/${id}/accept`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      setTeamInvitations((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not accept this invitation.');
    } finally {
      setActioningId(null);
    }
  }

  const totalCount = firmInvitations.length + teamInvitations.length;

  return (
    <div className="flex h-screen w-full bg-muted/30 font-sans text-foreground">
      <AppSidebar active="invitations" />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-background px-8 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Mail className="h-5 w-5 text-primary" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-[19px] font-semibold leading-tight text-foreground">
                My Invitations
              </h1>
              <p className="text-[12.5px] text-muted-foreground">
                Pending firm and team invitations addressed to you.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsNotificationsPanelOpen((v) => !v)}
              className="relative flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" strokeWidth={1.75} />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-destructive-foreground">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        <NotificationsPanel
          isOpen={isNotificationsPanelOpen}
          onClose={() => setIsNotificationsPanelOpen(false)}
          onUnreadCountChange={setUnreadCount}
        />

        <main className="flex-1 overflow-y-auto px-8 py-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Loading your invitations…</p>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">{loadError}</p>
              <button
                onClick={loadInvitations}
                className="text-[13px] font-medium underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-8">
              {actionError && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {actionError}
                </div>
              )}

              {totalCount === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card px-6 py-16 text-muted-foreground">
                  <Mail className="h-6 w-6" strokeWidth={1.5} />
                  <p className="text-[13px]">You don&apos;t have any pending invitations.</p>
                </div>
              ) : (
                <>
                  {/* Firm invitations */}
                  <section className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Briefcase className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                      <h2 className="text-[13.5px] font-medium text-foreground">
                        Firm invitations
                      </h2>
                      <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
                        {firmInvitations.length}
                      </span>
                    </div>

                    {firmInvitations.length === 0 ? (
                      <p className="rounded-lg border border-border bg-card px-4 py-3 text-[12.5px] text-muted-foreground">
                        No pending firm invitations.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {firmInvitations.map((invitation) => {
                          const isBusy = actioningId === invitation.id;
                          return (
                            <div
                              key={invitation.id}
                              className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card px-6 py-5"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-[13.5px] font-medium text-foreground">
                                  {invitation.firmName}
                                </p>
                                <p className="text-[12px] text-muted-foreground">
                                  Invited as {ROLE_LABELS[invitation.role]}
                                  {invitation.invitedByName ? ` by ${invitation.invitedByName}` : ''}{' '}
                                  · {formatTimestamp(invitation.created_at)}
                                </p>
                              </div>
                              <button
                                onClick={() => handleAcceptFirm(invitation.id)}
                                disabled={isBusy}
                                className="flex shrink-0 items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                Accept
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  {/* Team invitations */}
                  <section className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <UserSquare2 className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                      <h2 className="text-[13.5px] font-medium text-foreground">
                        Team invitations
                      </h2>
                      <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
                        {teamInvitations.length}
                      </span>
                    </div>

                    {teamInvitations.length === 0 ? (
                      <p className="rounded-lg border border-border bg-card px-4 py-3 text-[12.5px] text-muted-foreground">
                        No pending team invitations.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {teamInvitations.map((invitation) => {
                          const isBusy = actioningId === invitation.id;
                          return (
                            <div
                              key={invitation.id}
                              className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card px-6 py-5"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-[13.5px] font-medium text-foreground">
                                  {invitation.teamName}
                                </p>
                                <p className="text-[12px] text-muted-foreground">
                                  {invitation.firmName}
                                  {invitation.invitedByName
                                    ? ` · Invited by ${invitation.invitedByName}`
                                    : ''}{' '}
                                  · {formatTimestamp(invitation.created_at)}
                                </p>
                              </div>
                              <button
                                onClick={() => handleAcceptTeam(invitation.id)}
                                disabled={isBusy}
                                className="flex shrink-0 items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                Accept
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
