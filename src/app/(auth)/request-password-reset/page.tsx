import type { Metadata } from 'next';

import { RequestPasswordResetForm } from './request-password-reset-form';

/**
 * Server Component wrapper, same rationale as Files 53a/54a. No
 * Suspense boundary — this form has no useSearchParams() usage and no
 * post-submit redirect, same reasoning as File 54a (sign-up).
 */
export const metadata: Metadata = {
  title: 'Reset Password',
};

export default function RequestPasswordResetPage() {
  return <RequestPasswordResetForm />;
}