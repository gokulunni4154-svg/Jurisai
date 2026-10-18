// src/modules/assistant/assistant.repository.ts
//
// Persistence for assistant_conversations / assistant_messages
// (20261018000000_create_assistant_conversations.sql).
//
// Always constructed with the REQUEST-SCOPED (RLS) Supabase client, never the
// admin client: RLS is the second wall behind the service-level ownership
// checks. Every query is additionally filtered by user_id so a bug in one
// layer cannot expose another user's rows.
//
// The generated Database type does not yet include these tables, so the
// client is used untyped here and rows are cast to the entity types. Remove
// the cast once `supabase gen types` has been re-run after the migration.

import type { SupabaseClient } from "@supabase/supabase-js";

import { DatabaseError } from "@/core/errors/app-error";

import type {
  AssistantConversation,
  AssistantMessage,
  AssistantTerminal,
} from "./assistant.schemas";

export class AssistantRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async createConversation(input: {
    userId: string;
    terminal: AssistantTerminal;
    firmId: string | null;
    title: string | null;
  }): Promise<AssistantConversation> {
    const { data, error } = await this.supabase
      .from("assistant_conversations")
      .insert({
        user_id: input.userId,
        terminal: input.terminal,
        firm_id: input.firmId,
        title: input.title,
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new DatabaseError(
        "Failed to create assistant conversation",
        error ?? undefined,
        {
          table: "assistant_conversations",
        },
      );
    }
    return data as AssistantConversation;
  }

  /** Returns null for a missing row AND for a row RLS hides — indistinguishable by design. */
  async findConversationForUser(
    conversationId: string,
    userId: string,
  ): Promise<AssistantConversation | null> {
    const { data, error } = await this.supabase
      .from("assistant_conversations")
      .select("*")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new DatabaseError("Failed to load assistant conversation", error, {
        table: "assistant_conversations",
      });
    }
    return (data as AssistantConversation | null) ?? null;
  }

  async listConversations(input: {
    userId: string;
    terminal: AssistantTerminal;
    firmId: string | null;
    limit: number;
  }): Promise<AssistantConversation[]> {
    let query = this.supabase
      .from("assistant_conversations")
      .select("*")
      .eq("user_id", input.userId)
      .eq("terminal", input.terminal);

    query = input.firmId
      ? query.eq("firm_id", input.firmId)
      : query.is("firm_id", null);

    const { data, error } = await query
      .order("last_message_at", { ascending: false })
      .limit(input.limit);

    if (error) {
      throw new DatabaseError("Failed to list assistant conversations", error, {
        table: "assistant_conversations",
      });
    }
    return (data ?? []) as AssistantConversation[];
  }

  async touchConversation(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from("assistant_conversations")
      .update({ last_message_at: now, updated_at: now })
      .eq("id", conversationId)
      .eq("user_id", userId);

    if (error) {
      throw new DatabaseError(
        "Failed to update assistant conversation",
        error,
        {
          table: "assistant_conversations",
        },
      );
    }
  }

  async addMessage(input: {
    conversationId: string;
    role: "user" | "assistant";
    content: string;
    providerUsed?: "openai" | "gemini";
  }): Promise<AssistantMessage> {
    const { data, error } = await this.supabase
      .from("assistant_messages")
      .insert({
        conversation_id: input.conversationId,
        role: input.role,
        content: input.content,
        provider_used: input.providerUsed ?? null,
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new DatabaseError(
        "Failed to save assistant message",
        error ?? undefined,
        {
          table: "assistant_messages",
        },
      );
    }
    return data as AssistantMessage;
  }

  /** Most recent `limit` messages, returned oldest-first. */
  async findRecentMessages(
    conversationId: string,
    limit: number,
  ): Promise<AssistantMessage[]> {
    const { data, error } = await this.supabase
      .from("assistant_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new DatabaseError("Failed to load assistant messages", error, {
        table: "assistant_messages",
      });
    }
    return ((data ?? []) as AssistantMessage[]).reverse();
  }
}
