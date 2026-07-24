// src/modules/user-management/firm-invitation.repository.ts
//
// REBUILT THIS SESSION — the real file on disk was found to be
// corrupted (it actually contained firm-invitation.service.ts's code,
// self-importing from './firm-invitation.repository', confirmed three
// independent ways: file upload, direct paste, and PowerShell
// `Get-Content`, all byte-identical). No recoverable original was
// found. Reconstructed from two sources, not guessed from scratch:
//   1. team-invitation.repository.ts's real, confirmed structure —
//      the direct structural analog, extends the same BaseRepository
//      pattern, same custom-read-methods-only-no-write-override shape.
//   2. Every method call firm-invitation.service.ts's real (confirmed)
//      source actually makes on `this.firmInvitationRepository` — the
//      method signatures below are constrained by that real call
//      evidence, not invented independently.
//
// FLAGGED: this is a reconstruction, not an originally-pasted-and-
// verified file. The METHOD SIGNATURES are confirmed (derived from
// real call sites), but implementation details with no call-site
// evidence (e.g. exact ordering, exact error-message wording) are
// this file's own best judgment, following team-invitation.repository.ts's
// precedent as closely as possible. Re-diff against the real table
// schema (firm_invitations' actual columns) before trusting this
// blindly — assumed columns: id, firm_id, email, profile_id (nullable
// FK), role, token, status, invited_by, expires_at, revoked_at,
// accepted_at, created_at, updated_at — inferred from every field
// referenced in the service's create()/update() calls, not from a
// freshly pasted migration this session.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';

type FirmInvitationRow = Database['public']['Tables']['firm_invitations']['Row'];

/**
 * FirmInvitationRepository
 * ----------------------
 * Phase 4 — Enterprise & Collaboration, Invitation System. Extends
 * BaseRepository<'firm_invitations'> and inherits findById/
 * findByIdOrThrow/findMany/count/create/update/delete as-is — same
 * "no bespoke write wrapper" reasoning team-invitation.repository.ts's
 * own doc comment gives: create()/update() (inherited) are the write
 * path for issuing, revoking, and accepting a firm invitation.
 *
 * Four custom read methods below — one MORE than
 * TeamInvitationRepository's three, since firm_invitations (unlike
 * team_invitations) has a token/new-user path (Decisions #2/#3/#13) —
 * findByToken() has no team-invitation analog at all, since a team
 * invitation can only ever target an existing firm member (Decisions
 * #11/#12) and therefore never needs a token lookup.
 */
export class FirmInvitationRepository extends BaseRepository<'firm_invitations'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'firm_invitations');
  }

  /**
   * Resolves an invitation by its raw token — the lookup the new-user
   * signup path (AuthService.signUp(), Decision #13) needs to redeem
   * a /signup?invite=<token> link. Not called anywhere within this
   * service's own pasted methods — its call site lives inside
   * AuthService.signUp(), which has not itself been pasted this
   * session; this method's existence is confirmed only indirectly, via
   * firm-invitation.service.ts#createInvitation()'s own return-type
   * reference to it.
   *
   * `.maybeSingle()`: an invalid/unknown token is the expected "no
   * match" case, not a DB error — same reasoning as every other
   * single-row lookup in this module.
   */
  async findByToken(token: string): Promise<FirmInvitationRow | null> {
    const { data, error } = await this.supabase
      .from('firm_invitations')
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to find firm invitation by token', error, {
        table: this.tableName,
      });
    }

    return (data as FirmInvitationRow | null) ?? null;
  }

  /**
   * Resolves the current PENDING invitation, if any, for a given
   * (firmId, normalized email) pair — the re-invite lookup Decision
   * #10 needs: before issuing a fresh invitation, the service layer
   * must find and invalidate any existing pending one to the same
   * email, rather than erroring on a partial unique index firing on
   * insert. Direct analog of
   * TeamInvitationRepository#findPendingByTeamAndProfile(), adjusted
   * for firm_invitations' (firm_id, email) shape instead of
   * (team_id, profile_id).
   *
   * Email is expected ALREADY NORMALIZED (trimmed + lowercased) by the
   * caller — firm-invitation.service.ts normalizes before calling this
   * method, so no case-insensitive comparison is applied here, matching
   * that confirmed call site rather than re-normalizing defensively.
   *
   * `.maybeSingle()`: no pending invitation for this email is the
   * common case, not an error. At most one 'pending' row is expected
   * per (firm_id, email) — mirrors team_invitations'
   * (team_id, profile_id) partial-unique-index precedent; the
   * equivalent firm_invitations index was not independently re-pasted
   * this session.
   */
  async findPendingByFirmAndEmail(firmId: string, email: string): Promise<FirmInvitationRow | null> {
    const { data, error } = await this.supabase
      .from('firm_invitations')
      .select('*')
      .eq('firm_id', firmId)
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to find pending firm invitation by firm id and email', error, {
        table: this.tableName,
        firmId,
      });
    }

    return (data as FirmInvitationRow | null) ?? null;
  }

  /**
   * Returns every PENDING invitation addressed to a given profile —
   * the in-app pending-invites list's query. Direct analog of
   * TeamInvitationRepository#findPendingByProfileId(). UNLIKE the team
   * version, this is only ONE of firm_invitations' two acceptance
   * paths (Decision #3) — the token-link path (new-user signup) never
   * touches this method at all, since a brand-new user has no
   * `profile_id` yet at invite time.
   *
   * Same `created_at asc` ordering default as every other list method
   * in this module.
   */
  async findPendingByProfileId(profileId: string): Promise<FirmInvitationRow[]> {
    const { data, error } = await this.supabase
      .from('firm_invitations')
      .select('*')
      .eq('profile_id', profileId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list pending firm invitations by profile id', error, {
        table: this.tableName,
        profileId,
      });
    }

    return (data ?? []) as FirmInvitationRow[];
  }

  /**
   * Returns every invitation ever issued for a firm — pending AND
   * historical — the query FirmInvitationService#listForFirm() needs.
   * Direct analog of TeamInvitationRepository#findByTeamId(): same
   * reasoning, deliberately unfiltered by status, since an owner/admin
   * managing a firm's invitations plausibly wants the full history,
   * not just what's currently outstanding.
   */
  async findByFirmId(firmId: string): Promise<FirmInvitationRow[]> {
    const { data, error } = await this.supabase
      .from('firm_invitations')
      .select('*')
      .eq('firm_id', firmId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list firm invitations by firm id', error, {
        table: this.tableName,
        firmId,
      });
    }

    return (data ?? []) as FirmInvitationRow[];
  }
}