-- File 148 — JurisAI Module 8 (AI Legal Chat)
-- Migration: chat_conversations, chat_messages
--
-- FK anchoring: document_analysis_id, matching the sibling-of-analysis
-- pattern used by all seven prior Phase 2 modules (single-document scope,
-- confirmed decision — see PROJECT_PROGRESS.md).
--
-- ASSUMPTION, FLAGGED NOT VERIFIED: `document_analyses` is assumed to be
-- the real table name based on `document_analysis_id` FK naming used
-- consistently across every prior module's migrations. Not independently
-- re-confirmed against real pasted migration source in this session.
--
-- NO updated_at TRIGGER FUNCTION: no shared trigger (e.g. set_updated_at())
-- has been pasted/verified in this project. updated_at and last_message_at
-- are maintained explicitly at the Repository layer (File 150) instead of
-- being assumed/invented here, per the Source Verification Rule.

-- ============================================================================
-- chat_conversations
-- ============================================================================

create table if not exists public.chat_conversations (
  id                    uuid primary key default gen_random_uuid(),

  -- Single-document scope (confirmed decision) — every conversation is
  -- anchored to exactly one document analysis, matching every prior module.
  document_analysis_id uuid not null references public.document_analyses(id) on delete cascade,

  -- Owner. Stored directly (not inferred via document_analysis_id's own
  -- owner) so BaseService.requireOwnership() has a bare id to check
  -- against without an extra join on every guard call.
  user_id               uuid not null references auth.users(id) on delete cascade,

  -- Nullable: no auto-title-generation logic exists yet. Left as a
  -- deliberate open item rather than assumed — could be first-message
  -- truncation, an AI-generated summary, or user-set. Not decided here.
  title                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Denormalized convenience field for conversation-list sorting/display
  -- without a join against chat_messages. Maintained at the Repository
  -- layer alongside updated_at.
  last_message_at       timestamptz not null default now()
);

create index if not exists idx_chat_conversations_document_analysis_id
  on public.chat_conversations (document_analysis_id);

create index if not exists idx_chat_conversations_user_id
  on public.chat_conversations (user_id);

-- ============================================================================
-- chat_messages
-- ============================================================================

create table if not exists public.chat_messages (
  id                uuid primary key default gen_random_uuid(),

  conversation_id   uuid not null references public.chat_conversations(id) on delete cascade,

  -- 'system' deliberately excluded — system prompts are constructed at the
  -- Service layer per-request from eagerly-fetched module context, not
  -- persisted as message rows.
  role              text not null check (role in ('user', 'assistant')),

  content           text not null,

  -- Nullable: only ever set on 'assistant' rows. Mirrors
  -- AIGenerationOutcome.providerUsed from the Provider Layer streaming
  -- amendment — fallback can occur mid-conversation, so this must be
  -- tracked per-message, not per-conversation.
  provider_used     text check (provider_used in ('openai', 'gemini')),

  created_at        timestamptz not null default now()
);

create index if not exists idx_chat_messages_conversation_id_created_at
  on public.chat_messages (conversation_id, created_at);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

-- chat_conversations: direct ownership check via user_id.

create policy chat_conversations_select_own
  on public.chat_conversations for select
  using (auth.uid() = user_id);

create policy chat_conversations_insert_own
  on public.chat_conversations for insert
  with check (auth.uid() = user_id);

create policy chat_conversations_update_own
  on public.chat_conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy chat_conversations_delete_own
  on public.chat_conversations for delete
  using (auth.uid() = user_id);

-- chat_messages: NOT denormalized with its own user_id (see File 148
-- design notes — a message's ownership must never be able to drift from
-- its parent conversation's ownership). Enforced via EXISTS subquery
-- against chat_conversations instead.

create policy chat_messages_select_via_conversation
  on public.chat_messages for select
  using (
    exists (
      select 1 from public.chat_conversations c
      where c.id = chat_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy chat_messages_insert_via_conversation
  on public.chat_messages for insert
  with check (
    exists (
      select 1 from public.chat_conversations c
      where c.id = chat_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

-- No update/delete policies on chat_messages: messages are append-only,
-- matching the immutable-record pattern used by every prior module's
-- underlying rows (even though the parent conversation itself is mutable).