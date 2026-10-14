import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppSidebar, type AppSidebarProps } from './app-sidebar';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

type Me = { id: string; full_name: string | null; avatar_url: null; firm_id: string | null; role: string | null };
const me = (over: Partial<Me> = {}): Me => ({
  id: 'u1',
  full_name: 'Test User',
  avatar_url: null,
  firm_id: null,
  role: 'individual',
  ...over,
});

/** fetch whose /api/profiles/me response the test releases manually. */
function deferredProfile() {
  let resolve!: (profile: Me | 'fail') => void;
  const pending = new Promise<Response>((res) => {
    resolve = (profile) =>
      res(
        profile === 'fail'
          ? ({ ok: false, json: async () => ({}) } as Response)
          : ({ ok: true, json: async () => ({ data: profile }) } as Response),
      );
  });
  vi.stubGlobal('fetch', vi.fn(() => pending));
  return resolve;
}

function immediateProfile(profile: Me) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ data: profile }) }) as Response),
  );
}

/** Clicks every enabled nav button; returns the router.push targets in order. */
function clickAllNav(labels: string[]): string[] {
  push.mockClear();
  for (const label of labels) fireEvent.click(screen.getByRole('button', { name: label }));
  return push.mock.calls.map((c) => c[0] as string);
}

const NAV_BUTTON_LABELS = {
  lawyer: ['Dashboard', 'Matters', 'Inquiries', 'Hearings & Calendar', 'Tasks & Deadlines', 'Document Sets'],
  firm: ['Dashboard', 'Clients', 'Team', 'Firm Tasks', 'Reports', 'Run History', 'Settings'],
  general: ['Dashboard', 'Documents', 'Find a Lawyer', 'My Inquiries'],
};

const ALL_LABELS = [...new Set(Object.values(NAV_BUTTON_LABELS).flat()), 'Dashboard'];

