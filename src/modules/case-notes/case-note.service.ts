// src/modules/case-notes/case-note.service.ts
// Internal Notes and Comments — Phase 4. Built directly against the
// real, pasted task.service.ts for its create/list/update/delete
// shape and its requireTaskCreateAccess()-style private access-check
// helper — this service's own requireNoteAccess() mirrors that
// structure, but against a DELIBERATELY NARROWER rule than every other
// case-scoped module in this project:
//
//   Case owner OR an active READ_WRITE grantee — same test as
//   task.service.ts's requireTaskCreateAccess() case-linked path.
//
//   READ-ONLY grantees are excluded ENTIRELY (cannot list, cannot
//   post) — unlike case-timeline.service.ts's access rule (owner OR
//   EITHER access level, confirmed product decision), this is
//   deliberately narrower because "internal" notes are read as
//   firm-staff-only. FLAGGED: this is this session's own judgment
//   call, not a re-confirmed product decision — same flag posture as
//   task.service.ts's own requireTaskCreateAccess() carried when it
//   was first built.
//
// No standalone-firm-note concept — unlike TaskService, there is no
// second branch here for a null caseId (case_notes.case_id is NOT
// NULL per the migration). requireNoteAccess() therefore takes a
// single, non-nullable caseId, simpler than
// requireTaskCreateAccess()'s two-path (case-linked/standalone) shape.
//
// AUDIT LOG: writes 'note.create'/'note.update'/'note.delete' events,
// same auditLogRepository dependency and recordUserAction() call shape
// as task.service.ts/case.service.ts. DELIBERATE DIFFERENCE, flagged:
// metadata never includes `content` — the Case Timeline's own audience
// is wider than a note's own visibility (case-timeline.service.ts's
// confirmed access rule includes read-only grantees; this service's
// requireNoteAccess() excludes them), so including note content in
// audit metadata would leak internal note content to a viewer who
// cannot see the note directly. Metadata carries only `noteId`.

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { BaseService } from '@/core/services/base.service';
import type { Database } from '@/core/supabase/database.types';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import type { CaseAccessGrantRepository } from '@/modules/cases/case-access-grant.repository';
import type { CaseRepository } from '@/modules/cases/case.repository';

import type { CaseNoteRepository } from './case-note.repository';

type CaseNoteRow = Database['public']['Tables']['case_notes']['Row'];

export class CaseNoteService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly caseNoteRepository: CaseNoteRepository,
    private readonly caseRepository: CaseRepository,
    private readonly caseAccessGrantRepository: CaseAccessGrantRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {
    super(currentUser);
  }

  /**
   * Creates a note on a case. Requires the caller either OWN the case,
   * or hold an active READ_WRITE grant on it — see this file's own
   * header for why read-only grantees are excluded entirely, unlike
   * every other case-scoped module.
   */
  async createNote(input: { caseId: string; content: string }): Promise<CaseNoteRow> {
    const { user, caseRow } = await this.requireNoteAccess(input.caseId);

    const note = await this.caseNoteRepository.create({
      case_id: input.caseId,
      author_id: user.id,
      content: input.content,
    } as never);

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: caseRow.firm_id,
      caseId: note.case_id,
      action: 'note.create',
      resourceType: 'case_note',
      resourceId: note.id,
      metadata: { noteId: note.id },
    });

    return note;
  }

  /**
   * Lists every note on a case. Re-checks access explicitly here
   * (rather than only relying on RLS, as list methods elsewhere in
   * this project do) — DELIBERATE DIFFERENCE, flagged: read-only
   * grantees are meant to be excluded even from seeing THAT notes
   * exist (not just their content), which is narrower than every
   * other list method's security intent in this project. The
   * migration's RLS predicate for this (case_notes_select) is now
   * CONFIRMED correct against the real case_access_grants migration
   * (revoked_at is null / access_level = 'read_write', copied
   * directly, not inferred) — this app-layer check is kept anyway as
   * a second, independent enforcement point given how narrow the
   * intended exclusion is, not as a hedge against unverified SQL.
   */
  async listNotesForCase(caseId: string): Promise<CaseNoteRow[]> {
    await this.requireNoteAccess(caseId);
    return this.caseNoteRepository.findByCaseId(caseId);
  }

  /**
   * Updates a note's content. Author-only — no case-owner override,
   * unlike deleteNote() below. A case owner moderating someone else's
   * note by deleting it is a coarser action than silently rewriting
   * its content; editing another firm member's note text was judged
   * out of scope for v1. FLAGGED: this session's own judgment call.
   */
  async updateNote(noteId: string, content: string): Promise<CaseNoteRow> {
    const user = this.requireAuthentication();
    const note = await this.caseNoteRepository.findByIdOrThrow(noteId);

    this.requireOwnership(note.author_id);

    const updated = await this.caseNoteRepository.update(noteId, { content } as never);

    const caseRow = await this.caseRepository.findByIdOrThrow(note.case_id);

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: caseRow.firm_id,
      caseId: note.case_id,
      action: 'note.update',
      resourceType: 'case_note',
      resourceId: note.id,
      metadata: { noteId: note.id },
    });

    return updated;
  }

  /**
   * Deletes a note. Author OR the case owner (owner can moderate their
   * own case's notes) — matches the migration's case_notes_delete RLS
   * policy exactly.
   */
  async deleteNote(noteId: string): Promise<void> {
    const user = this.requireAuthentication();
    const note = await this.caseNoteRepository.findByIdOrThrow(noteId);
    const caseRow = await this.caseRepository.findByIdOrThrow(note.case_id);

    const isAuthor = note.author_id === user.id;
    const isCaseOwner = caseRow.owner_id === user.id;

    if (!isAuthor && !isCaseOwner) {
      this.requireOwnership(note.author_id);
    }

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: caseRow.firm_id,
      caseId: note.case_id,
      action: 'note.delete',
      resourceType: 'case_note',
      resourceId: note.id,
      metadata: { noteId: note.id },
    });

    await this.caseNoteRepository.delete(noteId);
  }

  /**
   * Shared access check: case owner OR an active READ_WRITE grantee.
   * See this file's own header for why read-only grantees are
   * excluded entirely — deliberately narrower than
   * task.service.ts's requireTaskCreateAccess(), which has no
   * standalone-firm-note second path since case_notes.case_id is NOT
   * NULL.
   *
   * Duplicated rather than shared with TaskService's own
   * requireTaskCreateAccess(), per this project's established "no
   * cross-Service private-helper sharing beyond BaseService itself"
   * convention (base.service.ts's own class doc comment).
   */
  private async requireNoteAccess(
    caseId: string,
  ): Promise<{ user: AuthUser; caseRow: Database['public']['Tables']['cases']['Row'] }> {
    const user = this.requireAuthentication();
    const caseRow = await this.caseRepository.findByIdOrThrow(caseId);

    if (caseRow.owner_id === user.id) {
      return { user, caseRow };
    }

    const grant = await this.caseAccessGrantRepository.findActiveGrantForCaseAndProfile(
      caseId,
      user.id,
    );

    if (grant?.access_level === 'read_write') {
      return { user, caseRow };
    }

    // No ownership and no valid read_write grant -- throws. Includes a
    // read-only grantee, deliberately, per this file's own header.
    this.requireOwnership(caseRow.owner_id);

    // Unreachable — requireOwnership() always throws on failure. This
    // return keeps TypeScript's control-flow analysis satisfied without
    // an explicit `never`-typed throw duplication.
    throw new Error('unreachable');
  }
}