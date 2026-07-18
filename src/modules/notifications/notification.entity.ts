import type { NotificationType } from '@/modules/notifications/notifications.schemas';

/**
 * Mirrors the `notifications` table (see migration
 * 20260725010000_create_notifications_table.sql). Snake_case, matching
 * Postgrest's default column naming -- same convention DocumentAnalysis
 * (File 63) follows, no camelCase mapping layer.
 */
export interface Notification {
  id: string;
  user_id: string;
  document_id: string;
  type: NotificationType;
  title: string;
  message: string;
  hearing_date_snapshot: string;
  read_at: string | null;
  created_at: string;
}

/**
 * Fields required to create a notification. Both current types
 * (hearing_date_set, hearing_date_reminder) are document-scoped and
 * always know the hearing_date they pertain to at creation time, so
 * hearing_date_snapshot is required here, not populated later --
 * unlike DocumentAnalysis's result/status fields, nothing on this row
 * is filled in after the fact except read_at.
 */
export interface CreateNotificationInput {
  user_id: string;
  document_id: string;
  type: NotificationType;
  title: string;
  message: string;
  hearing_date_snapshot: string;
}