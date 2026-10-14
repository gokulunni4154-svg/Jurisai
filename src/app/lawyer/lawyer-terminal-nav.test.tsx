// Regression tests for audit batch 2, Task 1: the lawyer dashboard, cases
// (matters) and upcoming-hearings pages used to carry their own hardcoded
// icon rails that linked from the lawyer terminal into /general-user/* and
// (via /audit-log/firm's redirect) into the firm terminal. They now render
// the shared <AppSidebar terminal="lawyer" />.
//
// These tests render the REAL page components (data fetches are stubbed to
// fail, which every page handles with an error state; the sidebar does not
// depend on page data) and assert on what a user can actually click.
//
// SCOPE: navigation targets only. Nothing here asserts or implies any
// authorization behavior; each destination enforces its own access.

import fs from 'node:fs';
import path from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LawyerDashboardPage from './dashboard/page';
import MattersPage from './cases/page';
import UpcomingHearingsPage from './hearings/upcoming/page';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/lawyer/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

const PAGES = [
  {
    name: 'dashboard',
    Page: LawyerDashboardPage,
    file: 'dashboard/page.tsx',
    activeLabel: 'Dashboard',
  },
  { name: 'cases', Page: MattersPage, file: 'cases/page.tsx', activeLabel: 'Matters' },
  {
    name: 'upcoming hearings',
    Page: UpcomingHearingsPage,
    file: 'hearings/upcoming/page.tsx',
    activeLabel: 'Hearings & Calendar',
  },
] as const;

/** Every enabled lawyer-terminal nav label, in AppSidebar order. */
const LAWYER_NAV: Array<[label: string, href: string]> = [
  ['Dashboard', '/lawyer/dashboard'],
  ['Matters', '/lawyer/cases'],
  ['Inquiries', '/lawyer/inquiries'],
  ['Hearings & Calendar', '/lawyer/hearings/upcoming'],
  ['Tasks & Deadlines', '/lawyer/tasks'],
  ['Document Sets', '/lawyer/document-sets'],
];

/** Shared, terminal-less destinations the lawyer account menu may point at. */
const ACCOUNT_MENU_EXPECTED: Array<[label: RegExp, href: string]> = [
  [/My Profile/, '/profile'],
  [/My Verification/, '/lawyer/verification'],
  [/My Invitations/, '/lawyer/invitations'],
  [/My Notifications/, '/lawyer/notifications'],
  [/Billing/, '/billing/subscription'],
  [/Plans/, '/pricing'],
  [/Create firm/, '/billing/firms/new'],
];

const FORBIDDEN_PREFIXES = ['/general-user', '/firm', '/audit-log', '/client'];

beforeEach(() => {
  push.mockClear();
  // Every request fails: pages render their own error/forbidden state, and
  // AppSidebar's /api/profiles/me failure is non-fatal by design.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openAccountMenu() {
  fireEvent.click(screen.getByRole('button', { name: /View account/ }));
}

describe.each(PAGES)('lawyer $name page', ({ Page, activeLabel }) => {
  it('sidebar nav is the lawyer terminal and every target stays under /lawyer/', () => {
    render(<Page />);

    push.mockClear();
    for (const [label] of LAWYER_NAV) {
      fireEvent.click(screen.getByRole('button', { name: label }));
    }
    const targets = push.mock.calls.map((c) => c[0] as string);

    expect(targets).toEqual(LAWYER_NAV.map(([, href]) => href));
    for (const t of targets) {
      expect(t.startsWith('/lawyer/')).toBe(true);
    }
  });

  it('does not offer firm-terminal or general-user navigation entries', () => {
    render(<Page />);

    for (const other of [
      'Clients',
      'Team',
      'Firm Tasks',
      'Reports',
      'Run History',
      'Settings',
      'Documents',
      'Find a Lawyer',
      'My Inquiries',
      'Audit log',
    ]) {
      expect(screen.queryByRole('button', { name: other })).not.toBeInTheDocument();
    }
  });

  it('marks exactly its own nav item as the current page', () => {
    render(<Page />);

    const current = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-current') === 'page')
      .map((b) => b.textContent?.trim());
    expect(current).toEqual([activeLabel]);
  });

  it('keeps billing, plans and create-firm reachable from the account menu, and nothing cross-terminal', () => {
    render(<Page />);
    openAccountMenu();

    push.mockClear();
    for (const [label] of ACCOUNT_MENU_EXPECTED) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      openAccountMenu();
    }
    const targets = push.mock.calls.map((c) => c[0] as string);

    expect(targets).toEqual(ACCOUNT_MENU_EXPECTED.map(([, href]) => href));
    for (const t of targets) {
      expect(FORBIDDEN_PREFIXES.some((p) => t.startsWith(p))).toBe(false);
    }
  });

  it('keeps the notifications bell (page-local panel toggle) and sign-out', () => {
    render(<Page />);

    const bell = screen.getByRole('button', { name: 'Notifications' });
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(bell);
    expect(screen.getByRole('button', { name: 'Notifications' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    openAccountMenu();
    expect(screen.getByRole('button', { name: /Sign out/ })).toBeInTheDocument();
  });
});

// Source-level guard: the specific hardcoded-rail patterns must not come
// back. Behavioral tests above catch what renders; this catches a rail
// being re-added behind a condition that those renders do not exercise.
describe.each(PAGES)('lawyer $name page source', ({ file }) => {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  // Strip comments so the guard reads executable code, not history notes.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('uses the shared lawyer AppSidebar and has no inline <aside> rail', () => {
    expect(code).toMatch(/<AppSidebar\s+active="[a-z-]+"\s+terminal="lawyer"\s*\/>/);
    expect(code).not.toContain('<aside');
  });

  it('does not push to billing, pricing or audit-log routes itself', () => {
    expect(code).not.toMatch(/router\.push\(\s*['"`]\/(billing|pricing|audit-log)/);
  });
});
