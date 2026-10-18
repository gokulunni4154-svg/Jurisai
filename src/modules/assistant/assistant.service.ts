// src/modules/assistant/assistant.service.ts
//
// The shared AI Assistant engine. One service, three terminals.
//
// AUTHORIZATION MODEL (enforced here on every call, never in the prompt):
//   1. Identity comes from the injected AuthUser (resolved server-side from
//      the session cookie by the factory) — never from the request.
//   2. The terminal is fixed by the API route and re-verified here:
//        lawyer  -> UserRole 'lawyer'
//        firm    -> UserRole 'law_firm' | 'lawyer' AND a firm_members row for
//                   the URL firmId. owner/admin => firm_wide scope (delegated
//                   to FirmDashboardService, which re-checks); any other
//                   member => own_matters scope (RLS-scoped repositories,
//                   additionally filtered to that firm). A firmId in the URL
//                   is a claim, never proof.
//        general -> any authenticated non-client user; NO private context.
//   3. Conversations are fetched by (id, user_id) and must match the
//      request's terminal and firm_id; any mismatch is the same 404 as a
//      missing row, so IDs cannot be probed.
//   4. The model has no tools. Context is a bounded snapshot fetched by the
//      server through already-authorized repositories and passed as DATA.
//      Prompt injection can therefore at worst change wording, never widen
//      what data was fetched.

import "server-only";

import { generateStreamingWithFallback } from "@/core/ai/ai-provider.factory";
import type { AIProviderName } from "@/core/ai/ai-provider.factory";
import type { AuthUser } from "@/core/auth/types";
import {
  AIProviderError,
  AuthorizationError,
  ErrorCode,
  NotFoundError,
} from "@/core/errors/app-error";
import { BaseService } from "@/core/services/base.service";
import type { CaseRepository } from "@/modules/cases/case.repository";
import type { FirmDashboardService } from "@/modules/firm-dashboard/firm-dashboard.service";
import type { HearingRepository } from "@/modules/hearings/hearing.repository";
import type { TaskRepository } from "@/modules/tasks/task.repository";
import type { FirmMemberRepository } from "@/modules/user-management/firm-member.repository";

import {
  formatAuthorizedContext,
  type AssistantScope,
  type AuthorizedSnapshot,
} from "./assistant.context";
import { buildSystemPrompt, buildUserPrompt } from "./assistant.prompts";
import type { AssistantRepository } from "./assistant.repository";
import {
  assistantFirmIdSchema,
  assistantConversationIdSchema,
  sendAssistantMessageSchema,
  type AssistantConversation,
  type AssistantMessage,
  type AssistantTerminal,
} from "./assistant.schemas";

export interface AssistantRateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<void>;
}

export const ASSISTANT_RATE_LIMIT = { limit: 30, windowSeconds: 600 } as const;
const MAX_OUTPUT_TOKENS = 1500;
const HISTORY_MESSAGE_LIMIT = 24;
const MESSAGE_LIST_LIMIT = 200;
const CONVERSATION_LIST_LIMIT = 30;
const MAX_STORED_REPLY_CHARS = 20000;

const USER_SAFE_FAILURE_MESSAGES: Partial<Record<string, string>> = {
  [ErrorCode.AI_PROVIDER_CONTENT_REJECTED]:
    "This message could not be answered — it may have been flagged by content safety checks.",
  [ErrorCode.AI_PROVIDER_INVALID_RESPONSE]:
    "This message could not be answered due to an unexpected error. Please try again.",
  [ErrorCode.AI_PROVIDER_TIMEOUT]: "The response timed out. Please try again.",
  [ErrorCode.AI_PROVIDER_RATE_LIMITED]:
    "The assistant is temporarily busy. Please try again shortly.",
  [ErrorCode.AI_PROVIDER_UNAVAILABLE]:
    "The assistant is temporarily unavailable. Please try again shortly.",
};

export interface AssistantAccess {
  terminal: AssistantTerminal;
  firmId: string | null;
  scope: AssistantScope | "none";
}

