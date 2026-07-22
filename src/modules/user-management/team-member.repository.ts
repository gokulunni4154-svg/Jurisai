// src/modules/user-management/team-member.repository.ts
// Structural mirror of firm-member.repository.ts against
// BaseRepository<'team_members'>. No role column exists on team_members
// (see teams migration header, decision #4), so this repository omits
// the role-returning findByFirmAndProfile() equivalent entirely -- there
// is no role value to return. Membership existence itself is the only
// fact this repository's per-(team,profile) lookups answer.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';

type TeamMemberRow = Database['public']['Tables']['team_members']['Row'];

/**
 * TeamMemberRepository
 * ----------------------
 * Phase 4 — Enterprise & Collaboration. Extends
 * BaseRepository<'team_members'> and inherits findById/findByIdOrThrow/
 * findMany/count/create/update/delete as-is.
 *
 * `create()`/`delete()` (inherited) are the actual read/write surface
 * for adding/removing a team member — no bespoke wrapper here, same
 * reasoning FirmMemberRepository's own doc comment gives. No `update()`
 * use case exists (no role column to change — decision #4), so unlike
 * FirmMemberRepository, this repository has no changeRole()-motivated
 * need for a row-id lookup either; findRowByTeamAndProfile() below
 * exists purely for delete()'s id requirement, not for update().
 */
export class TeamMemberRepository extends BaseRepository<'team_members'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'team_members');
  }

  /**
   * Resolves whether a profile is a member of a given team, returning
   * the full row (including `id`, needed by delete()) or null if no
   * membership row exists. Unlike FirmMemberRepository, there is no
   * separate "role-only" lookup here — team_members has no role column
   * (decision #4) — so this single method covers both "is this profile
   * a member" and "what's the row id to delete", rather than being
   * split into findByTeamAndProfile()/findRowByTeamAndProfile() the way
   * FirmMemberRepository splits role-lookup from row-lookup.
   *
   * `.maybeSingle()`, not `.single()`: no matching row is a normal,
   * expected state (not yet a member), not an error — same reasoning
   * FirmMemberRepository's own methods give. The table's unique
   * constraint on (team_id, profile_id) guarantees at most one row could
   * ever match.
   */
  async findRowByTeamAndProfile(teamId: string, profileId: string): Promise<TeamMemberRow | null> {
    const { data, error } = await this.supabase
      .from('team_members')
      .select('*')
      .eq('team_id', teamId)
      .eq('profile_id', profileId)
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to find team member row by team id and profile id', error, {
        table: this.tableName,
        teamId,
        profileId,
      });
    }

    return (data as TeamMemberRow | null) ?? null;
  }

  /**
   * Returns the full membership roster for a team — every profile on
   * the team. Companion query to findRowByTeamAndProfile() above: that
   * method answers "is THIS profile on the team", this one answers
   * "who's on the team at all" — the query a team roster view needs.
   *
   * Same `created_at asc` ordering default as
   * FirmMemberRepository#findByFirmId() and TeamRepository#findByFirmId(),
   * for the same reason: a reasonable default, not a confirmed
   * requirement.
   */
  async findByTeamId(teamId: string): Promise<TeamMemberRow[]> {
    const { data, error } = await this.supabase
      .from('team_members')
      .select('*')
      .eq('team_id', teamId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list team members by team id', error, {
        table: this.tableName,
        teamId,
      });
    }

    return (data ?? []) as TeamMemberRow[];
  }
}