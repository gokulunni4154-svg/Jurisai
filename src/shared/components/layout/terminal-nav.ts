// src/shared/components/layout/terminal-nav.ts
// NEW FILE — Terminal Navigation Isolation (audit batch 1, F1/F2/F5).
//
// PURPOSE: one explicit, separate navigation configuration per terminal,
// so the sidebar never has to *infer* which terminal's links to show from
// a mix of `role` and `firmId` (the inference that put firm links in a
// lawyer's sidebar and general-user links in a firm owner's sidebar).
//
// This file is deliberately pure (no React, no fetch, no router): it maps
// (terminal, firmId) -> NavItem[] so every terminal's links can be
// unit-tested without rendering anything. AppSidebar owns rendering.
//
// SCOPE: navigation only. This module makes no authorization decision —
// route/API/RLS enforcement is unchanged and is a separate phase.
//
// TERMINALS:
//   - 'lawyer'  -> /lawyer/*            (individual lawyer terminal)
//   - 'firm'    -> /firm/{firmId}/*     (firm terminal; firmId REQUIRED)
//   - 'general' -> /general-user/*      (general user / public portal)
//   - 'client'  -> /client              (invited client portal)
// Platform-admin and support accounts have no sidebar terminal of their
// own: their documented landing spot is the general portal (see
// resolveDashboardRedirect() in the sign-in route), so they resolve to
// 'general', exactly as before this change.

import {
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
  User,
  BadgeCheck,
  Mail,
  Bell,
  Activity,
  ListTodo,
  Search,
  MessageSquare,
  CreditCard,
  Tag,
  Building2,
  type LucideIcon,
} from 'lucide-react';

export type Terminal = 'lawyer' | 'firm' | 'general' | 'client';

/** The sidebar highlight keys accepted by AppSidebar's `active` prop. */
export type SidebarActive =
  | 'documents'
  | 'tasks'
  | 'matters'
  | 'profile'
  | 'verification'
  | 'inquiries'
  | 'inquiries-mine'
  | 'invitations'
  | 'notifications'
  | 'lawyers'
  | 'clients'
  | 'teams'
  | 'observability'
  | 'reports'
  | 'settings'
  | 'firm-tasks'
  | 'hearings'
  | 'dashboard';

export interface NavItem {
  /** Matches AppSidebar's `active` prop when this item is the current page. */
  key: SidebarActive | 'document-sets' | 'ai-assistant';
  label: string;
  href: string | null;
  icon: LucideIcon;
  comingSoon?: boolean;
}

/**
 * Account-menu entries that point at shared, terminal-less billing pages.
 * Those pages render no AppSidebar, so these keys are never an `active`
 * value; they exist only so every menu entry has a stable key.
 */
export type AccountOnlyKey = 'billing' | 'plans' | 'create-firm';

export interface AccountMenuItem {
  key: SidebarActive | AccountOnlyKey;
  label: string;
  href: string;
  icon: LucideIcon;
}

const AI_ASSISTANT: NavItem = {
  key: 'ai-assistant',
  label: 'AI Assistant',
  href: null,
  icon: Sparkles,
  comingSoon: true,
};

/**
 * Navigation items for a terminal. Every href returned here stays inside
 * that terminal's own route namespace (or is null / "Coming soon").
 *
 * `firmId` is only read for the 'firm' terminal; if it is missing there,
 * the firm items degrade to disabled "Coming soon" rather than linking to
 * a malformed `/firm/null/...` URL.
 */