export interface AssistantTurn {
  conversation: AssistantConversation;
  /** Streams assistant text; persists the reply once fully received. */
  stream: AsyncGenerator<string, void, undefined>;
}

export class AssistantService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly repository: AssistantRepository,
    private readonly firmMemberRepository: Pick<
      FirmMemberRepository,
      "findByFirmAndProfile"
    >,
    private readonly caseRepository: Pick<CaseRepository, "findManyVisible">,
    private readonly taskRepository: Pick<
      TaskRepository,
      "findByAssigneeProfileId"
    >,
    private readonly hearingRepository: Pick<HearingRepository, "findUpcoming">,
    private readonly firmDashboardService: Pick<
      FirmDashboardService,
      "getDashboard"
    >,
    private readonly rateLimiter: AssistantRateLimiter,
  ) {
    super(currentUser);
  }

  /** Derives what this caller may do in this terminal. Throws if nothing. */
  async resolveAccess(
    terminal: AssistantTerminal,
    rawFirmId: string | null,
  ): Promise<AssistantAccess> {
    const user = this.requireAuthentication();

    if (terminal === "lawyer") {
      this.requireRole("lawyer");
      return { terminal, firmId: null, scope: "own_matters" };
    }

    if (terminal === "general") {
      if (user.role === "client") {
        throw new AuthorizationError(
          "You do not have permission to use this assistant.",
        );
      }
      return { terminal, firmId: null, scope: "none" };
    }

    this.requireRole("law_firm", "lawyer");
    const firmId = assistantFirmIdSchema.parse(rawFirmId);
    const firmRole = await this.firmMemberRepository.findByFirmAndProfile(
      firmId,
      user.id,
    );
    if (!firmRole) {
      throw new AuthorizationError(
        "You do not have permission to use this assistant.",
      );
    }
    const scope: AssistantScope =
      firmRole === "owner" || firmRole === "admin"
        ? "firm_wide"
        : "own_matters";
    return { terminal, firmId, scope };
  }

  async listConversations(
    terminal: AssistantTerminal,
    rawFirmId: string | null,
  ): Promise<AssistantConversation[]> {
    const user = this.requireAuthentication();
    const access = await this.resolveAccess(terminal, rawFirmId);
    return this.repository.listConversations({
      userId: user.id,
      terminal: access.terminal,
      firmId: access.firmId,
      limit: CONVERSATION_LIST_LIMIT,
    });
  }

  async listMessages(
    terminal: AssistantTerminal,
    rawFirmId: string | null,
    rawConversationId: string,
  ): Promise<AssistantMessage[]> {
    const access = await this.resolveAccess(terminal, rawFirmId);
    const conversation = await this.loadOwnedConversation(
      access,
      rawConversationId,
    );
    return this.repository.findRecentMessages(
      conversation.id,
      MESSAGE_LIST_LIMIT,
    );
  }

  /**
   * Validates, authorizes, persists the user's message and prepares the
   * stream. Everything that can fail with a real HTTP status happens here,
   * before any model output exists.
   */
  async startTurn(
    terminal: AssistantTerminal,
    rawFirmId: string | null,
    rawInput: unknown,
  ): Promise<AssistantTurn> {
    const user = this.requireAuthentication();
    const input = sendAssistantMessageSchema.parse(rawInput);
    const access = await this.resolveAccess(terminal, rawFirmId);

    await this.rateLimiter.consume(
      `assistant:user:${user.id}`,
      ASSISTANT_RATE_LIMIT.limit,
      ASSISTANT_RATE_LIMIT.windowSeconds,
    );

    const conversation = input.conversationId
      ? await this.loadOwnedConversation(access, input.conversationId)
      : await this.repository.createConversation({
          userId: user.id,
          terminal: access.terminal,
          firmId: access.firmId,
          title: input.message.replace(/\s+/g, " ").slice(0, 60),
        });

    await this.repository.addMessage({
      conversationId: conversation.id,
      role: "user",
      content: input.message,
    });

    const [snapshot, history] = await Promise.all([
      this.loadSnapshot(access),
      this.repository.findRecentMessages(
        conversation.id,
        HISTORY_MESSAGE_LIMIT,
      ),
    ]);

    const request = {
      systemPrompt: buildSystemPrompt(access.terminal),
      userPrompt: buildUserPrompt({
        contextBlock:
          snapshot && access.scope !== "none"
            ? formatAuthorizedContext(access.scope, snapshot)
            : null,
        history,
      }),
      options: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.3 },
    };

    return {
      conversation,
      stream: this.runStream(user.id, conversation.id, request),
    };
  }

  private async *runStream(
    userId: string,
    conversationId: string,
    request: Parameters<typeof generateStreamingWithFallback>[0],
  ): AsyncGenerator<string, void, undefined> {
    let fullText = "";
    let providerUsed: AIProviderName;

    try {
      const stream = generateStreamingWithFallback(request);
      while (true) {
        const next = await stream.next();
        if (next.done) {
          providerUsed = next.value;
          break;
        }
        fullText += next.value;
        yield next.value;
      }
    } catch (error) {
      if (error instanceof AIProviderError) {
        const message =
          USER_SAFE_FAILURE_MESSAGES[error.code] ??
          USER_SAFE_FAILURE_MESSAGES[ErrorCode.AI_PROVIDER_UNAVAILABLE] ??
          "The assistant is unavailable.";
        throw new AIProviderError(error.provider, error.code, message, error);
      }
      throw error;
    }

    if (fullText.trim().length === 0) {
      throw new AIProviderError(
        providerUsed,
        ErrorCode.AI_PROVIDER_INVALID_RESPONSE,
        USER_SAFE_FAILURE_MESSAGES[ErrorCode.AI_PROVIDER_INVALID_RESPONSE] ??
          "Empty response.",
      );
    }

    await this.repository.addMessage({
      conversationId,
      role: "assistant",
      content: fullText.slice(0, MAX_STORED_REPLY_CHARS),
      providerUsed,
    });
    await this.repository.touchConversation(conversationId, userId);
  }

  /** Fetch by (id, owner), then require the same terminal and firm. 404 on any mismatch. */
  private async loadOwnedConversation(
    access: AssistantAccess,
    rawConversationId: string,
  ): Promise<AssistantConversation> {
    const user = this.requireAuthentication();
    const conversationId =
      assistantConversationIdSchema.parse(rawConversationId);
    const conversation = await this.repository.findConversationForUser(
      conversationId,
      user.id,
    );

    if (
      !conversation ||
      conversation.user_id !== user.id ||
      conversation.terminal !== access.terminal ||
      (conversation.firm_id ?? null) !== access.firmId
    ) {
      throw new NotFoundError("assistant_conversations", conversationId);
    }
    return conversation;
  }

  private async loadSnapshot(
    access: AssistantAccess,
  ): Promise<AuthorizedSnapshot | null> {
    if (access.terminal === "general") return null;
    const user = this.requireAuthentication();

    if (
      access.terminal === "firm" &&
      access.scope === "firm_wide" &&
      access.firmId
    ) {
      const d = await this.firmDashboardService.getDashboard(access.firmId);
      return {
        cases: d.firmCases,
        tasks: d.firmTasks,
        hearings: d.upcomingHearings,
      };
    }

    const [cases, tasks, hearings] = await Promise.all([
      this.caseRepository.findManyVisible(),
      this.taskRepository.findByAssigneeProfileId(user.id),
      this.hearingRepository.findUpcoming(new Date().toISOString()),
    ]);

    if (access.terminal === "firm") {
      // A lawyer with grants in several firms must not see other firms' data
      // inside this firm's assistant.
      const same = <T extends { firm_id: string }>(rows: T[]) =>
        rows.filter((r) => r.firm_id === access.firmId);
      return {
        cases: same(cases),
        tasks: same(tasks),
        hearings: same(hearings),
      };
    }

    return { cases, tasks, hearings };
  }
}