beforeEach(() => push.mockClear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSidebar(props: AppSidebarProps) {
  return render(
    <div style={{ height: 600 }}>
      <AppSidebar {...props} />
    </div>,
  );
}

function openAccountMenu() {
  fireEvent.click(screen.getByRole('button', { name: /View account/ }));
}

describe('AppSidebar — explicit terminal renders instantly and never changes', () => {
  it('lawyer: nav is present BEFORE the profile fetch resolves, with only /lawyer/* targets', () => {
    deferredProfile(); // never resolved in this test
    renderSidebar({ active: 'matters', terminal: 'lawyer' });

    expect(screen.queryByTestId('sidebar-nav-loading')).not.toBeInTheDocument();
    const targets = clickAllNav(NAV_BUTTON_LABELS.lawyer);
    expect(targets).toEqual([
      '/lawyer/dashboard',
      '/lawyer/cases',
      '/lawyer/inquiries',
      '/lawyer/hearings/upcoming',
      '/lawyer/tasks',
      '/lawyer/document-sets',
    ]);
  });

  it('lawyer with a solo-firm firm_id (F1): NO firm links appear, before or after the profile loads', async () => {
    const release = deferredProfile();
    renderSidebar({ active: 'dashboard', terminal: 'lawyer' });
    for (const firmLabel of ['Clients', 'Team', 'Firm Tasks', 'Reports', 'Run History', 'Settings']) {
      expect(screen.queryByText(firmLabel)).not.toBeInTheDocument();
    }

    release(me({ role: 'lawyer', firm_id: 'solo-firm-1', full_name: 'Adv Rao' }));
    await waitFor(() => expect(screen.getByText('Adv Rao')).toBeInTheDocument());

    for (const firmLabel of ['Clients', 'Team', 'Firm Tasks', 'Reports', 'Run History', 'Settings']) {
      expect(screen.queryByText(firmLabel)).not.toBeInTheDocument();
    }
    expect(screen.queryByText('Documents')).not.toBeInTheDocument();
    expect(screen.queryByText('Find a Lawyer')).not.toBeInTheDocument();
  });

  it('firm (F2): /firm/{firmId}/* targets from the prop, and NO general-user links', async () => {
    const release = deferredProfile();
    renderSidebar({ active: 'clients', terminal: 'firm', firmId: 'f-9' });

    const targets = clickAllNav(NAV_BUTTON_LABELS.firm);
    expect(targets).toEqual([
      '/firm/f-9/dashboard',
      '/firm/f-9/clients',
      '/firm/f-9/teams',
      '/firm/f-9/tasks',
      '/firm/f-9/reports',
      '/firm/f-9/observability',
      '/firm/f-9/settings',
    ]);
    for (const generalLabel of ['Documents', 'Find a Lawyer', 'My Inquiries']) {
      expect(screen.queryByText(generalLabel)).not.toBeInTheDocument();
    }

    // A profile whose own firm_id/role disagree must not change the firm nav.
    release(me({ role: 'lawyer', firm_id: 'some-other-firm' }));
    await waitFor(() => expect(screen.getByText('Test User')).toBeInTheDocument());
    expect(clickAllNav(['Dashboard'])).toEqual(['/firm/f-9/dashboard']);
  });

  it('general: /general-user/* targets only; no lawyer or firm items (even disabled ones)', () => {
    deferredProfile();
    renderSidebar({ active: 'documents', terminal: 'general' });

    expect(clickAllNav(NAV_BUTTON_LABELS.general)).toEqual([
      '/general-user/dashboard',
      '/general-user/documents',
      '/general-user/lawyers',
      '/general-user/inquiries/mine',
    ]);
    for (const other of ['Matters', 'Tasks & Deadlines', 'Clients', 'Team', 'Reports', 'Settings']) {
      expect(screen.queryByText(other)).not.toBeInTheDocument();
    }
  });

  it('client: a single Dashboard item pointing at /client', () => {
    deferredProfile();
    renderSidebar({ active: 'dashboard', terminal: 'client' });

    expect(clickAllNav(['Dashboard'])).toEqual(['/client']);
    for (const other of ['Documents', 'Find a Lawyer', 'Matters', 'Clients']) {
      expect(screen.queryByText(other)).not.toBeInTheDocument();
    }
  });

  it('marks the active item with aria-current', () => {
    deferredProfile();
    renderSidebar({ active: 'tasks', terminal: 'lawyer' });
    expect(screen.getByRole('button', { name: 'Tasks & Deadlines' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Matters' })).not.toHaveAttribute('aria-current');
  });

  it('AI Assistant is disabled and never navigates', () => {
    deferredProfile();
    renderSidebar({ active: 'dashboard', terminal: 'general' });
    const ai = screen.getByText('AI Assistant').closest('[aria-disabled="true"]');
    expect(ai).not.toBeNull();
    fireEvent.click(ai as Element);
    expect(push).not.toHaveBeenCalled();
  });
});

describe('AppSidebar — shared page with no terminal (/profile) resolves from the profile (F5)', () => {
  it('shows a link-free skeleton while loading — no Dashboard link to click yet', () => {
    deferredProfile();
    renderSidebar({ active: 'profile' });

    expect(screen.getByTestId('sidebar-nav-loading')).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toHaveAttribute('aria-busy', 'true');
    for (const label of ALL_LABELS) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });

  it('lawyer (with a solo firm_id) resolves to the lawyer terminal once loaded', async () => {
    const release = deferredProfile();
    renderSidebar({ active: 'profile' });
    release(me({ role: 'lawyer', firm_id: 'solo-firm-1' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Matters' })).toBeInTheDocument());
    expect(screen.queryByTestId('sidebar-nav-loading')).not.toBeInTheDocument();
    expect(clickAllNav(['Dashboard'])).toEqual(['/lawyer/dashboard']);
    expect(screen.queryByText('Clients')).not.toBeInTheDocument();
  });

  it('firm member resolves to the firm terminal using the profile firm_id', async () => {
    immediateProfile(me({ role: 'individual', firm_id: 'f-7' }));
    renderSidebar({ active: 'profile' });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Clients' })).toBeInTheDocument());
    expect(clickAllNav(['Dashboard'])).toEqual(['/firm/f-7/dashboard']);
    expect(screen.queryByText('Documents')).not.toBeInTheDocument();
  });

  it('general user resolves to the general terminal', async () => {
    immediateProfile(me({ role: 'individual', firm_id: null }));
    renderSidebar({ active: 'profile' });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Documents' })).toBeInTheDocument());
    expect(clickAllNav(['Dashboard'])).toEqual(['/general-user/dashboard']);
  });

  it('client resolves to a client-only nav', async () => {
    immediateProfile(me({ role: 'client', firm_id: 'f-1' }));
    renderSidebar({ active: 'profile' });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Dashboard' })).toBeInTheDocument());
    expect(clickAllNav(['Dashboard'])).toEqual(['/client']);
    expect(screen.queryByText('Documents')).not.toBeInTheDocument();
    expect(screen.queryByText('Clients')).not.toBeInTheDocument();
  });

  it.each(['admin', 'support'])('platform %s (no firm) keeps the general-portal nav, as before', async (role) => {
    immediateProfile(me({ role, firm_id: null }));
    renderSidebar({ active: 'profile' });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Documents' })).toBeInTheDocument());
    expect(clickAllNav(['Dashboard'])).toEqual(['/general-user/dashboard']);
    expect(screen.queryByText('Matters')).not.toBeInTheDocument();
  });

  it('a failed profile fetch leaves the nav empty rather than guessing a terminal', async () => {
    const release = deferredProfile();
    renderSidebar({ active: 'profile' });
    release('fail');

    await waitFor(() => expect(screen.queryByTestId('sidebar-nav-loading')).not.toBeInTheDocument());
    for (const label of ALL_LABELS) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    // Shell still works: account menu + sign-out remain available.
    openAccountMenu();
    expect(screen.getByRole('button', { name: /My Profile/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign out/ })).toBeInTheDocument();
  });
});

describe('AppSidebar — account menu per terminal', () => {
  it('lawyer: profile, verification, invitations, notifications, billing pages, sign out', () => {
    deferredProfile();
    renderSidebar({ active: 'dashboard', terminal: 'lawyer' });
    openAccountMenu();

    push.mockClear();
    for (const label of [
      /My Profile/,
      /My Verification/,
      /My Invitations/,
      /My Notifications/,
      /Billing/,
      /Plans/,
      /Create firm/,
    ]) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      openAccountMenu();
    }
    expect(push.mock.calls.map((c) => c[0])).toEqual([
      '/profile',
      '/lawyer/verification',
      '/lawyer/invitations',
      '/lawyer/notifications',
      '/billing/subscription',
      '/pricing',
      '/billing/firms/new',
    ]);
    expect(screen.getByRole('button', { name: /Sign out/ })).toBeInTheDocument();
  });

  it.each([
    ['firm', { active: 'dashboard', terminal: 'firm', firmId: 'f-1' } as AppSidebarProps],
    ['general', { active: 'dashboard', terminal: 'general' } as AppSidebarProps],
    ['client', { active: 'dashboard', terminal: 'client' } as AppSidebarProps],
  ])('%s: only My Profile and Sign out (no lawyer-only pages)', (_name, props) => {
    deferredProfile();
    renderSidebar(props);
    openAccountMenu();

    expect(screen.getByRole('button', { name: /My Profile/ })).toBeInTheDocument();
    for (const lawyerOnly of [
      /My Verification/,
      /My Invitations/,
      /My Notifications/,
      /Billing/,
      /Plans/,
      /Create firm/,
    ]) {
      expect(screen.queryByRole('button', { name: lawyerOnly })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /Sign out/ })).toBeInTheDocument();
  });

  it('sign-out posts to /api/auth/sign-out (behavior preserved)', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === '/api/profiles/me'
        ? ({ ok: true, json: async () => ({ data: me() }) } as Response)
        : ({ ok: true, json: async () => ({}) } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    // jsdom's window.location is read-only; replace it so the redirect is observable.
    const original = window.location;
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true, configurable: true });

    renderSidebar({ active: 'dashboard', terminal: 'general' });
    openAccountMenu();
    fireEvent.click(screen.getByRole('button', { name: /Sign out/ }));

    await waitFor(() => expect(window.location.href).toBe('/sign-in'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    Object.defineProperty(window, 'location', { value: original, writable: true, configurable: true });
  });
});
