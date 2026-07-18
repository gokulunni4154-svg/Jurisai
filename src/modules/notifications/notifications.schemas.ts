import { z } from 'zod';

import { paginationSchema, uuidSchema } from '@/core/validation/common.schemas';

/**
 * Must match the `type in (...)` check constraint on public.notifications
 * (migration 20260725010000_create_notifications_table.sql). Kept as an
 * application-level enum for the same reason MAX_TITLE_LENGTH duplicates
 * File 45's check constraint (documents.schemas.ts): a bad value is
 * rejected with a clear ValidationError before ever reaching Postgres.
 * If the migration's constraint list ever grows, this must grow with it.
 */
export const NotificationType = z.enum(['hearing_date_set', 'hearing_date_reminder']);
export type NotificationType = z.infer<typeof NotificationType>;

/**
 * Server-derived, not client input. Both current notification types are
 * created by server-side logic (inline on a hearing_date update, or by
 * the future Vercel Cron job) that already knows every field -- there is
 * no route where a client submits a notification body directly, unlike
 * createDocumentSchema which validates a value assembled from a
 * completed upload. Kept here anyway, `.strict()`, as the single place
 * the Notifications Service/Repository validate a row shape before
 * insert, following the same defense-in-depth rationale
 * createDocumentSchema's own comment states.
 */
export const createNotificationSchema = z
  .object({
    userId: uuidSchema,
    documentId: uuidSchema,
    type: NotificationType,
    title: z.string().trim().min(1, 'Title is required.'),
    message: z.string().trim().min(1, 'Message is required.'),
    hearingDateSnapshot: z.coerce.date(),
  })
  .strict();

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;

/**
 * Only read_at is mutable after creation, and only in one direction
 * (marking read) -- same "narrow, single-purpose update schema" pattern
 * as updateDocumentSchema (title-only). No payload fields are needed
 * from the client; the route sets read_at = now() server-side. Kept as
 * an empty `.strict()` object rather than skipping validation entirely,
 * so a caller who sends an unexpected body gets a clear
 * ValidationError instead of the extra fields being silently ignored.
 */
export const markNotificationReadSchema = z.object({}).strict();

export type MarkNotificationReadInput = z.infer<typeof markNotificationReadSchema>;

export const notificationIdParamSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

export type NotificationIdParam = z.infer<typeof notificationIdParamSchema>;

/**
 * Extends the shared paginationSchema (File 24) with an unreadOnly
 * filter, same shape as listDocumentsQuerySchema's includeDeleted
 * filter -- the common case (unread notifications, e.g. a bell-icon
 * count/list) is the deliberate default; a full history view is the
 * exception and must be explicitly requested.
 */
export const listNotificationsQuerySchema = paginationSchema
  .extend({
    unreadOnly: z.coerce.boolean().optional().default(false),
  })
  .strict();

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;