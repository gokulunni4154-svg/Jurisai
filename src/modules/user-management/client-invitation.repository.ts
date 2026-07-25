// src/modules/user-management/client-invitation.repository.ts
//
// Client Management. Structural mirror of firm-invitation.repository.ts
// (same BaseRepository<'client_invitations'> extension, same
// custom-read-methods-only-no-write-override shape, inherited create()/
// update() as the write path), adjusted for client_invitations' real
// column shape, which is SMALLER than firm_invitations' — no `email`,
// no `profile_id`, no `role` — see the migration's own header,
// deviations #1-#2, for why.
//
// UNLIKE firm-invitation.repository.ts, this file is NOT a
// reconstruction from call-site evidence — it's built directly against
// this session's real, pasted `database.types.ts` (`client_invitations`
// Row/Insert/Update block) and the real, pasted `base.repository.ts`.
// No column here is guessed.
//
// Confirmed real columns (database.types.ts, this session):
//   id, client_id, firm_id, token, status, invited_by, expires_at,
//   accepted_at, revoked_at, created_at, updated_at.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';

type ClientInvitationRow = Database['public']['Tables']['client_invitations']['Row'];

export class ClientInvitationRepository extends BaseRepository<'client_invitations'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'client_invitations');
  }

  async findByToken(token: string): Promise<ClientInvitationRow | null> {
    const { data, error } = await this.supabase
      .from('client_invitations')
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to find client invitation by token', error, {
        table: this.tableName,
      });
    }

    return (data as ClientInvitationRow | null) ?? null;
  }

  async findPendingByClientId(clientId: string): Promise<ClientInvitationRow | null> {
    const { data, error } = await this.supabase
      .from('client_invitations')
      .select('*')
      .eq('client_id', clientId)
      .eq('status', 'pending')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to find pending client invitation by client id', error, {
        table: this.tableName,
        clientId,
      });
    }

    return (data as ClientInvitationRow | null) ?? null;
  }

  async findByFirmId(firmId: string): Promise<ClientInvitationRow[]> {
    const { data, error } = await this.supabase
      .from('client_invitations')
      .select('*')
      .eq('firm_id', firmId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list client invitations by firm id', error, {
        table: this.tableName,
        firmId,
      });
    }

    return (data ?? []) as ClientInvitationRow[];
  }
}