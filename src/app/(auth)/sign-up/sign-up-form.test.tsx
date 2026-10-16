import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

import { SignUpForm } from './sign-up-form';

const PASSWORD = 'SuperSecret123!';

function mockSignUpResponse(body: unknown, status = 201) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function fillAndSubmit(accountType: 'individual' | 'lawyer' | 'firm') {
  const user = userEvent.setup();
  render(<SignUpForm />);

  if (accountType === 'lawyer') {
    await user.click(screen.getByRole('button', { name: 'Individual lawyer' }));
    await user.type(screen.getByLabelText('Bar registration number'), 'MH/1234/2020');
  } else if (accountType === 'firm') {
    await user.click(screen.getByRole('button', { name: 'Lawyer firm' }));
    await user.type(screen.getByLabelText('Firm name'), 'Acme LLP');
  }

  await user.type(screen.getByLabelText('Full name'), 'Test User');
  await user.type(screen.getByLabelText('Email'), 'test@example.com');
  await user.type(screen.getByLabelText('Password'), PASSWORD);
  await user.type(screen.getByLabelText('Confirm password'), PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('SignUpForm: success message matches the real auth state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    // `globals: false` => no automatic Testing Library cleanup.
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(['individual', 'lawyer', 'firm'] as const)(
    '%s: tells the user to check their email when confirmation is required',
    async (accountType) => {
      mockSignUpResponse({ data: { emailConfirmationRequired: true } });

      await fillAndSubmit(accountType);

      expect(await screen.findByText('Check your email')).toBeInTheDocument();
      expect(screen.getByText(/confirmation link/i)).toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['individual', { emailConfirmationRequired: false }, '/general-user/dashboard'],
    ['lawyer', { emailConfirmationRequired: false }, '/lawyer/dashboard'],
    ['firm', { emailConfirmationRequired: false, firmId: 'firm-42' }, '/firm/firm-42/dashboard'],
  ] as const)(
    '%s: goes straight to the dashboard, with no message, when a session already exists',
    async (accountType, data, destination) => {
      mockSignUpResponse({ data });

      await fillAndSubmit(accountType);

      await waitFor(() => expect(push).toHaveBeenCalledWith(destination));
      expect(refresh).toHaveBeenCalled();
      expect(screen.queryByText('Check your email')).not.toBeInTheDocument();
      expect(screen.queryByText('Account created')).not.toBeInTheDocument();
    },
  );

  it('firm: never guesses a URL if the response has no firmId', async () => {
    mockSignUpResponse({ data: { emailConfirmationRequired: false } });

    await fillAndSubmit('firm');

    expect(await screen.findByText('Account created')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('falls back to the safe "check your email" panel when the response body is unreadable', async () => {
    mockSignUpResponse('not json');

    await fillAndSubmit('lawyer');

    expect(await screen.findByText('Check your email')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows the server error (and no success panel) when sign-up fails', async () => {
    mockSignUpResponse({ error: { message: 'An account with this email address already exists.' } }, 409);

    await fillAndSubmit('individual');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with this email address already exists.',
    );
    expect(screen.queryByText('Check your email')).not.toBeInTheDocument();
    expect(screen.queryByText('Account created')).not.toBeInTheDocument();
  });
});
