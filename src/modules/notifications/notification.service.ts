// src/modules/notifications/notification.service.ts
// Notifications module

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { AuthorizationError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';
import type { Database } from '@/core/supabase/database.types';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

import type { NotificationRepository } from './notification.repository';
import {
  createNotificationSchema,
  listNotificationsQuerySchema,
  notificationIdParamSchema,
} from './notifications.schemas';

type NotificationRow = Database['public']['Tables']['notifications']['Row'];

export interface ListNotificationsResult {
  notifications: NotificationRow[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Notifications module's Service layer. Orchestrates
 * notifications.schemas.ts's Zod schemas and NotificationRepository
 * behind BaseService's authorization primitives (File 23) — same shape
 * as DocumentService, same `rawInput: unknown`, parse-internally
 * convention (D4/D5).
 *
 * KEY DECISION, mirroring DocumentService's read-visibility model:
 * listNotifications relies on RLS (user_id = auth.uid(), plus the admin
 * branch) rather than an explicit ownership filter — same rationale,
 * not duplicated here since it applies unmodified: the injected
 * repository's Supabase client is what decides visibility.
 *
 * KEY DECISION, DIVERGING FROM createDocument's model: createNotification
 * checks input.userId against the current user (see method comment) — a
 * stricter version of createDocument's ownerSegment check, because
 * unlike a storage path (which only encodes ownership incidentally),
 * userId here IS the row's actual ownership column, so there's no
 * reason to allow any mismatch at all, not even a structurally-valid one.
 *
 * KNOWN GAP, FLAGGED NOT SOLVED — this Service assumes a real
 * currentUser is always present (requireAuthentication() is called by
 * every method, same as DocumentService). That's correct for the
 * 'hearing_date_set' path (created inline, in a real user's request) but
 * WILL NOT WORK for the future Vercel Cron job's 'hearing_date_reminder'
 * creation — the migration's own RLS comment already establishes that
 * path has no requesting user in scope and runs under admin.ts instead.
 * This Service, constructed via buildNotificationService() below, is not
 * meant to be reused as-is for that path. Left unresolved deliberately:
 * whether the cron route calls NotificationRepository directly
 * (bypassing this Service/BaseService entirely, since "current user"
 * isn't a meaningful concept for a system-triggered write) or a second,
 * system-mode factory/service variant gets built, is a decision for
 * when the cron route itself is built — not decided here.
 *
 * AMENDED, THIS SESSION — AuditLogRepository added as a 4th constructor
 * dependency, closing the "Notifications write zero audit entries" gap
 * (prior sessions' addenda, Item #1). createNotification() and
 * markAsRead() each write an audit entry as their last step, after the
 * real mutation succeeds — same ordering document.service.ts already
 * established for its own three mutations. Neither write is wrapped in
 * a try/catch: see this file's own session-note below on why that's a
 * flagged, not silently accepted, risk.
 *
 * FLAGGED, ENGINEERING JUDGMENT CALL, NOT CONFIRMED SCOPE: markAsRead()
 * is treated as audit-worthy (the notifications-module analog of
 * updateDocument()), not as a read. The prior addendum's Item #1 only
 * said "Notifications... write zero audit entries" without naming which
 * methods — if only creation should be audited, the markAsRead() audit
 * write below should be removed.
 */
export class NotificationService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly notificationRepository: NotificationRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {
    super(currentUser);
  }

  /**
   * Creates a notification. Scoped, for now, to the 'hearing_date_set'
   * path only — see class-level doc comment on why the
   * 'hearing_date_reminder' path can't use this method as constructed.
   *
   * input.userId is checked against the current user rather than
   * trusted as given, same defense-in-depth spirit as createDocument's
   * ownerSegment check — a caller cannot create a notification
   * addressed to someone else through this method.
   *
   * AMENDED, THIS SESSION: writes a 'notifications.create' audit entry
   * as the last step, after the real insert succeeds. Not wrapped in a
   * try/catch — see class-level doc comment.
   */
  async createNotification(rawInput: unknown): Promise<NotificationRow> {
    const user = this.requireAuthentication();
    const input = createNotificationSchema.parse(rawInput);

    if (input.userId !== user.id) {
      throw new AuthorizationError(
        'Cannot create a notification addressed to a different user.',
        { expectedUserId: user.id, actualUserId: input.userId },
      );
    }

    const notification = await this.notificationRepository.create({
      user_id: input.userId,
      document_id: input.documentId,
      type: input.type,
      title: input.title,
      message: input.message,
      hearing_date_snapshot: input.hearingDateSnapshot.toISOString(),
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      action: 'notifications.create',
      resourceType: 'notification',
      resourceId: notification.id,
      metadata: { type: notification.type },
    });

    return notification;
  }

  /**
   * Lists notifications visible to the current actor. Visibility is
   * governed by RLS (see class-level doc comment) — this method does
   * not itself add a user_id filter. unreadOnly defaults to false via
   * listNotificationsQuerySchema (a full-history default at the
   * schema/query-contract level), even though
   * NotificationRepository#findMany's own default leans the other way
   * absent an explicit query value — the schema's `.default(false)` is
   * what actually reaches the repository, so that's the default that
   * governs in practice; flagged here since the two defaults read as
   * contradictory in isolation.
   *
   * NOT audited — a read, same reasoning getDownloadUrl() was excluded
   * in document.service.ts.
   */
  async listNotifications(rawQuery: unknown): Promise<ListNotificationsResult> {
    this.requireAuthentication();
    const query = listNotificationsQuerySchema.parse(rawQuery);

    const [notifications, total] = await Promise.all([
      this.notificationRepository.findMany({
        limit: query.limit,
        offset: query.offset,
        unreadOnly: query.unreadOnly,
      }),
      this.notificationRepository.count({ unreadOnly: query.unreadOnly }),
    ]);

    return { notifications, total, limit: query.limit, offset: query.offset };
  }

  /**
   * Marks a single notification read. Owner-only, same
   * fetch-then-check-then-mutate shape as updateDocument — RLS's
   * notifications_update_own policy would also block a cross-user
   * update at the database layer, but this application-layer check
   * exists for the same reason DocumentService's class-level doc
   * comment gives for its own write checks: a clean AuthorizationError
   * beats a confusing DatabaseError surfaced from a blocked RLS write.
   *
   * Same TOCTOU acceptance as updateDocument/deleteDocument — not
   * transactional, acceptable because only the owner can ever mutate
   * their own row today.
   *
   * AMENDED, THIS SESSION: writes a 'notifications.mark_read' audit
   * entry as the last step — see class-level doc comment's flagged
   * judgment call on whether this method should be audited at all.
   */
  async markAsRead(rawParams: unknown): Promise<NotificationRow> {
    this.requireAuthentication();
    const { id } = notificationIdParamSchema.parse(rawParams);

    const existing = await this.notificationRepository.findByIdOrThrow(id);

    this.requireOwnership(existing.user_id);

    const updated = await this.notificationRepository.markAsRead(id);

    await this.auditLogRepository.recordUserAction({
      actorId: existing.user_id,
      action: 'notifications.mark_read',
      resourceType: 'notification',
      resourceId: id,
    });

    return updated;
  }
}