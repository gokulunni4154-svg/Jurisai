// src/modules/user-management/client.service.ts

import 'server-only';

import { BaseService } from '@/core/services/base.service';
import type { AuthUser } from '@/core/auth/types';
import { ValidationError } from '@/core/errors/app-error';

import { ClientRepository } from './client.repository';
import { FirmMemberRepository } from './firm-member.repository';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

interface CreateClientInput {
  readonly firmId: string;
  readonly fullName: string;
  readonly email: string;
  readonly phone?: string | null;
}

interface UpdateClientInput {
  readonly fullName?: string;
  readonly email?: string;
  readonly phone?: string | null;
}

/**
 * ClientService
 * ----------------------
 * Client Management. THE MISSING PIECE flagged at the end of last
 * session — every other Client Management file built so far
 * (client-invitation.repository/service/factory.ts, both routes)
 * assumed a `clients` row already exists. This class is what actually
 * creates and edits that row.
 *
 * AUTHORIZATION, DELIBERATE DECISION MADE BY CLAUDE AT THE USER'S
 * EXPLICIT DELEGATION ("u csn decide"): owner/admin only, via
 * requireFirmRole(['owner', 'admin']) — NOT extended to team leads,
 * despite the ORIGINAL LOCKED PRODUCT DECISION reading "Only team leads/
 * firm admins can create/edit clients."
 *
 * Real conflict found, not invented: the clients migration's own RLS
 * policies (clients_insert_firm_manage, clients_update_firm_manage,
 * clients_select_firm_manage — all three, confirmed in the pasted
 * migration) check ONLY `firm_members.role in ('owner', 'admin')`.
 * There is no team-lead branch anywhere in that migration. A team lead
 * who is not also a firm owner/admin cannot pass those RLS policies
 * today, full stop, regardless of what this service layer decides.
 *
 * This service's writes go through the admin client (same pattern as
 * every other factory in this project — see client.factory.ts once
 * built), which technically BYPASSES RLS entirely. That means this
 * service COULD have let team leads through at the service-layer check
 * alone and it would still have worked today. Deliberately NOT done:
 * diverging service-layer authorization from the real, applied RLS
 * would create a latent inconsistency that breaks the moment any
 * RLS-respecting (non-admin-client) query touches this table, and no
 * real TeamMemberRepository source has been pasted/confirmed this
 * session to build that check against correctly anyway.
 *
 * REVISIT: if team leads are meant to have this access per the locked
 * decision, the real fix is a new migration adding a team-lead-aware
 * policy to clients' RLS (and this service's requireFirmRole() call
 * would need a parallel team-lead check added, requiring
 * TeamMemberRepository's real source) — not a service-layer-only
 * workaround. Flagged here explicitly so this narrowing isn't mistaken
 * for the original decision being fulfilled.
 */
export class ClientService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly clientRepository: ClientRepository,
    private readonly firmMemberRepository: FirmMemberRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {
    super(currentUser);
  }

  private async resolveCallerFirmRole(firmId: string, userId: string) {
    return this.firmMemberRepository.findByFirmAndProfile(firmId, userId);
  }

  /**
   * Creates a new client record. Owner/admin only — see class doc
   * comment. `profile_id` is never supplied here — it stays null (the
   * column's own confirmed default/nullable state) until the client
   * completes portal signup via signUpAsClient(), same locked decision
   * every other file this session already builds around.
   *
   * NO DEDUP-BY-EMAIL CHECK: the clients migration's own header
   * explicitly leaves this unenforced (no unique constraint, flagged
   * there as a revisit-once-confirmed item, not a decision either way).
   * Not invented here — a firm can currently create two client records
   * with the same email, and this method does not stop that.
   */
  async createClient(input: CreateClientInput) {
    const user = this.requireAuthentication();

    const callerFirmRole = await this.resolveCallerFirmRole(input.firmId, user.id);
    this.requireFirmRole(callerFirmRole, ['owner', 'admin']);

    const fullName = input.fullName.trim();

    if (fullName.length === 0) {
      throw new ValidationError('fullName is required.', { received: input.fullName });
    }

    const client = await this.clientRepository.create({
      firm_id: input.firmId,
      full_name: fullName,
      email: input.email.trim().toLowerCase(),
      phone: input.phone ?? null,
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: input.firmId,
      action: 'client.create',
      resourceType: 'clients',
      resourceId: client.id,
    });

    return client;
  }

  /**
   * Updates an existing client record. Owner/admin only, scoped to the
   * client's own firm — resolves firmId from the row itself
   * (findByIdOrThrow first), same authorization-safety reasoning every
   * other service this session gives for not trusting a
   * separately-supplied firmId from caller input.
   *
   * Deliberately does NOT allow `profile_id` to be set/cleared through
   * this method — that column is exclusively managed by
   * signUpAsClient() (on accept) and, in principle, a future
   * unlink/offboarding flow (not built, not scoped). Keeping it out of
   * UpdateClientInput's shape entirely, rather than accepting it and
   * ignoring it, so this can't be miscalled into looking like it
   * supports relinking.
   */
  async updateClient(clientId: string, input: UpdateClientInput) {
    const user = this.requireAuthentication();

    const client = await this.clientRepository.findByIdOrThrow(clientId);

    const callerFirmRole = await this.resolveCallerFirmRole(client.firm_id, user.id);
    this.requireFirmRole(callerFirmRole, ['owner', 'admin']);

    if (input.fullName !== undefined && input.fullName.trim().length === 0) {
      throw new ValidationError('fullName cannot be empty.', { received: input.fullName });
    }

    const updated = await this.clientRepository.update(clientId, {
      ...(input.fullName !== undefined && { full_name: input.fullName.trim() }),
      ...(input.email !== undefined && { email: input.email.trim().toLowerCase() }),
      ...(input.phone !== undefined && { phone: input.phone }),
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: client.firm_id,
      action: 'client.update',
      resourceType: 'clients',
      resourceId: clientId,
    });

    return updated;
  }

  /**
   * Lists every client record for a firm. Owner/admin only — matches
   * clients_select_firm_manage's real RLS scope exactly (confirmed in
   * the pasted migration: there is no firm-wide read policy on this
   * table for regular employee/lawyer FirmRoles at all, unlike e.g.
   * firm_members' roster, which IS firm-wide readable). Not a narrower
   * choice made here — this mirrors what the real RLS already allows.
   */
  async listForFirm(firmId: string) {
    const user = this.requireAuthentication();

    const callerFirmRole = await this.resolveCallerFirmRole(firmId, user.id);
    this.requireFirmRole(callerFirmRole, ['owner', 'admin']);

    return this.clientRepository.findByFirmId(firmId);
  }

  /**
   * Fetches a single client record. Same owner/admin scoping as
   * listForFirm() — see that method's own doc comment.
   */
  async getClient(clientId: string) {
    const user = this.requireAuthentication();

    const client = await this.clientRepository.findByIdOrThrow(clientId);

    const callerFirmRole = await this.resolveCallerFirmRole(client.firm_id, user.id);
    this.requireFirmRole(callerFirmRole, ['owner', 'admin']);

    return client;
  }
}