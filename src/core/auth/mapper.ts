import type { User } from '@supabase/supabase-js';

import { InternalServerError } from '@/core/errors/app-error';
import type { AuthUser, UserRole } from '@/core/auth/types';

// AMENDMENT (Admin Tooling RBAC, File 4): added 'support', matching the
// addition to UserRole in src/core/auth/types.ts (File 3) and the RLS
// policy widening in 20260802000000_add_support_role_to_admin_policies.sql
// (File 1). No other change in this file — 'support' now simply passes
// the same validation 'admin' already did.
const VALID_ROLES: readonly UserRole[] = [
  'individual',
  'lawyer',
  'law_firm',
  'business',
  'admin',
  'support',
];

/**
 * Type guard narrowing an unknown value to `UserRole`. Centralizes "what
 * counts as a valid role" as a single, testable check rather than
 * repeating a string comparison at every call site.
 */
function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (VALID_ROLES as readonly string[]).includes(value);
}

/**
 * Maps a Supabase `User` to the application's `AuthUser` domain type.
 *
 * This is the ONLY place in the codebase that should read
 * `user.app_metadata` directly. Every other file — repositories, Server
 * Components, route guards — should consume `AuthUser` instead of
 * Supabase's raw `User`, so this function is the single point of change
 * if the auth provider or its metadata shape ever changes.
 *
 * Deliberately throws rather than defaulting when `role` is missing or
 * unrecognized. A user reaching this function with no valid role means
 * account provisioning is broken somewhere upstream (the signup flow or
 * database trigger responsible for assigning a role didn't run) — that's
 * a bug in our system, not bad input from the user, and silently
 * defaulting to a "safe" role like `individual` would hide that bug
 * instead of surfacing it. `InternalServerError` (non-operational, per
 * src/core/errors/app-error.ts) is the correct classification.
 *
 * Also throws if `email` is missing: Supabase's local config
 * (supabase/config.toml) has phone/SMS auth disabled, so every real user
 * is expected to have a verified email. A user with no email indicates
 * the same class of provisioning problem.
 *
 * @throws {InternalServerError} if the user has no valid role or no email.
 */
export function mapSupabaseUserToAuthUser(user: User): AuthUser {
  const role = user.app_metadata?.['role'];

  if (!isUserRole(role)) {
    throw new InternalServerError(
      `Authenticated user "${user.id}" has no valid role in app_metadata ` +
        `(received: ${JSON.stringify(role)}). This indicates a data-integrity ` +
        `problem — every user must be assigned a role at account creation.`,
    );
  }

  if (!user.email) {
    throw new InternalServerError(
      `Authenticated user "${user.id}" has no email address. Phone/SMS auth ` +
        `is disabled for this project, so every user is expected to have one.`,
    );
  }

  return {
    id: user.id,
    email: user.email,
    emailVerified: user.email_confirmed_at != null,
    role,
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at ?? null,
  };
}