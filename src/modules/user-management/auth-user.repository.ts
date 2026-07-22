import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError } from '@/core/errors/app-error';
import type { Database } from '@/core/supabase/database.types';
import type { UserRole } from '@/core/auth/types';

export interface AuthUserSummary {
  readonly id: string;
  readonly email: string | null;
  readonly role: UserRole | null;
  readonly emailVerified: boolean;
  readonly lastSignInAt: string | null;
}

const VALID_ROLES: readonly UserRole[] = [
  'individual',
  'lawyer',
  'law_firm',
  'business',
  'admin',
  'support',
];

function toNullableUserRole(value: unknown): UserRole | null {
  return typeof value === 'string' && (VALID_ROLES as readonly string[]).includes(value)
    ? (value as UserRole)
    : null;
}

/**
 * FLAGGED, UNCONFIRMED VALUE: Supabase's GoTrue Admin API has no literal
 * "permanent" ban value — `ban_duration` is parsed as a Go duration
 * string, or the literal `'none'` to unban. The common workaround for
 * "indefinite until manually lifted" is a very long duration; this
 * project uses ~10 years as that stand-in. NOT independently verified
 * against a real Supabase Admin API response this session — same flag
 * this file already carried for `setBanned()` before this amendment,
 * now narrowed to one specific constant instead of an arbitrary
 * caller-supplied duration.
 */
const PERMANENT_BAN_DURATION = '87600h';

/**
 * AuthUserRepository
 * -------------------
 * Admin Tooling — User & Org Management module. Also now the Invitation
 * System's email-resolution path (see findIdByEmail() below).
 *
 * NOT a BaseRepository<T> subclass — auth.users is reached only via
 * Supabase's separate Auth Admin API (supabase.auth.admin.*) or, for the
 * one case that API can't serve (email lookup — no filter param exists
 * on listUsers()), a dedicated security-definer RPC. Still never a raw
 * `.from('users')` call from this class — see this class's own prior
 * doc comment for the original reasoning, and
 * 20260807000000_create_find_auth_user_by_email_function.sql for why the
 * RPC approach was chosen over that alternative for email lookup
 * specifically.
 *
 * MUST be constructed with the admin.ts service-role client — every
 * method here either calls supabase.auth.admin.* (requires the service
 * role key) or an RPC whose EXECUTE grant is restricted to
 * service_role.
 */
export class AuthUserRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /**
   * Resolves email/role/verification/last-sign-in for a bounded set of
   * user ids. Unchanged from prior version — see its own doc comment in
   * the version confirmed earlier this session for the full "one
   * bounded page only" reasoning. Also now the data source for the
   * single-user detail page (called with a one-element id array), which
   * is within the same "bounded page" contract this method already
   * documents — a single id is the smallest possible bounded page.
   */
  async findSummariesByIds(ids: readonly string[]): Promise<readonly AuthUserSummary[]> {
    const results = await Promise.all(
      ids.map(async (id) => {
        const { data, error } = await this.supabase.auth.admin.getUserById(id);

        if (error || !data.user) {
          return null;
        }

        const { user } = data;

        return {
          id: user.id,
          email: user.email ?? null,
          role: toNullableUserRole(user.app_metadata?.['role']),
          emailVerified: user.email_confirmed_at != null,
          lastSignInAt: user.last_sign_in_at ?? null,
        } satisfies AuthUserSummary;
      }),
    );

    return results.filter((summary): summary is AuthUserSummary => summary !== null);
  }

  /**
   * NEW — Invitation System (Decision #2: does the invited email match
   * an existing user, or is this a genuine new-user invite). Wraps the
   * find_auth_user_id_by_email RPC (security definer, service_role
   * only) rather than querying auth.users directly or paginating
   * listUsers() — see the migration's own header for the full trade-off
   * this was chosen against, and this class's own doc comment above.
   *
   * Returns the matching auth.users.id, which IS profiles.id per the
   * confirmed handle_new_user() trigger on
   * 20260711120000_create_profiles_table.sql — so the caller can use
   * this value directly as a profile_id with no further translation.
   * Returns null if no user has that email. Case-insensitivity is
   * handled inside the RPC itself (lower(email) = lower(p_email)), not
   * by this method — no normalization happens here.
   *
   * FLAGGED: this project's generated database.types.ts must be
   * regenerated after the RPC migration is applied for
   * `this.supabase.rpc('find_auth_user_id_by_email', ...)` to type-check
   * against a real Functions entry rather than falling back to `any` —
   * not done as part of this file, since it depends on the migration
   * actually being applied to a real database first.
   */
  async findIdByEmail(email: string): Promise<string | null> {
    const { data, error } = await this.supabase.rpc('find_auth_user_id_by_email', {
      p_email: email,
    });

    if (error) {
      throw new DatabaseError('Failed to look up auth user by email', error, {
        email,
      });
    }

    return (data as string | null) ?? null;
  }

  /**
   * AMENDED. Signature simplified from `(id, banDurationSeconds: number
   * | null)` to `(id, banned: boolean)` — the product decision (this
   * session) is permanent-suspend-only, with no admin-facing duration
   * picker, so the arbitrary-seconds parameter had no real caller and
   * was dead API surface.
   *
   * `banned: true` → sets `ban_duration` to the PERMANENT_BAN_DURATION
   * stand-in (see that constant's own flag above).
   * `banned: false` → sets `ban_duration: 'none'`, Supabase's documented
   * un-ban value — this part WAS already the un-ban convention in the
   * prior version and is unchanged.
   *
   * Reversibility: a `true` call has no built-in expiry, but is not
   * irreversible — calling this again with `false` lifts it at any
   * time. There is no separate "permanent vs temporary" state; the ban
   * simply persists until an admin explicitly calls this method again.
   */
  async setBanned(id: string, banned: boolean): Promise<void> {
    const ban_duration = banned ? PERMANENT_BAN_DURATION : 'none';

    const { error } = await this.supabase.auth.admin.updateUserById(id, {
      ban_duration,
    });

    if (error) {
      throw new DatabaseError('Failed to update user ban status', error, {
        userId: id,
        banned,
      });
    }
  }
}