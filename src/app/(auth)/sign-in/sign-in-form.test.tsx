import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let currentSearch = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

import { SignInForm } from './sign-in-form';

describe('SignInForm: redirect error banners', () => {
  beforeEach(() => {
    currentSearch = '';
  });
  // Vitest runs with `globals: false`, so Testing Library's automatic
  // cleanup is not registered -- unmount explicitly between tests.
  afterEach(() => {
    cleanup();
  });

  it('shows nothing extra on a plain visit', () => {
    render(<SignInForm />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains why an unconfirmed session was bounced to sign-in', () => {
    currentSearch = 'error=email_not_confirmed&redirectTo=/lawyer/dashboard';
    render(<SignInForm />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Please confirm your email address before signing in.',
    );
  });

  it('explains a failed confirmation callback', () => {
    currentSearch = 'error=confirmation_failed';
    render(<SignInForm />);
    expect(screen.getByRole('alert')).toHaveTextContent(/confirmation link is invalid or has expired/i);
  });

  it('never renders an unknown (attacker-supplied) error code', () => {
    currentSearch = 'error=<script>alert(1)</script>';
    render(<SignInForm />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
