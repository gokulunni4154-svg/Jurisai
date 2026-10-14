// Regression tests for audit batch 2, Task 2: the invited-client signup
// form posted to /api/auth/client-sign-up, a path with no route (the route
// directory is src/app/api/auth/client-signup), and put `inviteToken` in
// the JSON body, which the route forwards to signUpSchema.parse() -- a
// .strict() schema that rejects the unknown key. These tests pin the
// form's request to the server's actual, existing contract. They do not
// exercise Supabase, invitation lookup, or account creation.

import fs from 'node:fs';
import path from 'node:path';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signUpSchema } from '@/modules/auth/auth.schemas';

import { ClientSignUpForm } from './client-sign-up-form';

let search = 'invite=tok_abc123';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  search = 'invite=tok_abc123';
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ data: {} }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const VALID = {
  fullName: 'Test Client',
  email: 'client@example.com',
  password: 'a-long-enough-pass-1',
};

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: VALID.fullName } });
  fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: VALID.email } });
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: VALID.password } });
  fireEvent.change(screen.getByLabelText(/confirm password/i), {
    target: { value: VALID.password },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('ClientSignUpForm request', () => {
  it('POSTs to /api/auth/client-signup with the invite token as the inviteToken query param', async () => {
    render(<ClientSignUpForm />);
    fillAndSubmit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('/api/auth/client-signup?inviteToken=tok_abc123');
    expect(init.method).toBe('POST');
  });

  it('never posts to the old, non-existent /api/auth/client-sign-up path', async () => {
    render(<ClientSignUpForm />);
    fillAndSubmit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0] as [string])[0]).not.toContain('client-sign-up');
  });

  it('URL-encodes the invite token', async () => {
    search = 'invite=' + encodeURIComponent('a b&c=d/e');
    render(<ClientSignUpForm />);
    fillAndSubmit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      '/api/auth/client-signup?inviteToken=a%20b%26c%3Dd%2Fe',
    );
  });

  it('sends a body the server schema accepts: exactly email, password, fullName (no inviteToken)', async () => {
    render(<ClientSignUpForm />);
    fillAndSubmit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);

    expect(Object.keys(body).sort()).toEqual(['email', 'fullName', 'password']);
    // The real server-side schema is .strict(); this fails if the form ever
    // sends a key the server rejects.
    expect(signUpSchema.safeParse(body).success).toBe(true);
  });

  it('the endpoint it posts to has a route handler that exports POST', async () => {
    render(<ClientSignUpForm />);
    fillAndSubmit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = new URL((fetchMock.mock.calls[0] as [string])[0], 'http://localhost');
    expect(url.pathname.startsWith('/api/')).toBe(true);

    const routeFile = path.join(process.cwd(), 'src/app', url.pathname, 'route.ts');
    expect(fs.existsSync(routeFile)).toBe(true);
    expect(fs.readFileSync(routeFile, 'utf8')).toMatch(/export\s+async\s+function\s+POST\b/);
  });
});

describe('ClientSignUpForm behavior preserved', () => {
  it('shows the invalid-invitation state and makes no request when ?invite is missing', () => {
    search = '';
    render(<ClientSignUpForm />);

    expect(screen.getByText('Invalid invitation link')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the check-your-email panel on success', async () => {
    render(<ClientSignUpForm />);
    fillAndSubmit();

    expect(await screen.findByText('Check your email')).toBeInTheDocument();
  });

  it("surfaces the server's error message on failure", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: { message: 'This invitation has expired.' } }),
    });
    render(<ClientSignUpForm />);
    fillAndSubmit();

    expect(await screen.findByText('This invitation has expired.')).toBeInTheDocument();
  });

  it('both sign-in links point at /sign-in (Batch 1 correction preserved)', () => {
    search = '';
    render(<ClientSignUpForm />);
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute(
      'href',
      '/sign-in',
    );
  });
});