export function getTerminalNav(terminal: Terminal, opts: { firmId?: string | null } = {}): NavItem[] {
  switch (terminal) {
    case 'lawyer':
      return [
        { key: 'dashboard', label: 'Dashboard', href: '/lawyer/dashboard', icon: LayoutDashboard },
        { key: 'matters', label: 'Matters', href: '/lawyer/cases', icon: Briefcase },
        { key: 'inquiries', label: 'Inquiries', href: '/lawyer/inquiries', icon: Inbox },
        {
          key: 'hearings',
          label: 'Hearings & Calendar',
          href: '/lawyer/hearings/upcoming',
          icon: CalendarClock,
        },
        { key: 'tasks', label: 'Tasks & Deadlines', href: '/lawyer/tasks', icon: CheckSquare },
        {
          key: 'document-sets',
          label: 'Document Sets',
          href: '/lawyer/document-sets',
          icon: FolderKanban,
        },
        AI_ASSISTANT,
      ];

    case 'firm': {
      const firmId = opts.firmId ?? null;
      const firmHref = (segment: string): string | null =>
        firmId ? `/firm/${firmId}/${segment}` : null;
      const disabled = !firmId;
      return [
        {
          key: 'dashboard',
          label: 'Dashboard',
          href: firmHref('dashboard'),
          icon: LayoutDashboard,
          comingSoon: disabled,
        },
        { key: 'clients', label: 'Clients', href: firmHref('clients'), icon: Users, comingSoon: disabled },
        { key: 'teams', label: 'Team', href: firmHref('teams'), icon: UserSquare2, comingSoon: disabled },
        { key: 'inquiries', label: 'Inquiries', href: firmHref('inquiries'), icon: Inbox, comingSoon: disabled },
        {
          key: 'firm-tasks',
          label: 'Firm Tasks',
          href: firmHref('tasks'),
          icon: ListTodo,
          comingSoon: disabled,
        },
        { key: 'reports', label: 'Reports', href: firmHref('reports'), icon: BarChart3, comingSoon: disabled },
        {
          key: 'observability',
          label: 'Run History',
          href: firmHref('observability'),
          icon: Activity,
          comingSoon: disabled,
        },
        { key: 'settings', label: 'Settings', href: firmHref('settings'), icon: Settings, comingSoon: disabled },
        AI_ASSISTANT,
      ];
    }

    case 'general':
      return [
        {
          key: 'dashboard',
          label: 'Dashboard',
          href: '/general-user/dashboard',
          icon: LayoutDashboard,
        },
        { key: 'documents', label: 'Documents', href: '/general-user/documents', icon: FileText },
        { key: 'lawyers', label: 'Find a Lawyer', href: '/general-user/lawyers', icon: Search },
        {
          key: 'inquiries-mine',
          label: 'My Inquiries',
          href: '/general-user/inquiries/mine',
          icon: MessageSquare,
        },
        AI_ASSISTANT,
      ];

    case 'client':
      return [{ key: 'dashboard', label: 'Dashboard', href: '/client', icon: LayoutDashboard }];
  }
}

/**
 * Account-menu (footer dropdown) navigation items, excluding "Sign out".
 * "My Profile" (/profile) is shared by every terminal; the three
 * "about me" lawyer pages exist only in the lawyer terminal. The lawyer
 * menu also carries the shared billing entries (Billing, Plans, Create
 * firm) that the lawyer dashboard/cases/hearings rails used to host.
 * Navigation only: these links grant nothing; each destination enforces
 * its own access.
 */
export function getAccountMenu(terminal: Terminal): AccountMenuItem[] {
  const items: AccountMenuItem[] = [
    { key: 'profile', label: 'My Profile', href: '/profile', icon: User },
  ];

  if (terminal === 'lawyer') {
    items.push(
      { key: 'verification', label: 'My Verification', href: '/lawyer/verification', icon: BadgeCheck },
      { key: 'invitations', label: 'My Invitations', href: '/lawyer/invitations', icon: Mail },
      { key: 'notifications', label: 'My Notifications', href: '/lawyer/notifications', icon: Bell },
      // Shared billing pages (no terminal of their own). These were
      // previously icons in three lawyer pages' inline rails and are linked
      // from nowhere else in the app, so they live here, in the lawyer's
      // account menu, rather than being dropped.
      { key: 'billing', label: 'Billing', href: '/billing/subscription', icon: CreditCard },
      { key: 'plans', label: 'Plans', href: '/pricing', icon: Tag },
      { key: 'create-firm', label: 'Create firm', href: '/billing/firms/new', icon: Building2 },
    );
  }

  return items;
}

/** The slice of GET /api/profiles/me this module needs. */
export interface TerminalProfile {
  role: string | null;
  firm_id: string | null;
}

export interface ResolvedTerminal {
  terminal: Terminal;
  firmId: string | null;
}

/**
 * Resolves a terminal from a profile, for SHARED pages that belong to no
 * single terminal (today: /profile). Pages inside a terminal's own route
 * namespace must pass their terminal to AppSidebar explicitly instead.
 *
 * Priority order is unchanged from the previous inline "Dashboard"
 * resolution in AppSidebar (lawyer, then client, then firm, then general),
 * which itself mirrors resolveDashboardRedirect() in the sign-in route:
 * lawyer is checked before firm because signUpAsLawyer() also gives every
 * lawyer a solo firm and sets profiles.firm_id.
 *
 * Known limitation (unchanged, outside this batch): `firm_id` alone does
 * not distinguish a firm owner/admin from an ordinary firm member.
 */
export function resolveTerminalFromProfile(profile: TerminalProfile): ResolvedTerminal {
  if (profile.role === 'lawyer') return { terminal: 'lawyer', firmId: null };
  if (profile.role === 'client') return { terminal: 'client', firmId: null };
  if (profile.firm_id) return { terminal: 'firm', firmId: profile.firm_id };
  return { terminal: 'general', firmId: null };
}
