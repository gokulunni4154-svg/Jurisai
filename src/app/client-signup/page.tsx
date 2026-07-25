import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ClientSignUpForm } from './client-sign-up-form';

/**
 * Server Component wrapper. UNLIKE the confirmed real sign-up-page.tsx
 * (which explicitly has NO Suspense boundary, since SignUpForm never
 * calls useSearchParams()), this page DOES need one -- ClientSignUpForm
 * reads the invite token via useSearchParams() (?invite=<token>, per
 * CLIENT_SIGNUP_PATH's confirmed real usage building inviteUrl in
 * client-invitation.service.ts). useSearchParams() forces dynamic
 * rendering and requires a Suspense boundary in the App Router -- the
 * real sign-up-page.tsx's own doc comment names this exact situation
 * ("File 53a") as prior art for it, but that file has not been pasted
 * or confirmed this session.
 *
 * FLAGGED: the Suspense boundary below is this session's own
 * construction, not a mirror of that confirmed file's real shape
 * (e.g. its real fallback UI is unknown -- `null` is used here as a
 * safe, minimal default). Correct this once File 53a's real source is
 * available.
 *
 * REAL FILE PATH: src/app/client-signup/page.tsx
 */
export const metadata: Metadata = {
  title: 'Client Sign Up',
};

export default function ClientSignUpPage() {
  return (
    <Suspense fallback={null}>
      <ClientSignUpForm />
    </Suspense>
  );
}