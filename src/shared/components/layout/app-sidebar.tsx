// src/shared/components/layout/app-sidebar.tsx
// NEW FILE — Documents page task, this session.
//
// FIRST SHARED APP SHELL IN THE PROJECT. Every existing page
// (documents/page.tsx, (dashboard)/lawyer/page.tsx, etc.) has its own
// inline layout — documents/page.tsx's own header comment flags this
// exact gap ("this rail is inline JSX in this one page... a real fix
// would touch working code well beyond one button"). This component is
// that real fix, scoped to what this task asked for: a real, labeled
// navy sidebar to host the Documents page. It is intentionally NOT
// wired into any other existing page in this change — only
// documents/page.tsx imports it — so nothing else gets redesigned.
//
// NAV ITEMS — SOURCE-VERIFIED AGAINST ACTUAL ROUTES IN THIS REPO.
// Re-verified during the Documents workspace inspection task (this
// session, `find src/app -maxdepth 4 -type d`). Only routes that really
// exist are clickable:
//   - Dashboard        -> /lawyer                (real: (dashboard)/lawyer/page.tsx)
//   - Matters             -> /cases               (real: src/app/cases/page.tsx —
//     landed in the "integrate lawyer matters page" commit, which merged
//     to main BEFORE this sidebar was authored; the original "no list
//     route exists" note above was already stale the moment this file
//     was written. Fixed during the Documents inspection task rather than
//     left pointing at a disabled "Coming soon" state for a page that has
//     existed the whole time.)
//   - Hearings & Calendar -> /hearings/upcoming   (real)
//   - Tasks & Deadlines   -> /tasks/mine          (real)
//   - Documents           -> /documents           (real, this page)
//   - Document Sets       -> /document-sets       (real — closest existing
//     equivalent to the reference image's "Legal Research"; relabeled
//     honestly rather than pointing "Legal Research" at the wrong page)
//   - Reports / Settings  -> /firm/{firmId}/reports and /firm/{firmId}/settings
//     ONLY when the caller's profile has a firm_id (firm-scoped routes,
//     can't be linked without one). Disabled otherwise.
// AI Assistant, Clients, and Team still have NO corresponding page
// anywhere in this repo (confirmed again this session: no ai-assistant
// route, no clients/team pages beyond nested firm APIs with no frontend).
// Per the brief's own rule ("use a disabled/coming-soon state, or leave
// it out") these still render disabled with a "Coming soon" label rather
// than linking to something that 404s or silently doing nothing.
//
// DATA: fetches GET /api/profiles/me (confirmed real route, this
// session) for the footer name/avatar/firm_id. Sign-out posts to
// POST /api/auth/sign-out (confirmed real route via `find`) and hard-
// navigates to /sign-in on success, since there's no shared auth-context
// hook anywhere in this project to invalidate client-side otherwise.
//
// AMENDMENT -- Lawyer Profile page task, later session: `active` widened
// to also accept 'profile', and the account-menu dropdown (previously
// "Sign out" only) gained a "My Profile" item pointing at the new
// /profile page. The footer button's own label ("View account") named a
// destination that never existed anywhere in this repo until this
// change -- confirmed via full-repo search this session (no
// profile/account/settings page other than firm-scoped Settings).
//
// AMENDMENT -- My Verification page task, later session: `active`
// widened again to also accept 'verification', and a "My Verification"
// item added to the same account-menu dropdown, directly below "My
// Profile". Same reasoning as that earlier amendment: GET/POST
// /api/professional-verification/me (both real, pre-existing) had no
// frontend consumer anywhere in the repo -- the only page under
// professional-verification/ was the admin review queue, a different
// surface entirely. This is the same class of "about me" action as "My
// Profile", so it lives in the same menu rather than becoming a new
// top-level nav item.
//
// AMENDMENT -- My Inquiries page task, later session: `active` widened
// again to also accept 'inquiries', and a real "Inquiries" top-level nav
// item added (between Matters and Hearings & Calendar), replacing what
// was previously nothing -- there was no "Inquiries"/"Contact requests"
// entry anywhere in this list before. Unlike My Profile/My Verification,
// this is NOT placed in the account dropdown: accepting/declining/
// converting an inquiry is a regular worklist action a lawyer checks
// often, not an "about me" settings page, so it gets its own top-level
// item like Matters/Tasks/Documents do. Points at /lawyer-inquiries
// (new page, this session) -- GET /api/lawyer-inquires (new route, this
// session) backs it.
//
// AMENDMENT -- My Invitations page task, later session: `active` widened
// again to also accept 'invitations', and a "My Invitations" item added
// to the account-menu dropdown, directly below "My Verification". Same
// reasoning as the My Profile/My Verification amendments above, NOT the
// Inquiries one: GET /api/invitations/firm/pending and GET
// /api/invitations/team/pending (both real, pre-existing) had no
// frontend consumer anywhere in the repo -- a pending firm/team
// invitation is a "status of my own account" concern with no external
// party waiting on it, unlike an inquiry, so it belongs in the same
// "about me" menu as My Profile/My Verification rather than becoming a
// fourth top-level item. Points at /invitations (new page, this
// session).
//
// AMENDMENT -- My Notifications page task, later session: `active`
// widened again to also accept 'notifications', and a "My
// Notifications" item added to the account-menu dropdown, directly
// below "My Invitations". Same reasoning as that amendment: GET
// /api/notifications already supports limit/offset/unreadOnly (real,
// pre-existing) but had no full-history frontend consumer anywhere in
// the repo -- only the dropdown panel below, hardcoded to the 20 most
// recent. A notification is the same "status of my own account" class
// of concern as My Profile/My Verification/My Invitations, not an
// externally-driven worklist like Inquiries, so it goes in the same
// menu rather than becoming a fifth top-level item. Points at
// /notifications (new page, this session).
//
// AMENDMENT -- Firm Terminal Clients workspace task, later session:
// `active` widened again to also accept 'clients'. The "Clients" item
// (previously always disabled/"Coming soon", per this file's own
// original nav-items comment above) now links to
// /firm/{firmId}/clients -- new page, this same change -- whenever the
// caller has a firm_id, identical gating to the existing
// Reports/Settings items just above it in navItems (all three are
// firm-scoped routes that can't be linked without one). Not moved to
// the account-menu dropdown: like Reports/Settings, this is firm-wide
// administration a firm owner/admin returns to routinely, not an
// "about me" concern, so it stays a top-level item in its existing
// position.
//
// AMENDMENT -- Firm Terminal Teams/Team Management workspace task,
// later session: `active` widened again to also accept 'teams'. The
// "Team" item (previously always disabled/"Coming soon" -- this file's
// own original nav-items comment above explicitly reserved this exact
// label for the real, distinct teams/team_members subsystem once it
// existed) now links to /firm/{firmId}/teams (new page, this same
// change) whenever the caller has a firm_id -- identical gating to
// Clients/Reports/Settings just above/below it. EXISTING BACKEND, NO
// GAP: TeamService/TeamMemberService/TeamInvitationService and every
// route under /api/firms/[id]/teams, /api/teams/[id]/invitations, and
// /api/invitations/team were already fully built and owner/admin- or
// firm-member-authorized -- confirmed via a full audit of current main
// and the live Supabase project this session. This nav change plus the
// new page are the only missing layer.
//
// AMENDMENT -- My Sent Inquiries (General User Terminal, "what happened
// to the inquiry I sent" task), later session: `active` widened again
// to also accept 'inquiries-mine', and a real "My Inquiries" top-level
// nav item added (directly below "Find a Lawyer"), pointing at
// /inquiries/mine (new page, this same change). EXISTING BACKEND, NO
// GAP AT THE DATA LAYER BUT A REAL GAP EVERYWHERE ELSE: a General User
// could already SEND an inquiry (existing Contact-a-Lawyer flow,
// documents/[id]/page.tsx) but had no way to see it afterward -- there
// was no repository method, no service method, and no route for a
// sender-scoped read before this change (only listForTargetProfile()/
// listMyInquiries(), the LAWYER-scoped read, existed). Deliberately kept
// as its OWN nav item and OWN `active` value, not merged into the
// existing "Inquiries" item a few lines below (which points a LAWYER at
// /lawyer-inquiries, a different query -- assigned-to-me, not sent-by-
// me -- over the same table): merging them would mean the same nav
// label silently means two different things depending on account type,
// which is exactly the kind of ambiguity this file's own "Dashboard"
// item had to work around with resolveDashboardRedirect()-style
// branching. Two distinct, always-visible items are clearer than one
// role-branching one here, since (unlike Dashboard) a single account
// could plausibly want to see both lists.
//
// AMENDMENT -- Find a Lawyer (General User Terminal, standalone lawyer
// directory task), later session: `active` widened again to also accept
// 'lawyers', and a real "Find a Lawyer" top-level nav item added
// (between Documents and Document Sets). EXISTING BACKEND, NO GAP: GET
// /api/lawyers (LawyerDirectoryService#listVerifiedLawyers(), confirmed
// real source this session) already existed with zero frontend consumer
// anywhere in the repo -- the only thing that read it was this exact
// gap. Not gated on firmId or role -- unlike Clients/Team/Reports/
// Settings, this is not firm-scoped, and every account type (general
// user, lawyer, firm member) benefits from being able to browse the
// directory, so it always renders as a real, clickable item rather than
// a conditionally-disabled one.
//
// AMENDMENT -- Firm Terminal Observability / Run History integration
// task, later session: `active` widened again to also accept
// 'observability'. EXISTING PAGE + BACKEND, NO GAP: /observability
// (firm-owner view) and /observability/admin (platform-admin view),
// their two API routes, and ObservabilityService -- including its own
// firm-membership-verified authorization (see that file's own "SECURITY
// FIX" doc comment -- a real cross-firm data leak found and closed in an
// earlier session, unrelated to this task) -- were all already fully
// built with zero navigation entry anywhere in the repo -- the exact gap
// a prior repository audit flagged. This nav item, pointing at the
// existing `/observability` page, is the only change this task makes;
// the page itself is not touched. Not firm-scoped in the URL the way
// Clients/Team/Reports/Settings are (`/firm/{firmId}/...`) --
// ObservabilityService#getFirmRunHistory resolves the caller's own firm
// server-side from their profile, never from a URL param -- but still
// gated on `firmId` presence here for the same UX reason those four
// items are: a personal-organization caller (no firm_id) would only hit
// a NotFoundError from the service, so the item degrades to "Coming
// soon" instead of linking to a page that just errors. Deliberately NOT
// placed in the account-menu dropdown with My Profile/My Notifications/
// etc. -- run history is firm-wide administration a firm owner/admin
// returns to routinely, the same class of concern as Reports/Settings,
// not an "about me" page. /observability/admin (the separate
// platform-admin, all-firms view, requireRole('admin') only) gets NO nav
// entry, matching this project's existing precedent for platform-admin-
// only surfaces (audit-log/admin/page.tsx is reachable only by direct
// URL too, never linked from this sidebar) -- adding one here would
// expose a platform-admin link to every ordinary firm user, which is
// out of this task's Firm Terminal scope regardless.
//
// AMENDMENT -- Terminal Navigation Isolation (audit batch 1, F1/F2/F5):
// the sidebar no longer INFERS which terminal's links to show from a mix
// of `role` and `firmId` (that inference put /firm/{id}/* links in every
// lawyer's sidebar -- signUpAsLawyer() gives each lawyer a solo firm and
// sets profiles.firm_id -- and /general-user/* links in every firm
// owner's and client's sidebar). Navigation now comes from ONE explicit
// per-terminal config in ./terminal-nav.ts, selected by a `terminal`
// prop that each page passes (a page's terminal is known from its own
// route namespace; it is not a role question). `firmId` is required with
// terminal="firm" and comes from the page's route param, never from the
// profile fetch.
//
// LOADING (F5): when `terminal` is passed, the nav renders immediately
// and never waits for, or changes after, GET /api/profiles/me -- the
// fetch now only fills the footer name/avatar. When `terminal` is
// OMITTED (shared pages that belong to no terminal, today only /profile)
// the terminal is resolved from the profile, and until it loads the nav
// shows a neutral skeleton with NO links, so a lawyer can no longer
// click a "Dashboard" that briefly pointed at the general portal. If
// that fetch fails on such a page the nav stays empty (footer/account
// menu still work) rather than guessing a terminal.
//
// UNCHANGED: shell, brand, footer, account menu behavior, sign-out. This
// change makes no authorization decision; route/API/RLS enforcement is a
// separate phase.

