import type { Metadata } from 'next';

import { SignUpForm } from './sign-up-form';

/**
 * Server Component wrapper, same rationale as File 53a — metadata needs
 * a Server Component, the form needs client state. No Suspense boundary
 * here, unlike File 53a: SignUpForm does not call useSearchParams() (no
 * post-submit redirect exists for sign-up — see File 36's doc comment),
 * so there's no dynamic-rendering opt-in that would require one. Adding
 * one anyway would just be copying File 53's shape without a reason.
 */
export const metadata: Metadata = {
  title: 'Sign Up',
};

export default function SignUpPage() {
  return <SignUpForm />;
}