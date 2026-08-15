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
  type LucideIcon,
} from 'lucide-react';

interface MeProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  firm_id: string | null;
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
    | 'invitations';
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

  const navItems: NavItem[] = [
    { label: 'Dashboard', href: '/lawyer', icon: LayoutDashboard },
    { label: 'Matters', href: '/cases', icon: Briefcase },
    { label: 'Inquiries', href: '/lawyer-inquiries', icon: Inbox },
    { label: 'Hearings & Calendar', href: '/hearings/upcoming', icon: CalendarClock },
    { label: 'Tasks & Deadlines', href: '/tasks/mine', icon: CheckSquare },
    { label: 'Documents', href: '/documents', icon: FileText },
    { label: 'Document Sets', href: '/document-sets', icon: FolderKanban },
    { label: 'AI Assistant', href: null, icon: Sparkles, comingSoon: true },
    { label: 'Clients', href: null, icon: Users, comingSoon: true },
    { label: 'Team', href: null, icon: UserSquare2, comingSoon: true },
    {
      label: 'Reports',
      href: firmId ? `/firm/${firmId}/reports` : null,
      icon: BarChart3,
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
            (item.href === '/documents' && active === 'documents') ||
            (item.href === '/tasks/mine' && active === 'tasks') ||
            (item.href === '/cases' && active === 'matters') ||
            (item.href === '/lawyer-inquiries' && active === 'inquiries');
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