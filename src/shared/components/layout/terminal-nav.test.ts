import { describe, expect, it } from 'vitest';

import {
  getAccountMenu,
  getTerminalNav,
  resolveTerminalFromProfile,
  type Terminal,
} from './terminal-nav';

const hrefs = (terminal: Terminal, firmId?: string | null) =>
  getTerminalNav(terminal, { firmId })
    .map((i) => i.href)
    .filter((h): h is string => h !== null);

describe('getTerminalNav — each terminal stays in its own namespace', () => {
  it('lawyer: only /lawyer/* links, never firm or general-user', () => {
    const links = hrefs('lawyer', 'firm-123'); // firmId must be ignored for lawyers
    expect(links).toEqual([
      '/lawyer/dashboard',
      '/lawyer/cases',
      '/lawyer/inquiries',
      '/lawyer/hearings/upcoming',
      '/lawyer/tasks',
      '/lawyer/document-sets',
    ]);
    expect(links.some((h) => h.startsWith('/firm') || h.startsWith('/general-user'))).toBe(false);
  });

  it('firm: only /firm/{firmId}/* links, never lawyer or general-user', () => {
    const links = hrefs('firm', 'firm-123');
    expect(links).toEqual([
      '/firm/firm-123/dashboard',
      '/firm/firm-123/clients',
      '/firm/firm-123/teams',
      '/firm/firm-123/tasks',
      '/firm/firm-123/reports',
      '/firm/firm-123/observability',
      '/firm/firm-123/settings',
    ]);
  });

  it('firm: without a firmId, items are disabled instead of linking to /firm/null/*', () => {
    const items = getTerminalNav('firm', { firmId: null });
    expect(items.every((i) => i.href === null)).toBe(true);
    expect(items.filter((i) => i.key !== 'ai-assistant').every((i) => i.comingSoon)).toBe(true);
  });

  it('general: only /general-user/* links, never lawyer or firm', () => {
    expect(hrefs('general', 'firm-123')).toEqual([
      '/general-user/dashboard',
      '/general-user/documents',
      '/general-user/lawyers',
      '/general-user/inquiries/mine',
    ]);
  });

  it('client: dashboard only, pointing at /client', () => {
    expect(hrefs('client', 'firm-123')).toEqual(['/client']);
  });

  it('AI Assistant stays a disabled "coming soon" item (no page exists)', () => {
    for (const t of ['lawyer', 'firm', 'general'] as const) {
      const ai = getTerminalNav(t, { firmId: 'f' }).find((i) => i.key === 'ai-assistant');
      expect(ai).toMatchObject({ href: null, comingSoon: true });
    }
  });

  it('every item key is unique within a terminal', () => {
    for (const t of ['lawyer', 'firm', 'general', 'client'] as const) {
      const keys = getTerminalNav(t, { firmId: 'f' }).map((i) => i.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('getAccountMenu', () => {
  it('lawyer gets My Profile, the three lawyer "about me" pages, and the shared billing pages', () => {
    expect(getAccountMenu('lawyer').map((i) => i.href)).toEqual([
      '/profile',
      '/lawyer/verification',
      '/lawyer/invitations',
      '/lawyer/notifications',
      '/billing/subscription',
      '/pricing',
      '/billing/firms/new',
    ]);
  });

  it('lawyer account menu never links into the firm or general-user terminals', () => {
    const hrefs = getAccountMenu('lawyer').map((i) => i.href);
    for (const forbidden of ['/general-user', '/firm', '/audit-log', '/client']) {
      expect(hrefs.some((h) => h.startsWith(forbidden))).toBe(false);
    }
  });

  it('every account-menu entry has a unique key', () => {
    const keys = getAccountMenu('lawyer').map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(['firm', 'general', 'client'] as const)('%s gets only My Profile', (t) => {
    expect(getAccountMenu(t).map((i) => i.href)).toEqual(['/profile']);
  });
});

describe('resolveTerminalFromProfile (shared pages only)', () => {
  it('lawyer wins over firm_id (signUpAsLawyer sets a solo firm_id)', () => {
    expect(resolveTerminalFromProfile({ role: 'lawyer', firm_id: 'f1' })).toEqual({
      terminal: 'lawyer',
      firmId: null,
    });
  });

  it('client is never a firm terminal, even with a firm_id', () => {
    expect(resolveTerminalFromProfile({ role: 'client', firm_id: 'f1' }).terminal).toBe('client');
  });

  it('non-lawyer, non-client with a firm_id resolves to firm', () => {
    expect(resolveTerminalFromProfile({ role: 'individual', firm_id: 'f1' })).toEqual({
      terminal: 'firm',
      firmId: 'f1',
    });
  });

  it.each(['individual', 'business', 'admin', 'support', null])(
    'role %s without a firm_id resolves to general',
    (role) => {
      expect(resolveTerminalFromProfile({ role, firm_id: null }).terminal).toBe('general');
    },
  );

  it('platform admin / support with a firm_id keeps the previous firm resolution', () => {
    expect(resolveTerminalFromProfile({ role: 'admin', firm_id: 'f1' }).terminal).toBe('firm');
  });
});
