// Real path: src/modules/hearings/hearing.schemas.ts
//
// Mirrors task.schemas.ts's real posture: validates Route-boundary user
// input only. `firmId`/`caseId` are deliberately ABSENT from both
// schemas below, same reasoning as task.schemas.ts's own header --
// caseId comes from the URL param on POST /api/cases/[id]/hearings,
// firmId is derived server-side from the case row, never trusted from
// the body. `reminderSentAt` is likewise absent from both schemas --
// it is cron/service-set only (see hearing.repository.ts#markReminderSent),
// never client-writable.

import { z } from 'zod';

import { isoDateTimeSchema } from '@/core/validation/common.schemas';

/**
 * Mirrors the migration's
 * `check (hearing_type in ('first_hearing','arguments','evidence','judgment','other'))`
 * constraint (20260904000000_create_hearings_table.sql, real, pasted
 * this session -- not carried forward from a summary, unlike
 * task.schemas.ts's own taskStatusSchema flag).
 */
export const hearingTypeSchema = z.enum([
  'first_hearing',
  'arguments',
  'evidence',
  'judgment',
  'other',
]);
export type HearingType = z.infer<typeof hearingTypeSchema>;

/**
 * hearingDate is a full ISO 8601 datetime (not a plain YYYY-MM-DD, per
 * the migration's real `timestamptz` column type) -- reuses
 * isoDateTimeSchema from common.schemas.ts (real, pasted this session)
 * rather than redefining a datetime regex inline, matching that file's
 * own stated purpose ("domain schemas... should import primitives from
 * here rather than redefine them").
 *
 * Input required to create a hearing. `hearingDate` is the only
 * required field beyond what the route derives -- matches
 * `hearings.hearing_date not null`, confirmed against the real
 * migration this session (not carried forward from a summary).
 */
export const createHearingInputSchema = z.object({
  hearingDate: isoDateTimeSchema.describe('The hearing date/time, ISO 8601.'),
  hearingType: hearingTypeSchema.optional().describe('Defaults to "other" at the DB layer if omitted.'),
  courtName: z.string().trim().nullable().optional(),
  location: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});
export type CreateHearingInput = z.infer<typeof createHearingInputSchema>;

/**
 * Input accepted on PATCH /api/hearings/[id]. `outcome` is update-only
 * (absent from createHearingInputSchema) -- KEY DECISION, NEW JUDGMENT
 * CALL: an outcome is only meaningful once a hearing has occurred, so
 * there's no legitimate value for it at creation time. Same
 * "at least one field required" `.refine()` as
 * updateTaskInputSchema, for the identical reason (reject an empty
 * `{}` body outright rather than letting it silently no-op through).
 */
export const updateHearingInputSchema = z
  .object({
    hearingDate: isoDateTimeSchema.optional(),
    hearingType: hearingTypeSchema.optional(),
    courtName: z.string().trim().nullable().optional(),
    location: z.string().trim().nullable().optional(),
    notes: z.string().trim().nullable().optional(),
    outcome: z.string().trim().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });
export type UpdateHearingInput = z.infer<typeof updateHearingInputSchema>;