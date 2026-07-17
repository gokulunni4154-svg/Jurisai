import type { SupabaseClient } from '@supabase/supabase-js';

import { BaseRepository, type FindManyOptions } from '@/core/repositories/base.repository';
import { DatabaseError } from '@/core/errors/app-error';
import type { Database } from '@/core/supabase/database.types';
import type {
  ChatConversation,
  ChatMessage,
  CreateChatConversationInput,
  CreateChatMessageInput,
} from '@/modules/chat/chat.entity';

/**
 * Repository layer for Module 8 (AI Legal Chat) — File 151.
 *
 * Two repository classes in one file, a departure from every prior
 * module (one table, one repository, one file). Chat has two tables, and
 * the project's path convention is per-module rather than per-table, so
 * both classes live here rather than splitting into separate files.
 *
 * DISCREPANCY FLAGGED, NOT SILENTLY WORKED AROUND: base.repository.ts's
 * own docstring references a protected `wrapQueryError` helper for
 * exactly this situation ("build a query in a concrete repository method
 * and reuse wrapQueryError"), but no such method exists anywhere in the
 * real pasted source — every base method inlines its own
 * `if (error) throw new DatabaseError(...)` block instead. Rather than
 * inventing wrapQueryError's implementation to make the docstring true,
 * every custom query method below inlines the same DatabaseError pattern
 * manually, copying the exact style already used by findById/findMany/
 * create/update/delete. Worth raising as a real base.repository.ts
 * amendment at some point (it would de-duplicate this across every
 * module with custom queries, not just this one) — not fixed silently
 * here.
 */

export class ChatConversationRepository extends BaseRepository<'chat_conversations'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'chat_conversations');
  }

  /**
   * Lists a single user's conversations, most recently active first.
   * Custom query, not base findMany() — findMany() only supports
   * offset/limit, with no filtering or ordering. user_id filtering here
   * is a query concern, not an authorization decision: the Service layer
   * is responsible for resolving the current user (requireAuthentication())
   * before ever calling this method with their id.
   */
  async findManyForUser(
    userId: string,
    options?: FindManyOptions,
  ): Promise<ChatConversation[]> {
    let query = this.supabase
      .from('chat_conversations')
      .select('*')
      .eq('user_id', userId)
      .order('last_message_at', { ascending: false });

    if (options?.limit != null) {
      const from = options.offset ?? 0;
      const to = from + options.limit - 1;
      query = query.range(from, to);
    }

    const { data, error } = await query;

    if (error) {
      throw new DatabaseError('Failed to list chat_conversations for user', error, {
        table: 'chat_conversations',
        userId,
        options,
      });
    }

    return (data ?? []) as ChatConversation[];
  }

  /**
   * Explicitly bumps updated_at and last_message_at to now(). Exists
   * because File 148's migration deliberately does not assume/invent an
   * unverified shared set_updated_at() trigger function — this
   * maintains those two columns at the application layer instead, via
   * the base class's existing generic update(). Should be called by the
   * Service every time a new message is appended to a conversation.
   */
  async touch(id: string): Promise<ChatConversation> {
    const now = new Date().toISOString();

    return this.update(id, {
      updated_at: now,
      last_message_at: now,
    } as Database['public']['Tables']['chat_conversations']['Update']) as Promise<ChatConversation>;
  }
}

export class ChatMessageRepository extends BaseRepository<'chat_messages'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'chat_messages');
  }

  /**
   * Lists a conversation's messages in chronological order (oldest
   * first) — the order a chat thread should be displayed/replayed in.
   * Custom query for the same reason as findManyForUser above: base
   * findMany() has no ordering support.
   */
  async findManyForConversation(
    conversationId: string,
    options?: FindManyOptions,
  ): Promise<ChatMessage[]> {
    let query = this.supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (options?.limit != null) {
      const from = options.offset ?? 0;
      const to = from + options.limit - 1;
      query = query.range(from, to);
    }

    const { data, error } = await query;

    if (error) {
      throw new DatabaseError('Failed to list chat_messages for conversation', error, {
        table: 'chat_messages',
        conversationId,
        options,
      });
    }

    return (data ?? []) as ChatMessage[];
  }

  /**
   * OVERRIDE, DELIBERATE: chat_messages is append-only by design — File
   * 148's migration has no RLS update policy for this table. Left
   * unoverridden, an inherited call to update() would still reach
   * Postgrest, get rejected by RLS, and surface as a generic
   * DatabaseError — technically correct but misleading, since it reads
   * like a database failure rather than an intentional application
   * invariant. Throwing immediately, before any network call, makes the
   * append-only constraint visible in code. Mirrors the existing
   * precedent of throwing a plain Error for a programmer-error condition
   * (see OpenAIProvider/GeminiProvider constructors on a missing API key)
   * rather than inventing a new AppError subclass for this one case.
   */
  override async update(): Promise<never> {
    throw new Error(
      'chat_messages is append-only — messages cannot be updated after creation.',
    );
  }

  /**
   * OVERRIDE, DELIBERATE: same rationale as update() above. No RLS
   * delete policy exists on chat_messages either.
   */
  override async delete(): Promise<never> {
    throw new Error(
      'chat_messages is append-only — messages cannot be deleted.',
    );
  }
}

// Re-exported for Service/Factory layer convenience, mirroring how
// CreateChatConversationInput / CreateChatMessageInput are consumed by
// the create() methods inherited from BaseRepository.
export type { CreateChatConversationInput, CreateChatMessageInput };