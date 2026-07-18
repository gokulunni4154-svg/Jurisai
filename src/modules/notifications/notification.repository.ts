// src/modules/notifications/notification.repository.ts
// Notifications module

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError, NotFoundError } from '@/core/errors/app-error';
import { BaseRepository, type FindManyOptions } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';

type NotificationRow = Database['public']['Tables']['notifications']['Row'];

export interface NotificationFindManyOptions extends FindManyOptions {
  /**
   * When false/omitted (default), only unread rows (`read_at IS NULL`)
   * are returned. Mirrors listNotificationsQuerySchema's unreadOnly flag
   * — same "list filter lives in the Repository, base class has no
   * concept of it" division of labor as DocumentFindManyOptions'
   * includeDeleted (document.repository.ts), inverted: documents default
   * to excluding a state, notifications default to it being the ONLY
   * thing shown, since the common case for this table is a bell-icon
   * unread list, not a full history view.
   */
  unreadOnly?: boolean;
}

/**
 * Notifications module's repository. Built against real generated types
 * — Database['public']['Tables']['notifications'] matches
 * 20260725010000_create_notifications_table.sql exactly: id, user_id,
 * document_id, type, title, message, hearing_date_snapshot, read_at
 * (nullable), created_at.
 *
 * Extends BaseRepository<'notifications'> and inherits findById,
 * findByIdOrThrow, create, and update as-is — none need
 * notifications-specific behavior beyond what's overridden below.
 *
 * RLS (see the migration) scopes all reads/writes to
 * `user_id = auth.uid()` (plus the admin app_metadata claim), so this
 * repository never adds an explicit user_id filter itself — same
 * rationale document.repository.ts's own class comment states for
 * owner_id: the injected Supabase client determines visibility, and
 * duplicating that filter here would silently drift from RLS if the two
 * were ever changed independently.
 */
export class NotificationRepository extends BaseRepository<'notifications'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'notifications');
  }

  /**
   * Overrides BaseRepository#findMany. Unlike document.repository.ts's
   * override (which excludes a state by default), this one INCLUDES
   * only unread rows by default — unreadOnly defaults to true here,
   * inverted from includeDeleted's false default, because the common
   * call site (a notification bell) wants "what hasn't the user seen
   * yet", and a full-history view is the deliberate exception.
   */
  override async findMany(options?: NotificationFindManyOptions): Promise<NotificationRow[]> {
    let query = this.supabase.from('notifications').select('*').order('created_at', { ascending: false });

    if (options?.unreadOnly !== false) {
      query = query.is('read_at', null);
    }

    if (options?.limit != null) {
      const from = options.offset ?? 0;
      const to = from + options.limit - 1;
      query = query.range(from, to);
    }

    const { data, error } = await query;

    if (error) {
      throw new DatabaseError('Failed to list notifications', error, {
        table: this.tableName,
        options,
      });
    }

    return (data ?? []) as NotificationRow[];
  }

  /**
   * Overrides BaseRepository#count with the same unreadOnly semantics
   * as findMany above, so an unread-count badge matches what findMany
   * would return for the same filter.
   */
  override async count(options?: { unreadOnly?: boolean }): Promise<number> {
    let query = this.supabase.from('notifications').select('*', { count: 'exact', head: true });

    if (options?.unreadOnly !== false) {
      query = query.is('read_at', null);
    }

    const { count, error } = await query;

    if (error) {
      throw new DatabaseError('Failed to count notifications', error, {
        table: this.tableName,
        options,
      });
    }

    return count ?? 0;
  }

  /**
   * Marks a single notification read. Deliberately idempotent, unlike
   * document.repository.ts's delete() override: re-marking an
   * already-read notification isn't a state-loss risk the way a second
   * soft-delete is (that method's own comment explains why THAT case is
   * treated as an error) — there's no audit-trail reason to reject a
   * duplicate "mark read" call, so this does not guard against
   * read_at already being non-null.
   *
   * Still throws NotFoundError if the row doesn't exist or isn't
   * RLS-visible to the caller (id genuinely wrong, or belongs to another
   * user) — .maybeSingle() returning null covers both cases identically,
   * same pattern as delete()'s own null check.
   */
  async markAsRead(id: string): Promise<NotificationRow> {
    const { data, error } = await this.supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() } as never)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to mark notification read', error, {
        table: this.tableName,
        id,
      });
    }

    if (!data) {
      throw new NotFoundError(String(this.tableName), id);
    }

    return data as NotificationRow;
  }

  /**
   * NEW — resolves the dedup question flagged (and left unresolved) in
   * 20260718000000_add_hearing_date_to_documents.sql / carried forward
   * into 20260725010000_create_notifications_table.sql's own header
   * comment. The future cron route calls this BEFORE sending a reminder
   * for a document currently inside the 3-day window: if it returns
   * true, a reminder for this exact hearing_date has already been sent
   * and the cron route must skip it; if false, the cron route sends the
   * reminder and then calls create() to insert the row that makes this
   * return true on the next run.
   *
   * Deliberately pure data-layer, same division-of-labor pattern as
   * createSignedDownloadUrl() in document.repository.ts: this method
   * does not itself decide whether a document is inside the reminder
   * window — that's the future cron route's own query against
   * documents_hearing_date_active_idx (File 174). This only answers
   * "has a reminder already gone out for this document's CURRENT
   * hearing_date", using the notifications_reminder_dedup_idx partial
   * index built for exactly this query shape.
   *
   * Runs under the admin.ts service-role client (see the migration's
   * RLS comment — the cron job has no requesting user in scope), so
   * this is not RLS-narrowed to any single user's rows; callers must
   * pass a real documentId, not rely on RLS to scope it.
   */
  async reminderAlreadySent(documentId: string, hearingDate: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('notifications')
      .select('id')
      .eq('document_id', documentId)
      .eq('type', 'hearing_date_reminder')
      .eq('hearing_date_snapshot', hearingDate)
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to check reminder dedup state', error, {
        table: this.tableName,
        documentId,
        hearingDate,
      });
    }

    return data != null;
  }
}