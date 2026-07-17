import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SignInForm } from './sign-in-form';

/**
 * Server Component wrapper. Exists solely to hold page-level metadata
 * and the Suspense boundary — both require a Server Component, but the
 * actual form needs client-side state and `useSearchParams`. See
 * File 53's companion-file rationale (same split as File 6's
 * layout.tsx / theme-provider.tsx).
 */
export const metadata: Metadata = {
  title: 'Sign In',
};

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}