// src/modules/assistant/assistant.schemas.ts
//
// Request validation for the shared AI Assistant.
//
// SECURITY: the terminal is NEVER read from the request body. It is fixed by
// which API route was hit and then re-verified server-side against the
// caller's role / firm membership (assistant.access.ts). The body schema is
// `.strict()` so a client cannot smuggle extra fields (role, firmId, tools,
// system prompt, context overrides...) in and have them silently ignored or,
// worse, honored by a future refactor.

import { z } from "zod";

export const ASSISTANT_TERMINALS = ["lawyer", "firm", "general"] as const;
export const assistantTerminalSchema = z.enum(ASSISTANT_TERMINALS);
export type AssistantTerminal = z.infer<typeof assistantTerminalSchema>;

export const ASSISTANT_MAX_MESSAGE_CHARS = 4000;

export const sendAssistantMessageSchema = z
  .object({
    /** Omit to start a new conversation. Ownership/terminal is verified server-side. */
    conversationId: z.string().uuid().optional(),
    message: z
      .string()
      .trim()
      .min(1, "Message cannot be empty.")
      .max(
        ASSISTANT_MAX_MESSAGE_CHARS,
        `Message cannot exceed ${ASSISTANT_MAX_MESSAGE_CHARS} characters.`,
      ),
  })
  .strict();
export type SendAssistantMessageInput = z.infer<
  typeof sendAssistantMessageSchema
>;

export const assistantFirmIdSchema = z.string().uuid();
export const assistantConversationIdSchema = z.string().uuid();

export interface AssistantConversation {
  id: string;
  user_id: string;
  terminal: AssistantTerminal;
  firm_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

export interface AssistantMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  provider_used: "openai" | "gemini" | null;
  created_at: string;
}
