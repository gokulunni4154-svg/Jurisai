// src/modules/cases/case-access-grant.repository.ts
//
// case_access_grants has its own single `id` primary key (unlike
// case_documents), so this extends BaseRepository<'case_access_grants'>
// normally -- create/findById/findByIdOrThrow/findMany/count/update all
// inherited unchanged. `delete()` is deliberately never called --
// revocation is a soft update (revoked_at), not a hard delete, per the
// migration's own soft-revoke design (preserves grant history for
// audit).
//
// ADMIN CLIENT, NOT RLS -- case_access_grants has no client-writable RLS
// policy at all (20260808000000_create_case_access_grants.sql sec7 --
// SELECT only for `authenticated`), matching firm_members' identical
// posture. Per firm-member.factory.ts's confirmed real precedent (admin
// client, matching firm.factory.ts), this repository must be
// constructed with the admin client in case.factory.ts -- the Service
// layer's own authorization checks stand in for RLS on writes, same as
// FirmMemberService.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';

type CaseAccessGrantRow = Database['public']['Tables']['case_access_grants']['Row'];

export class CaseAccessGrantRepository extends BaseRepository<'case_access_grants'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'case_access_grants');
  }

  /**
   * Resolves the caller's own ACTIVE grant for a case, or null. Mirrors
   * FirmMemberRepository#findByFirmAndProfile's role-lookup shape --
   * used by CaseService to answer "can this profile read/write this
   * case via a grant" without pulling the full roster.
   */
  async findActiveGrantForCaseAndProfile(
    caseId: string,
    profileId: string,
  ): Promise<CaseAccessGrantRow | null> {
    const { data, error } = await this.supabase
      .from('case_access_grants')
      .select('*')
      .eq('case_id', caseId)
      .eq('grantee_id', profileId)
      .is('revoked_at', null)
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to find active case access grant', error, {
        caseId,
        profileId,
      });
    }

    return (data as CaseAccessGrantRow | null) ?? null;
  }

  /**
   * Returns every ACTIVE grant for a case -- the roster view a case's
   * access-management UI needs. Excludes revoked history, mirroring
   * findActiveGrantForCaseAndProfile's "active" framing.
   */
  async findActiveGrantsForCase(caseId: string): Promise<CaseAccessGrantRow[]> {
    const { data, error } = await this.supabase
      .from('case_access_grants')
      .select('*')
      .eq('case_id', caseId)
      .is('revoked_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list active case access grants', error, {
        caseId,
      });
    }

    return (data ?? []) as CaseAccessGrantRow[];
  }
}