-- Migration: create_assistant_conversations
--
-- Backing tables for the shared AI Assistant (Lawyer / Firm / General
-- terminals). Additive only: no existing table, policy or data is touched.
--
-- Why new tables instead of reusing chat_conversations: that table is
-- anchored to a document_analysis (document_analysis_id NOT NULL) and its
-- RLS is shaped around one analysis. The assistant is terminal-scoped, not
-- document-scoped, so forcing it into that table would require loosening a
-- NOT NULL constraint on existing data.
--
-- Isolation model:
--   * Every conversation has exactly one owner (user_id) and one terminal.
--   * Firm conversations also carry firm_id; the application re-verifies
--     current firm membership on every read/write (membership can be
--     revoked after the conversation was created), RLS only guarantees the
--     owner boundary.
--   * RLS is owner-only. There is deliberately NO admin/support read policy:
--     assistant conversations may contain privileged legal material.
--   * assistant_messages is append-only (no update/delete policies).

create table if not exists public.assistant_conversations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  terminal         text not null
    constraint assistant_conversations_terminal_check
    check (terminal in ('lawyer', 'firm', 'general')),
  firm_id          uuid references public.firms(id) on delete cascade,
  title            text
    constraint assistant_conversations_title_length
    check (title is null or char_length(title) <= 120),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  -- A firm conversation must name its firm; the other terminals must not.
  constraint assistant_conversations_firm_scope_check
    check ((terminal = 'firm') = (firm_id is not null))
);

create index if not exists idx_assistant_conversations_user_terminal
  on public.assistant_conversations (user_id, terminal, last_message_at desc);

create table if not exists public.assistant_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.assistant_conversations(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null
    constraint assistant_messages_content_length check (char_length(content) <= 20000),
  provider_used    text check (provider_used in ('openai', 'gemini')),
  created_at       timestamptz not null default now()
);

create index if not exists idx_assistant_messages_conversation_created
  on public.assistant_messages (conversation_id, created_at);

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;

create policy assistant_conversations_select_own
  on public.assistant_conversations for select
  using (auth.uid() = user_id);

create policy assistant_conversations_insert_own
  on public.assistant_conversations for insert
  with check (auth.uid() = user_id);

create policy assistant_conversations_update_own
  on public.assistant_conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy assistant_messages_select_via_conversation
  on public.assistant_messages for select
  using (
    exists (
      select 1 from public.assistant_conversations c
      where c.id = assistant_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy assistant_messages_insert_via_conversation
  on public.assistant_messages for insert
  with check (
    exists (
      select 1 from public.assistant_conversations c
      where c.id = assistant_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );
