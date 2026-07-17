import type { Metadata } from 'next';

import { UpdatePasswordForm } from './update-password-form';

/**
 * Server Component wrapper, same rationale as prior auth pages.
 *
 * ACCESS MODEL: this route is deliberately absent from
 * route-protection.ts's PUBLIC_ROUTES (File 42), so middleware already
 * enforces "must be authenticated" before this page ever renders — no
 * additional page-level check is added here, consistent with this
 * project's single-source-of-truth authorization pattern (the same
 * reasoning BaseService's requireAuthentication() and RLS-only Legal
 * Vault reads both follow). A signed-in user reaches this page either
 * via a normal session or Supabase's temporary recovery session
 * established by following a password-reset email link (File 40's own
 * doc comment) — both are treated identically here.
 *
 * No Suspense boundary — no useSearchParams() usage.
 */
export const metadata: Metadata = {
  title: 'Update Password',
};

export default function UpdatePasswordPage() {
  return <UpdatePasswordForm />;
}