import { z } from 'zod';

/**
 * Zod schemas for Task Management (Phase 4).
 *
 * Written against the real, pasted task.service.ts's createTask()/
 * updateTask() input shapes and the migration's documented
 * status CHECK constraint (`todo`/`in_progress`/`done`) — the migration
 * file itself was NOT re-pasted this session, so that constraint is
 * carried forward from PROJECT_PROGRESS_52.md's own description of it,
 * not independently re-verified against the .sql file. Flagged.
 *
 * SCOPE NOTE: this validates Route-boundary USER INPUT only, same
 * posture as chat.schemas.ts's createChatConversationInputSchema /
 * sendMessageInputSchema — not AI-generated output, so there's no
 * generateStructured()-style schema here.
 *
 * `firmId` and `caseId` are deliberately ABSENT from every schema below.
 * Both POST routes derive these from the URL / from the case row, never
 * from the request body (see task.service.ts's own comment on the real
 * firmId/caseId-mismatch bug this avoids reintroducing) — so validating
 * them here as body fields would contradict that fix. If a future route
 * ever needs to accept either as body input, that's a new decision, not
 * an oversight in this file.
 */

/**
 * Mirrors the migration's `check (status in ('todo', 'in_progress',
 * 'done'))` constraint — NOT independently re-verified against the
 * .sql file this session, carried forward from the progress notes'
 * description of it. Confirm against the real migration file if full
 * rigor is wanted.
 */
export const taskStatusSchema = z.enum(['todo', 'in_progress', 'done']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/**
 * `dueDate` shape: KEY DECISION, NEW JUDGMENT CALL — no prior schema
 * file in this project validates a bare date (vs. timestamp) column,
 * so there's no inherited precedent to lean on. Constrained to
 * `YYYY-MM-DD` to match the migration's plain `date` column (per
 * PROJECT_PROGRESS_52.md: "simple date, no overdue-tracking column, v1
 * only") rather than accepting a full ISO datetime and silently
 * truncating it. Provisional — revisit if the real column type differs
 * once re-verified.
 */
const dueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be in YYYY-MM-DD format.')
  .describe('Due date for the task, as a plain calendar date (no time component).');

/**
 * Input required to create a task — used by both POST routes
 * (case-linked and standalone). `title` is the only required field,
 * matching `tasks`'s presumed NOT NULL on that column (not
 * independently re-verified against the migration this session — same
 * flag as taskStatusSchema above).
 *
 * `description` has no `.max()` — KEY DECISION, NEW JUDGMENT CALL, same
 * kind of provisional call chat.schemas.ts made for `content`'s 4000
 * cap, but this project has no existing free-text task-description
 * precedent to size a limit against. Left unbounded rather than
 * guessing a number; revisit if a real limit is decided.
 */
export const createTaskInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title cannot be empty.')
    .describe('The task title.'),
  description: z
    .string()
    .trim()
    .nullable()
    .optional()
    .describe('Optional free-text task description.'),
  assigneeProfileId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe('The profiles.id of the assignee, if any. Schema-ready for client assignment, though Client Management is currently paused (see PROJECT_PROGRESS_52.md).'),
  dueDate: dueDateSchema.nullable().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

/**
 * Input accepted on PATCH /api/tasks/[id].
 *
 * IMPORTANT — this schema validates the RAW REQUEST BODY ONLY, at the
 * Route boundary. It intentionally does NOT enforce the assignee-vs-
 * non-assignee field restriction: task.service.ts#updateTask() applies
 * that at the Service layer (assignee → status-only, silently dropping
 * other fields; non-assignee → any field), per that method's own
 * documented, still-flagged decision that silent-drop may not be the
 * right failure mode. This schema's job is only to reject a
 * structurally malformed body before it reaches the Service — it
 * cannot and should not encode the identity-dependent authorization
 * rule, which needs `taskId` + the caller's user id to evaluate and so
 * doesn't belong in a stateless input schema.
 *
 * NOT WIRED IN YET: the actual PATCH /api/tasks/[id]/route.ts file was
 * not available this session (a different file, cases/[id]/route.ts,
 * was supplied in its place — see this session's own flag on that).
 * This schema is ready to import and use there once that file is
 * re-pasted.
 *
 * KEY DECISION, NEW JUDGMENT CALL: `.refine()` requires at least one
 * field present, rejecting an empty `{}` body outright rather than
 * letting it silently no-op through to the Service layer. No existing
 * project precedent enforces "at least one field" on a partial-update
 * schema, so this is new, not inherited — revisit if the project's
 * real convention turns out to be "empty PATCH is a harmless no-op."
 */
export const updateTaskInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Title cannot be empty.').optional(),
    description: z.string().trim().nullable().optional(),
    status: taskStatusSchema.optional(),
    assigneeProfileId: z.string().uuid().nullable().optional(),
    dueDate: dueDateSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;