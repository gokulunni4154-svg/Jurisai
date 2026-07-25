// src/modules/case-notes/case-note.repository.ts
//
// Mirrors task.repository.ts's confirmed real pattern exactly: extends
// BaseRepository<'case_notes'> (base.repository.ts, pasted this
// session) for findById/findByIdOrThrow/findMany/count/create/update/
// delete, adding only the one query shape the base class doesn't
// provide — case-scoped listing.
//
// RLS-scoped client (not admin) — case_notes has client-writable RLS
// policies (case_notes_select/insert/update/delete — see
// 20260910000000_create_case_notes_table.sql, this session's own file,
// FLAGGED as containing inferred-not-verified predicates), matching
// task.repository.ts's own RLS-client choice for `tasks`.

import type { SupabaseClient } from '@supabase/supabase-js';

import { BaseRepository } from '@/core/repositories/base.repository';
import { DatabaseError } from '@/core/errors/app-error';
import type { Database } from '@/core/supabase/database.types';

export class CaseNoteRepository extends BaseRepository<'case_notes'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'case_notes');
  }

  /**
   * All notes on a given case, most recent first — the primary "notes
   * on this case" view. Does not independently re-check access beyond
   * what RLS already enforces (case_notes_select), same "RLS is the
   * backstop, repositories trust the session" convention as
   * task.repository.ts's own findByCaseId().
   */
  async findByCaseId(
    caseId: string,
  ): Promise<Database['public']['Tables']['case_notes']['Row'][]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(`Failed to list notes for case`, error, {
        table: this.tableName,
        caseId,
      });
    }

    return data ?? [];
  }
}