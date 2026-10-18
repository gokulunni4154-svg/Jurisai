"use client";

// Shared chat UI for all three terminals. It only knows an API endpoint and
// presentation props. It sends NO role/terminal/firm data in the body: the
// terminal and firm come from the endpoint path and are verified server-side.

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Plus, Send, Sparkles } from "lucide-react";

import { SafeMarkdown } from "./safe-markdown";

const STREAM_ERROR_MARKER = "\n[[JURISAI_STREAM_ERROR]]";
const MAX_CHARS = 4000;

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  failed?: boolean;
}

interface ConversationSummary {
  id: string;
  title: string | null;
}

export interface AssistantChatProps {
  /** e.g. /api/assistant/lawyer or /api/assistant/firm/<id> */
  endpoint: string;
  heading: string;
  /** Plain-language statement of what data the assistant can use. */
  contextLabel: string;
  suggestions: string[];
  disclaimer: string;
}

export function AssistantChat({
  endpoint,
  heading,
  contextLabel,
  suggestions,
  disclaimer,
}: AssistantChatProps) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { data: ConversationSummary[] };
      setConversations(json.data ?? []);
    } catch {
      /* history list is a convenience; ignore */
    }
  }, [endpoint]);

  useEffect(() => {
    void loadConversations();
    return () => abortRef.current?.abort();
  }, [loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function openConversation(id: string) {
    setError(null);
    try {
      const res = await fetch(
        `${endpoint}?conversationId=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("load failed");
      const json = (await res.json()) as {
        data: { id: string; role: "user" | "assistant"; content: string }[];
      };
      setMessages(
        json.data.map((m) => ({ id: m.id, role: m.role, content: m.content })),
      );
      setConversationId(id);
    } catch {
      setError("Could not load that conversation.");
    }
  }

  function newConversation() {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setError(null);
    setLastPrompt(null);
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    if (content.length > MAX_CHARS) {
      setError(`Messages can be at most ${MAX_CHARS} characters.`);
      return;
    }

    setError(null);
    setSending(true);
    setLastPrompt(content);
    setInput("");
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", content },
      { id: assistantId, role: "assistant", content: "" },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(conversationId ? { conversationId } : {}),
          message: content,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let msg = "The assistant could not answer. Please try again.";
        if (res.status === 429)
          msg = "You are sending messages too quickly. Please wait a moment.";
        else if (res.status === 401)
          msg = "Your session has expired. Please sign in again.";
        else if (res.status === 403)
          msg = "You do not have access to this assistant.";
        throw new Error(msg);
      }

      const newId = res.headers.get("X-Conversation-Id");
      if (newId && !conversationId) setConversationId(newId);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let interrupted = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        if (acc.includes(STREAM_ERROR_MARKER)) {
          acc = acc.replace(STREAM_ERROR_MARKER, "");
          interrupted = true;
        }
        const snapshot = acc;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: snapshot } : m,
          ),
        );
      }
      if (interrupted) {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, failed: true } : m)),
        );
        setError("The response was interrupted. You can retry.");
      } else {
        void loadConversations();
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="border-b border-border bg-card md:w-64 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Conversations
          </p>
          <button
            type="button"
            onClick={newConversation}
            className="flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-muted"
          >
            <Plus className="h-3 w-3" /> New
          </button>
        </div>
        <ul className="max-h-32 overflow-y-auto px-2 pb-2 md:max-h-none md:h-[calc(100%-3rem)]">
          {conversations.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              No conversations yet.
            </li>
          )}
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void openConversation(c.id)}
                aria-current={c.id === conversationId ? "true" : undefined}
                className={`w-full truncate rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted ${
                  c.id === conversationId ? "bg-muted font-medium" : ""
                }`}
              >
                {c.title || "Untitled conversation"}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex min-h-0 flex-1 flex-col" aria-label={heading}>
        <header className="border-b border-border bg-card px-6 py-4">
          <h1 className="flex items-center gap-2 font-serif text-xl text-foreground">
            <Sparkles className="h-4 w-4 text-primary" strokeWidth={1.75} />
            {heading}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{contextLabel}</p>
        </header>

        <div
          className="flex-1 overflow-y-auto px-4 py-6 md:px-6"
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <div className="mx-auto max-w-xl text-center">
              <p className="text-sm text-muted-foreground">
                Try one of these to get started:
              </p>
              <div className="mt-4 flex flex-col gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    disabled={sending}
                    className="rounded-md border border-border bg-card px-4 py-2.5 text-left text-[13.5px] hover:bg-muted disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ol className="mx-auto flex max-w-3xl flex-col gap-4">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={
                    m.role === "user"
                      ? "flex justify-end"
                      : "flex justify-start"
                  }
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-4 py-3 ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-card text-foreground"
                    }`}
                  >
                    {m.role === "user" ? (
                      <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">
                        {m.content}
                      </p>
                    ) : m.content ? (
                      <SafeMarkdown text={m.content} />
                    ) : (
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                      </span>
                    )}
                  </div>
                </li>
              ))}
              <div ref={bottomRef} />
            </ol>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="mx-4 mb-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive md:mx-6"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{error}</span>
            {lastPrompt && !sending && (
              <button
                type="button"
                onClick={() => void send(lastPrompt)}
                className="font-medium underline"
              >
                Retry
              </button>
            )}
          </div>
        )}

        <form
          className="border-t border-border bg-card px-4 py-3 md:px-6"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <label htmlFor="assistant-input" className="sr-only">
              Message the assistant
            </label>
            <textarea
              id="assistant-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={2}
              maxLength={MAX_CHARS}
              placeholder="Ask a question… (Enter to send, Shift+Enter for a new line)"
              className="min-h-[44px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              type="submit"
              disabled={sending || input.trim() === ""}
              aria-label="Send message"
              className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-[11px] text-muted-foreground">
            {disclaimer}
          </p>
        </form>
      </section>
    </div>
  );
}
