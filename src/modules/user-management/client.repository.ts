// src/modules/user-management/client.repository.ts
//
// Client Management. Built directly against this session's real, pasted
// `database.types.ts` (`clients` Row/Insert/Update block) and the real,
// pasted `base.repository.ts` — not a reconstruction, no column guessed.
//
// Confirmed real columns (database.types.ts, this session):
//   id, firm_id, profile_id, full_name, email, phone, created_at,
//   updated_at.
//
// MINIMAL ON PURPOSE: this file exists right now only to unblock
// ClientInvitationService (needs to load a target client's row —
// confirm it exists, read its firm_id/email). Full Client Management
// CRUD (create/edit client, list-by-firm for the client roster UI,
// dedup-by-email checks — see the clients migration's own flagged,
// unconfirmed dedup question) is a separate, not-yet-scoped piece of
// work. Do not treat this file's current minimalism as the finished
// shape of Client Management's data layer.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';

type ClientRow = Database['public']['Tables']['clients']['Row'];

/**
 * ClientRepository
 * ----------------------
 * Client Management. Extends BaseRepository<'clients'> and inherits
 * findById/findByIdOrThrow/findMany/count/create/update/delete as-is —
 * same "no bespoke write wrapper" reasoning every other repository in
 * this module gives. findByIdOrThrow() (inherited) is the method
 * ClientInvitationService needs to resolve a client by id and get a
 * NotFoundError for free if it doesn't exist, rather than a bespoke
 * method here.
 *
 * ONE custom read method for now — findByFirmId(), the direct analog
 * of FirmMemberRepository#findByFirmId() / FirmInvitationRepository
 * #findByFirmId() — included ahead of strict need (no confirmed caller
 * yet) because a firm's client roster list is an obvious, near-certain
 * near-term requirement, same "ahead of need" reasoning
 * BaseRepository#count()'s own doc comment gives for itself.
 */
export class ClientRepository extends BaseRepository<'clients'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'clients');
  }

  /**
   * Returns every client record for a firm, earliest-created first —
   * same ordering default as every other findByFirmId()-shaped method
   * in this module.
   */
  async findByFirmId(firmId: string): Promise<ClientRow[]> {
    const { data, error } = await this.supabase
      .from('clients')
      .select('*')
      .eq('firm_id', firmId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list clients by firm id', error, {
        table: this.tableName,
        firmId,
      });
    }

    return (data ?? []) as ClientRow[];
  }
}