'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Scale, ChevronDown, LogOut, Loader2 } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';

import {
  getAccountMenu,
  getTerminalNav,
  resolveTerminalFromProfile,
  type ResolvedTerminal,
  type SidebarActive,
} from './terminal-nav';

interface MeProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  firm_id: string | null;
  // GET /api/profiles/me merges the session's role into the profile. Used
  // ONLY on shared pages (no `terminal` prop) to resolve a terminal.
  role: string | null;
}

function initials(name: string | null): string {
  if (!name || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/**
 * `terminal` is explicit for every page inside a terminal's route
 * namespace. Omit it only on shared pages (e.g. /profile), where it is
 * resolved from the signed-in profile instead.
 */
export type AppSidebarProps = { active: SidebarActive } & (
  | { terminal?: undefined; firmId?: undefined }
  | { terminal: 'lawyer' | 'general' | 'client'; firmId?: undefined }
  | { terminal: 'firm'; firmId: string }
) & {
    /**
     * Desktop collapse state, controlled by <AppShell>. `undefined` keeps
     * the legacy fixed-width (w-64) sidebar used by pages that have not
     * migrated to <AppShell> yet. Below the `md` breakpoint the sidebar
     * always renders expanded (it becomes the horizontal nav strip), so
     * every collapsed-only class below is `md:`-prefixed.
     */
    collapsed?: boolean;
  };

/**
 * Shows a right-hand tooltip with `label` only while the sidebar is collapsed
 * (icon-only). Expanded items already show their text. The wrapped element must
 * accept a ref + props (Link / button do). Carries its own provider so the
 * sidebar also works when rendered outside AppShell.
 */
function CollapsedTooltip({
  enabled,
  label,
  children,
}: {
  enabled: boolean;
  label: string;
  children: ReactElement;
}) {
  if (!enabled) return children;
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="right" className="hidden md:block">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AppSidebar(props: AppSidebarProps) {
  const { active } = props;
  const collapsed = props.collapsed === true;
  const router = useRouter();
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const footerRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);

  // Account menu: close on Escape (returning focus to its trigger) and on
  // an outside pointer press.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        accountButtonRef.current?.focus();
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      if (footerRef.current && !footerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/profiles/me', { credentials: 'include' });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setProfile(json.data as MeProfile);
      } catch {
        // Footer degrades to a generic state below — not fatal to the page.
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Explicit terminal wins and is available on the very first render.
  // Only shared pages fall back to resolving from the fetched profile.
  const resolved: ResolvedTerminal | null =
    props.terminal !== undefined
      ? { terminal: props.terminal, firmId: props.terminal === 'firm' ? props.firmId : null }
      : profile
        ? resolveTerminalFromProfile(profile)
        : null;

  const navPending = resolved === null && profileLoading;
  const navItems = resolved ? getTerminalNav(resolved.terminal, { firmId: resolved.firmId }) : [];
  // Until a terminal is known the account menu offers only the shared
  // "My Profile" entry (same output as the general terminal's menu).
  const accountItems = getAccountMenu(resolved?.terminal ?? 'general');

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    } finally {
      window.location.href = '/sign-in';
    }
  };

  return (
    <aside
      className={`flex h-full shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 motion-reduce:transition-none [&_:focus-visible]:ring-sidebar-ring [&_:focus-visible]:ring-offset-sidebar ${
        props.collapsed === undefined ? 'w-64' : collapsed ? 'w-sidebar-collapsed' : 'w-sidebar'
      }`}
    >
      {/* Brand */}
      <div className={`flex items-center gap-2.5 px-5 py-5 ${collapsed ? 'md:justify-center md:px-0' : ''}`}>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-accent">
          <Scale className="h-[18px] w-[18px] text-sidebar-accent-foreground" strokeWidth={1.75} />
        </div>
        <div className={`min-w-0 ${collapsed ? 'md:hidden' : ''}`}>
          <p className="truncate text-body font-semibold leading-tight text-sidebar-foreground">
            JurisAI
          </p>
          <p className="truncate text-caption leading-tight text-sidebar-muted">
            AI for Legal Professionals
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav
        className={`flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2 ${collapsed ? 'md:px-2' : ''}`}
        aria-busy={navPending ? 'true' : undefined}
      >
        {navPending && (
          <div data-testid="sidebar-nav-loading" className="flex flex-col gap-2 px-3 py-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-4 w-full animate-pulse rounded bg-sidebar-accent/40" />
            ))}
          </div>
        )}
        {navItems.map((item) => {
          const isActive = item.key === active;
          const Icon = item.icon;

          if (!item.href) {
            return (
              <div
                key={item.key}
                aria-disabled="true"
                title="Coming soon"
                className={`flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-ui text-sidebar-muted/60 ${collapsed ? 'md:justify-center md:px-0' : ''}`}
              >
                <span className="flex items-center gap-3">
                  <Icon className="h-[17px] w-[17px]" strokeWidth={1.75} />
                  <span className={collapsed ? 'md:sr-only' : undefined}>{item.label}</span>
                </span>
                {item.comingSoon && (
                  <span className={`rounded-full border border-sidebar-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sidebar-muted/70 ${collapsed ? 'md:hidden' : ''}`}>
                    Soon
                  </span>
                )}
              </div>
            );
          }

          return (
            <CollapsedTooltip key={item.key} enabled={collapsed} label={item.label}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-left text-ui transition-colors ${collapsed ? 'md:justify-center md:px-0' : ''} ${
                  isActive
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/85 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                }`}
              >
                <Icon className="h-[17px] w-[17px]" strokeWidth={1.75} />
                <span className={collapsed ? 'md:sr-only' : undefined}>{item.label}</span>
              </Link>
            </CollapsedTooltip>
          );
        })}
      </nav>

      {/* Footer / account */}
      <div ref={footerRef} className={`relative border-t border-sidebar-border px-3 py-3 ${collapsed ? 'md:px-2' : ''}`}>
        <CollapsedTooltip enabled={collapsed} label="Account">
          <button
            ref={accountButtonRef}
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="account-menu"
            className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent/50 ${collapsed ? 'md:justify-center md:px-0' : ''}`}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sidebar-accent text-caption font-semibold text-sidebar-accent-foreground">
              {profileLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                initials(profile?.full_name ?? null)
              )}
            </div>
            <div className={`min-w-0 flex-1 ${collapsed ? 'md:hidden' : ''}`}>
              <p className="truncate text-meta font-medium text-sidebar-foreground">
                {profileLoading ? 'Loading…' : profile?.full_name ?? 'Your account'}
              </p>
              <p className="truncate text-caption text-sidebar-muted">View account</p>
            </div>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-sidebar-muted ${collapsed ? 'md:hidden' : ''}`} />
          </button>
        </CollapsedTooltip>

        {menuOpen && (
          <div
            id="account-menu"
            role="group"
            aria-label="Account"
            className={`fixed bottom-20 left-4 right-4 z-50 max-h-[70dvh] overflow-y-auto rounded-md border border-sidebar-border bg-sidebar shadow-popover md:absolute md:bottom-[calc(100%+4px)] md:left-3 md:max-h-[min(70dvh,32rem)] ${
              collapsed ? 'md:right-auto md:z-50 md:w-60' : 'md:right-3 md:z-auto'
            }`}
          >
            {accountItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    setMenuOpen(false);
                    router.push(item.href);
                  }}
                  aria-current={active === item.key ? 'page' : undefined}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-meta text-sidebar-foreground/90 hover:bg-sidebar-accent/50"
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {item.label}
                </button>
              );
            })}
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-meta text-sidebar-foreground/90 hover:bg-sidebar-accent/50 disabled:opacity-50"
            >
              {signingOut ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              Sign out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
