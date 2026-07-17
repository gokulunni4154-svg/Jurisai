/**
 * Application-level authentication domain types.
 *
 * Deliberately decoupled from `@supabase/supabase-js`'s `User` type. No
 * file outside `src/core/auth/` (and its future mapper) should import
 * Supabase's `User` type directly — every consumer (repositories, Server
 * Components, route guards, UI) depends on `AuthUser` instead. This keeps
 * the auth provider swappable in principle, and insulates the app from
 * Supabase SDK shape changes: if either ever happened, only the mapper
 * that produces `AuthUser` would need to change, not every consumer.
 */

/**
 * The set of roles a JurisAI account can hold. Drives route access,
 * dashboard selection (Lawyer / Law Firm / Business / Admin), and
 * authorization checks throughout the app.
 *
 * NOTE: this is currently the source of truth, defined in application
 * code ahead of the database schema so route guards and layout logic can
 * be built now. Once the `user_role` Postgres enum exists (Task:
 * Supabase schema, later), this should be redefined as a derived type —
 * e.g. `type UserRole = Database['public']['Enums']['user_role']` — so
 * the database becomes the single source of truth and this union can't
 * silently drift out of sync with it.
 */
export type UserRole = 'individual' | 'lawyer' | 'law_firm' | 'business' | 'admin';

/**
 * The application's representation of an authenticated user.
 *
 * SECURITY: `role` must always be sourced from the Supabase user's
 * `app_metadata`, never `user_metadata`. `user_metadata` is editable by
 * the user themselves via the client SDK (`supabase.auth.updateUser()`);
 * `app_metadata` can only be written server-side (e.g. via the admin
 * client in src/core/supabase/admin.ts, or a Postgres trigger). Sourcing
 * role from `user_metadata` would let a user grant themselves the
 * `admin` role by calling a client-side SDK method.
 *
 * Intentionally minimal: this type answers "who is authenticated and
 * what can they do", not "what is their profile". Display name, avatar,
 * firm affiliation, etc. belong to a separate `Profile` domain entity
 * (User Management module, not yet built) backed by a `profiles` table.
 * Keeping those concerns separate means every auth check stays cheap —
 * it never implicitly requires a profile join.
 */
export interface AuthUser {
  /** Supabase auth user id (UUID). Primary identifier across the app. */
  id: string;
  email: string;
  /** Whether the user has completed email verification. */
  emailVerified: boolean;
  role: UserRole;
  /** ISO 8601 timestamp of account creation. */
  createdAt: string;
  /** ISO 8601 timestamp of the most recent successful sign-in, if any. */
  lastSignInAt: string | null;
}

/**
 * The application's representation of an active session.
 *
 * Deliberately excludes raw access/refresh tokens. Those stay inside the
 * Supabase client instance (src/core/supabase/client.ts /
 * server.ts) and are never surfaced through application-level types,
 * where they could accidentally be logged, serialized into a Server
 * Component payload sent to the client, or included in an error's
 * `context` object.
 */
export interface AuthSession {
  user: AuthUser;
  /** Unix timestamp (seconds) of access token expiry. */
  expiresAt: number;
}