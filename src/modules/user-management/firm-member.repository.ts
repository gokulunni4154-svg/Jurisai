// src/modules/user-management/firm-member.repository.ts
// Structural mirror of firm.repository.ts against
// BaseRepository<'firm_members'>. No new pattern introduced.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';
import type { FirmRole } from '@/core/auth/types';

type FirmMemberRow = Database['public']['Tables']['firm_members']['Row'];

/**
 * FirmMemberRepository
 * ----------------------
 * Admin Tooling — RBAC module. Extends BaseRepository<'firm_members'>
 * and inherits findById/findByIdOrThrow/findMany/count/create/update/
 * delete as-is — same as FirmRepository, no override needed for any of
 * them.
 *
 * `create()`/`update()`/`delete()` (inherited) are the actual read/write
 * surface for adding a member, changing a member's role, or removing a
 * member — deliberately NOT given bespoke named wrappers here
 * (`addMember()`, `changeRole()`, etc.), since each would just be a
 * thin, no-added-behavior pass-through to the already-typed inherited
 * method. That bundling now lives in FirmMemberService (Phase 4,
 * Enterprise & Collaboration — new this session), which layers
 * authorization and audit logging on top of these inherited methods,
 * confirming the original prediction in this comment.
 *
 * Three custom read methods. The first two mirror FirmRepository's own
 * minimalism; the third (findRowByFirmAndProfile) is new this session —
 * see its own doc comment for why it was needed on top of the first.
 */
export class FirmMemberRepository extends BaseRepository<'firm_members'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'firm_members');
  }

  /**
   * Resolves a single profile's FirmRole within a single firm, if
   * any. This is the method types.ts's own AuthUser doc comment already
   * promises exists ("a future FirmMemberRepository method will fetch
   * it explicitly") — AuthUser deliberately omits FirmRole because
   * resolving it isn't cheap enough to do on every getCurrentUser()
   * call, so callers needing it (e.g. a route guard checking "is this
   * profile a Firm Admin for this specific firm") fetch it here,
   * on-demand, scoped to exactly the one firm they care about.
   *
   * `.maybeSingle()`, not `.single()`: a profile with no firm_members
   * row for this firm_id is a normal, expected state (per types.ts's
   * own FirmRole doc comment — "no firm_members row" must be treated as
   * a real state, not coerced to a default), not an error. The table's
   * own unique constraint on (firm_id, profile_id) guarantees at most
   * one row could ever match, so `.maybeSingle()` throwing on multiple
   * rows would only ever fire on a genuine data-integrity violation.
   *
   * Returns the bare FirmRole (not the full FirmMemberRow) since every
   * caller motivating this method wants the role, not the row's other
   * columns — this is unchanged by findRowByFirmAndProfile() below,
   * which exists for a different, later-arising need. Callers needing
   * the full row should use findRowByFirmAndProfile() or findByFirmId(),
   * not this method.
   */
  async findByFirmAndProfile(firmId: string, profileId: string): Promise<FirmRole | null> {
    const { data, error } = await this.supabase
      .from('firm_members')
      .select('role')
      .eq('firm_id', firmId)
      .eq('profile_id', profileId)
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to find firm member by firm id and profile id', error, {
        table: this.tableName,
        firmId,
        profileId,
      });
    }

    return (data?.role as FirmRole | undefined) ?? null;
  }

  /**
   * NEW, Phase 4 — Enterprise & Collaboration. Companion to
   * findByFirmAndProfile() above, returning the FULL row (including
   * `id`) rather than just the bare role.
   *
   * Needed because BaseRepository's inherited update()/delete() take a
   * row `id`, and no method on this repository previously exposed it
   * for a (firmId, profileId) pair — findByFirmAndProfile() was
   * deliberately built to return only the role (see its own doc
   * comment), which was the only need that existed until
   * FirmMemberService (this session) needed to change or remove a
   * specific member's row and required that row's `id` to do it. Not a
   * replacement for findByFirmAndProfile() — that method's callers and
   * reasoning stand unchanged; this is additive for the new use case.
   *
   * Same `.maybeSingle()` reasoning as findByFirmAndProfile(): no
   * matching row is a normal, expected state, not an error.
   */
  async findRowByFirmAndProfile(firmId: string, profileId: string): Promise<FirmMemberRow | null> {
    const { data, error } = await this.supabase
      .from('firm_members')
      .select('*')
      .eq('firm_id', firmId)
      .eq('profile_id', profileId)
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to find firm member row by firm id and profile id', error, {
        table: this.tableName,
        firmId,
        profileId,
      });
    }

    return (data as FirmMemberRow | null) ?? null;
  }

  /**
   * Returns the full membership roster for a firm — every profile
   * in the firm plus their FirmRole. The companion query to
   * findByFirmAndProfile() above: that method answers "what's THIS
   * profile's role here", this one answers "who's in this firm at all"
   * — the query FirmMemberService's last-owner-protection checks (this
   * session) and a future firm-roster admin view would both need.
   *
   * FLAGGED, NEW DECISION — no ordering convention exists elsewhere in
   * this repository to match: rows are returned in `created_at asc`
   * order (earliest-added member first, which for most firms will
   * surface the owner first, since owner rows are expected to be
   * created at firm-creation time) — a reasonable default, not a
   * requirement confirmed anywhere. Revisit if a real consumer of this
   * method needs different ordering (e.g. alphabetical by profile name,
   * which would require a join this method doesn't do).
   */
  async findByFirmId(firmId: string): Promise<FirmMemberRow[]> {
    const { data, error } = await this.supabase
      .from('firm_members')
      .select('*')
      .eq('firm_id', firmId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list firm members by firm id', error, {
        table: this.tableName,
        firmId,
      });
    }

    return (data ?? []) as FirmMemberRow[];
  }
}