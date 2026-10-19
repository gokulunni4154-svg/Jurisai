import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from './app-shell';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const setTheme = vi.fn();
let currentTheme: string | undefined = 'system';
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: currentTheme, setTheme }),
}));

const STORAGE_KEY = 'jurisai.sidebar.collapsed';

// Radix tooltips measure with ResizeObserver, which jsdom does not provide.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  push.mockClear();
  setTheme.mockClear();
  currentTheme = 'system';
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ data: { id: 'u1', full_name: 'Test User', avatar_url: null, firm_id: null, role: 'individual' } }) }) as Response),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AppShell', () => {
  it('renders children and keeps the sidebar nav for the given terminal', () => {
    render(
      <AppShell active="tasks" terminal="lawyer">
        <p>page body</p>
      </AppShell>,
    );
    expect(screen.getByText('page body')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tasks & Deadlines' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Individual Lawyer Terminal')).toBeInTheDocument();
  });

  it('forwards firmId so firm nav links still come from the route param', () => {
    render(
      <AppShell active="dashboard" terminal="firm" firmId="firm-123">
        <p>x</p>
      </AppShell>,
    );
    expect(screen.getByRole('link', { name: 'Team' }).getAttribute('href')).toContain('/firm/firm-123/');
  });

  it('uses h-dvh (not h-screen) so legacy responsive selectors never match the shell', () => {
    const { container } = render(
      <AppShell active="tasks" terminal="lawyer">
        <p>x</p>
      </AppShell>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-app-shell');
    expect(root.className).toContain('h-dvh');
    expect(root.className).not.toContain('h-screen');
  });

  it('content column is the positioned ancestor for sidebar-anchored overlays (notifications panel)', () => {
    const { container } = render(
      <AppShell active="tasks" terminal="lawyer">
        <p>x</p>
      </AppShell>,
    );
    const column = container.querySelector('[data-app-shell] > div') as HTMLElement;
    expect(column.className).toContain('relative');
  });

  it('collapse toggle has an accessible name, flips aria-expanded and persists', async () => {
    render(
      <AppShell active="tasks" terminal="lawyer">
        <p>x</p>
      </AppShell>,
    );
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
    // Nav labels stay in the accessible tree and gain a tooltip when collapsed
    // (Radix tooltip on focus; no native `title`, which would double up).
    const tasksLink = screen.getByRole('link', { name: 'Tasks & Deadlines' });
    expect(tasksLink).not.toHaveAttribute('title');
    fireEvent.focus(tasksLink);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Tasks & Deadlines');
  });

  it('restores a persisted collapsed state after mount', async () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    render(
      <AppShell active="tasks" terminal="lawyer">
        <p>x</p>
      </AppShell>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument());
  });

  it('stays usable when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(
      <AppShell active="tasks" terminal="lawyer">
        <p>x</p>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('theme switcher marks the active theme and sets the chosen one', async () => {
    currentTheme = 'light';
    render(
      <AppShell active="tasks" terminal="lawyer">
        <p>x</p>
      </AppShell>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Light theme' })).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Dark theme' }));
    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('account menu closes on Escape and on outside press, and exposes aria-expanded', async () => {
    render(
      <AppShell active="tasks" terminal="lawyer">
        <p>x</p>
      </AppShell>,
    );
    const account = await screen.findByRole('button', { name: /Test User/ });
    expect(account).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(account);
    expect(account).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    fireEvent.click(account);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('skip link moves focus to the page main landmark', async () => {
    render(
      <AppShell active="tasks" terminal="lawyer">
        <main>
          <p>content</p>
        </main>
      </AppShell>,
    );
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    fireEvent.click(skip);
    expect(document.activeElement).toBe(screen.getByRole('main'));
    await screen.findByRole('button', { name: /Test User/ });
  });

  it('account menu trigger points at the menu it controls', async () => {
    render(
      <AppShell active="tasks" terminal="lawyer">
        <p>x</p>
      </AppShell>,
    );
    const account = await screen.findByRole('button', { name: /Test User/ });
    expect(account).toHaveAttribute('aria-controls', 'account-menu');
    fireEvent.click(account);
    expect(document.getElementById('account-menu')).not.toBeNull();
  });
});
