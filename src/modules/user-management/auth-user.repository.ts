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
 * Admin Tooling — User & Org Management module.
 *
 * NOT a BaseRepository<T> subclass — auth.users is reached only via
 * Supabase's separate Auth Admin API (supabase.auth.admin.*), never
 * `.from('users')`. See this class's own prior doc comment (unchanged)
 * for the full reasoning.
 *
 * MUST be constructed with the admin.ts service-role client — every
 * method here calls supabase.auth.admin.*, which requires the service
 * role key.
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