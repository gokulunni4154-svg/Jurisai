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

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Scale,
  LayoutDashboard,
  Briefcase,
  CalendarClock,
  CheckSquare,
  FileText,
  FolderKanban,
  Inbox,
  Sparkles,
  Users,
  UserSquare2,
  BarChart3,
  Settings,
  ChevronDown,
  LogOut,
  Loader2,
  User,
  BadgeCheck,
  Mail,
  Bell,
  Activity,
  type LucideIcon,
} from 'lucide-react';

interface MeProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  firm_id: string | null;
  // NEW — General Portal Phase 1. GET /api/profiles/me already returns
  // `role` (merged in from the session's AuthUser, confirmed real
  // source — see that route's own doc comment); it just had no
  // consumer in this file before. Used below solely to resolve the
  // "Dashboard" nav item to the right home for the caller's actual
  // account type, not to gate rendering of anything.
  role: string | null;
}

interface NavItem {
  label: string;
  href: string | null;
  icon: LucideIcon;
  comingSoon?: boolean;
}

function initials(name: string | null): string {
  if (!name || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function AppSidebar({
  active,
}: {
  active:
    | 'documents'
    | 'tasks'
    | 'matters'
    | 'profile'
    | 'verification'
    | 'inquiries'
    | 'invitations'
    | 'notifications'
    | 'clients'
    | 'teams'
    | 'observability'
    | 'dashboard';
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

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

  const firmId = profile?.firm_id ?? null;

  // NEW — General Portal Phase 1. This "Dashboard" item previously
  // hardcoded '/lawyer' for every caller, regardless of account type —
  // fine for the lawyer pages that were this sidebar's only consumer
  // when it was written, but AppSidebar is also the shell
  // documents/page.tsx uses (the real landing page for 'individual'/
  // 'business' accounts today, per sign-in's own resolveDashboardRedirect()),
  // so a general user clicking "Dashboard" was being sent to a
  // lawyer-only page. Resolved the same priority order
  // resolveDashboardRedirect() itself uses (lawyer checked first, since
  // signUpAsLawyer() also creates a solo owner-role firm — see that
  // route's own doc comment for why ordering here matters), plus a
  // 'client' branch (the real, already-built /client page — see
  // src/app/client/page.tsx — had no sidebar entry point at all before
  // this change) and a firm-owner branch, falling back to the new
  // General Portal home (/dashboard, this task) for everyone else.
  const dashboardHref =
    profile?.role === 'lawyer'
      ? '/lawyer'
      : profile?.role === 'client'
        ? '/client'
        : firmId
          ? `/firm/${firmId}`
          : '/dashboard';

  const navItems: NavItem[] = [
    { label: 'Dashboard', href: dashboardHref, icon: LayoutDashboard },
    { label: 'Matters', href: '/cases', icon: Briefcase },
    { label: 'Inquiries', href: '/lawyer-inquiries', icon: Inbox },
    { label: 'Hearings & Calendar', href: '/hearings/upcoming', icon: CalendarClock },
    { label: 'Tasks & Deadlines', href: '/tasks/mine', icon: CheckSquare },
    { label: 'Documents', href: '/documents', icon: FileText },
    { label: 'Document Sets', href: '/document-sets', icon: FolderKanban },
    { label: 'AI Assistant', href: null, icon: Sparkles, comingSoon: true },
    {
      label: 'Clients',
      href: firmId ? `/firm/${firmId}/clients` : null,
      icon: Users,
      comingSoon: !firmId,
    },
    {
      label: 'Team',
      href: firmId ? `/firm/${firmId}/teams` : null,
      icon: UserSquare2,
      comingSoon: !firmId,
    },
    {
      label: 'Reports',
      href: firmId ? `/firm/${firmId}/reports` : null,
      icon: BarChart3,
      comingSoon: !firmId,
    },
    {
      label: 'Run History',
      href: firmId ? '/observability' : null,
      icon: Activity,
      comingSoon: !firmId,
    },
    {
      label: 'Settings',
      href: firmId ? `/firm/${firmId}/settings` : null,
      icon: Settings,
      comingSoon: !firmId,
    },
  ];

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    } finally {
      window.location.href = '/sign-in';
    }
  };

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-accent">
          <Scale className="h-[18px] w-[18px] text-sidebar-accent-foreground" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold leading-tight text-sidebar-foreground">
            JurisAI
          </p>
          <p className="truncate text-[11px] leading-tight text-sidebar-muted">
            AI for Legal Professionals
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
        {navItems.map((item) => {
          const isActive =
            (item.label === 'Dashboard' && active === 'dashboard') ||
            (item.href === '/documents' && active === 'documents') ||
            (item.href === '/tasks/mine' && active === 'tasks') ||
            (item.href === '/cases' && active === 'matters') ||
            (item.href === '/lawyer-inquiries' && active === 'inquiries') ||
            (item.label === 'Clients' && active === 'clients') ||
            (item.label === 'Team' && active === 'teams') ||
            (item.href === '/observability' && active === 'observability');
          const Icon = item.icon;

          if (!item.href) {
            return (
              <div
                key={item.label}
                aria-disabled="true"
                title="Coming soon"
                className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-[13.5px] text-sidebar-muted/60"
              >
                <span className="flex items-center gap-3">
                  <Icon className="h-[17px] w-[17px]" strokeWidth={1.75} />
                  {item.label}
                </span>
                {item.comingSoon && (
                  <span className="rounded-full border border-sidebar-border px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-sidebar-muted/70">
                    Soon
                  </span>
                )}
              </div>
            );
          }

          return (
            <button
              key={item.label}
              onClick={() => router.push(item.href!)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-left text-[13.5px] transition-colors ${
                isActive
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/85 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
              }`}
            >
              <Icon className="h-[17px] w-[17px]" strokeWidth={1.75} />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Footer / account */}
      <div className="relative border-t border-sidebar-border px-3 py-3">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent/50"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sidebar-accent text-[12px] font-semibold text-sidebar-accent-foreground">
            {profileLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : profile?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initials(profile?.full_name ?? null)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-sidebar-foreground">
              {profileLoading ? 'Loading…' : profile?.full_name ?? 'Your account'}
            </p>
            <p className="truncate text-[11px] text-sidebar-muted">View account</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-sidebar-muted" />
        </button>

        {menuOpen && (
          <div className="absolute bottom-[calc(100%+4px)] left-3 right-3 rounded-md border border-sidebar-border bg-sidebar shadow-lg">
            {/*
              NEW, Lawyer Profile page (this session): "View account" in the
              footer button below previously had nothing behind it -- this
              menu only ever contained "Sign out". /profile (GET/PATCH
              /api/profiles/me, both real, confirmed this session) is that
              real destination now. Kept inside this existing dropdown
              rather than adding a new top-level nav item, since the
              account menu is already the established place this kind of
              "about me" action lives (the footer button's own copy says
              "View account").
            */}
            <button
              onClick={() => {
                setMenuOpen(false);
                router.push('/profile');
              }}
              aria-current={active === 'profile' ? 'page' : undefined}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-[13px] text-sidebar-foreground/90 hover:bg-sidebar-accent/50"
            >
              <User className="h-3.5 w-3.5" strokeWidth={1.75} />
              My Profile
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                router.push('/professional-verification');
              }}
              aria-current={active === 'verification' ? 'page' : undefined}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-[13px] text-sidebar-foreground/90 hover:bg-sidebar-accent/50"
            >
              <BadgeCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
              My Verification
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                router.push('/invitations');
              }}
              aria-current={active === 'invitations' ? 'page' : undefined}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-[13px] text-sidebar-foreground/90 hover:bg-sidebar-accent/50"
            >
              <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
              My Invitations
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                router.push('/notifications');
              }}
              aria-current={active === 'notifications' ? 'page' : undefined}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-[13px] text-sidebar-foreground/90 hover:bg-sidebar-accent/50"
            >
              <Bell className="h-3.5 w-3.5" strokeWidth={1.75} />
              My Notifications
            </button>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-[13px] text-sidebar-foreground/90 hover:bg-sidebar-accent/50 disabled:opacity-50"
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