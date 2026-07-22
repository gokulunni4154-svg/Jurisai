// src/modules/user-management/team-invitation.repository.ts
// Structural mirror of firm-invitation.repository.ts against
// BaseRepository<'team_invitations'>. No `token` column exists on
// team_invitations (Decisions #11/#12 -- a team invitation can only
// ever target an existing firm member, so there is no new-user/token
// path), so this repository has no findByToken() equivalent -- there is
// no token value to look up.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';

type TeamInvitationRow = Database['public']['Tables']['team_invitations']['Row'];

/**
 * TeamInvitationRepository
 * ----------------------
 * Phase 4 — Enterprise & Collaboration, Invitation System. Extends
 * BaseRepository<'team_invitations'> and inherits findById/
 * findByIdOrThrow/findMany/count/create/update/delete as-is.
 *
 * `create()`/`update()` (inherited) are the write path for issuing,
 * revoking, and accepting a team invitation -- no bespoke wrapper here,
 * same reasoning FirmInvitationRepository's own doc comment gives.
 *
 * Three custom read methods below -- one fewer than
 * FirmInvitationRepository, since there is no token to look up by. Each
 * is the direct analog of that repository's own methods, adjusted for
 * team_invitations having no `email`/`token`/`role` columns.
 */
export class TeamInvitationRepository extends BaseRepository<'team_invitations'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'team_invitations');
  }

  /**
   * Resolves the current PENDING invitation, if any, for a given
   * (teamId, profileId) pair -- the re-invite lookup (same reasoning as
   * FirmInvitationRepository#findPendingByFirmAndEmail(), applied to
   * team_invitations' (team_id, profile_id) shape instead of
   * (firm_id, lower(email))): before issuing a fresh invitation, the
   * service layer must find and invalidate any existing pending one to
   * the same profile, rather than erroring on the partial unique index
   * (team_invitations_team_profile_pending_unique) firing on insert.
   *
   * No case-insensitive comparison needed here, unlike the email-based
   * firm_invitations equivalent -- profile_id is a uuid, not a
   * user-entered string.
   *
   * `.maybeSingle()`: no pending invitation for this profile is the
   * common case, not an error. At most one 'pending' row can exist per
   * (team_id, profile_id) by the table's own partial unique index.
   */
  async findPendingByTeamAndProfile(teamId: string, profileId: string): Promise<TeamInvitationRow | null> {
    const { data, error } = await this.supabase
      .from('team_invitations')
      .select('*')
      .eq('team_id', teamId)
      .eq('profile_id', profileId)
      .eq('status', 'pending')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to find pending team invitation by team id and profile id', error, {
        table: this.tableName,
        teamId,
        profileId,
      });
    }

    return (data as TeamInvitationRow | null) ?? null;
  }

  /**
   * Returns every PENDING invitation addressed to a given profile --
   * the in-app pending-invites list's query for team invitations.
   * Unlike firm_invitations' equivalent, this is the ONLY acceptance
   * path that can ever apply to a team invitation (Decision #12: no
   * token/new-user path exists for teams at all), so this method covers
   * the complete set of "team invites this profile can currently act
   * on" rather than one of two paths.
   *
   * Same `created_at asc` ordering default as every other list method
   * in this module.
   */
  async findPendingByProfileId(profileId: string): Promise<TeamInvitationRow[]> {
    const { data, error } = await this.supabase
      .from('team_invitations')
      .select('*')
      .eq('profile_id', profileId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list pending team invitations by profile id', error, {
        table: this.tableName,
        profileId,
      });
    }

    return (data ?? []) as TeamInvitationRow[];
  }

  /**
   * Returns every invitation ever issued for a team -- pending AND
   * historical -- the query a team-invitation-management view needs.
   * Direct analog of FirmInvitationRepository#findByFirmId(), same
   * reasoning: deliberately unfiltered by status, since an admin
   * managing a team's invitations plausibly wants the full history, not
   * just what's currently outstanding.
   */
  async findByTeamId(teamId: string): Promise<TeamInvitationRow[]> {
    const { data, error } = await this.supabase
      .from('team_invitations')
      .select('*')
      .eq('team_id', teamId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list team invitations by team id', error, {
        table: this.tableName,
        teamId,
      });
    }

    return (data ?? []) as TeamInvitationRow[];
  }
}