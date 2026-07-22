// src/modules/user-management/team.repository.ts
// Structural mirror of firm.repository.ts against BaseRepository<'teams'>.
// No new pattern introduced.
//
// FLAGGED, NEW DECISION -- file placement: firm.repository.ts lives in
// modules/billing, but firm-member.repository.ts lives in
// modules/user-management (the RBAC module). Teams have no billing
// dimension at all (decision #6 -- roster only, this pass), so this file
// is placed in modules/user-management, matching firm-member.repository.ts
// as the closer structural analog rather than firm.repository.ts's own
// module. Not confirmed against real precedent -- flag for correction if
// wrong.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';

type TeamRow = Database['public']['Tables']['teams']['Row'];

/**
 * TeamRepository
 * ---------------
 * Phase 4 — Enterprise & Collaboration. Extends BaseRepository<'teams'>
 * and inherits findById/findByIdOrThrow/findMany/count/create/update/
 * delete as-is — same as FirmRepository, no override needed for any of
 * them.
 *
 * One custom read method: findByFirmId(), the query a firm's team-list
 * view needs ("what teams exist in this firm") — same motivating need
 * FirmMemberRepository#findByFirmId() had for firm_members, applied one
 * level down.
 */
export class TeamRepository extends BaseRepository<'teams'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'teams');
  }

  /**
   * Returns every team belonging to a firm. FLAGGED, NEW DECISION — no
   * ordering convention exists elsewhere to match: rows are returned in
   * `created_at asc` order (oldest team first), same default
   * FirmMemberRepository#findByFirmId() chose for the identical reason —
   * a reasonable default, not a confirmed requirement. Revisit if a real
   * consumer needs different ordering (e.g. alphabetical by name).
   */
  async findByFirmId(firmId: string): Promise<TeamRow[]> {
    const { data, error } = await this.supabase
      .from('teams')
      .select('*')
      .eq('firm_id', firmId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list teams by firm id', error, {
        table: this.tableName,
        firmId,
      });
    }

    return (data ?? []) as TeamRow[];
  }
}