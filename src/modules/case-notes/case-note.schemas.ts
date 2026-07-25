import { z } from 'zod';

/**
 * Zod schemas for Internal Notes and Comments (Phase 4).
 *
 * Written against the real, pasted case-note.service.ts's
 * createNote()/updateNote() input shapes and this session's own
 * migration (20260910000000_create_case_notes_table.sql, FLAGGED as
 * containing inferred-not-verified RLS predicates — the `content text
 * not null` column shape itself is this session's own design, not
 * pasted from elsewhere, so there's no prior-session flag to carry
 * forward on that specific point).
 *
 * SCOPE NOTE: validates Route-boundary USER INPUT only, same posture
 * as task.schemas.ts.
 *
 * `caseId` is deliberately ABSENT from every schema below, same
 * reasoning as task.schemas.ts's own omission of firmId/caseId: the
 * case-scoped POST route derives caseId from the URL, never from the
 * request body.
 */

/**
 * KEY DECISION, NEW JUDGMENT CALL: `content` capped at 10,000
 * characters. No existing project precedent sizes a note/comment body
 * (task.schemas.ts's own `description` field is deliberately
 * unbounded, per that file's own comment, for a different reason —
 * a task description isn't posted repeatedly the way a comment
 * thread is). A comment-style field benefits from SOME cap to keep a
 * case's timeline/notes view from degrading under a single pathological
 * entry; 10,000 is a provisional round number, not derived from a
 * stated product requirement — revisit if a real limit is decided.
 */
const contentSchema = z
  .string()
  .trim()
  .min(1, 'Note content cannot be empty.')
  .max(10000, 'Note content cannot exceed 10,000 characters.')
  .describe('The note/comment body.');

/**
 * Input required to create a note — used by the case-scoped POST
 * route. `content` is the only field; `author_id` is derived
 * server-side from the authenticated user, never accepted from the
 * body (same "never trust the body for an identity field" posture as
 * task.service.ts's createTask() deriving firmId server-side).
 */
export const createNoteInputSchema = z.object({
  content: contentSchema,
});
export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;

/**
 * Input accepted on PATCH /api/case-notes/[id]. Only `content` is
 * editable — there is no status/assignee-style field set the way
 * task.schemas.ts's updateTaskInputSchema has, since
 * CaseNoteService#updateNote() is author-only with no
 * assignee-vs-non-assignee branch to account for.
 */
export const updateNoteInputSchema = z.object({
  content: contentSchema,
});
export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;