vi.mock("server-only", () => ({}));
vi.mock("./assistant.factory", () => ({ buildAssistantService: vi.fn() }));

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthorizationError, RateLimitError } from "@/core/errors/app-error";

import { buildAssistantService } from "./assistant.factory";
import {
  ASSISTANT_STREAM_ERROR_MARKER,
  handleAssistantGet,
  handleAssistantPost,
} from "./assistant.http";

const build = vi.mocked(buildAssistantService);

function post(body: string) {
  return new NextRequest("http://localhost/api/assistant/lawyer", {
    method: "POST",
    body,
  });
}

beforeEach(() => build.mockReset());

describe("assistant HTTP handlers", () => {
  it("streams text and exposes the conversation id", async () => {
    const startTurn = vi.fn().mockResolvedValue({
      conversation: { id: "conv-1" },
      stream: (async function* () {
        yield "a";
        yield "b";
      })(),
    });
    build.mockResolvedValue({ startTurn } as never);
    const res = await handleAssistantPost(
      post('{"message":"hi"}'),
      "lawyer",
      null,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Conversation-Id")).toBe("conv-1");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(await res.text()).toBe("ab");
    expect(startTurn).toHaveBeenCalledWith("lawyer", null, { message: "hi" });
  });

  it("terminal and firm come from the route, not the body", async () => {
    const startTurn = vi.fn().mockRejectedValue(new AuthorizationError("no"));
    build.mockResolvedValue({ startTurn } as never);
    const res = await handleAssistantPost(
      post('{"message":"hi","terminal":"firm"}'),
      "general",
      null,
    );
    expect(res.status).toBe(403);
    expect(startTurn.mock.calls[0]![0]).toBe("general");
  });

  it("returns 400 for invalid JSON and oversized bodies without touching the service", async () => {
    expect(
      (await handleAssistantPost(post("not json"), "lawyer", null)).status,
    ).toBe(400);
    expect(
      (await handleAssistantPost(post("x".repeat(20000)), "lawyer", null))
        .status,
    ).toBe(400);
    expect(build).not.toHaveBeenCalled();
  });

  it("a failure before the first chunk is a real HTTP error with a safe body", async () => {
    const startTurn = vi.fn().mockResolvedValue({
      conversation: { id: "c" },
      stream: (async function* () {
        throw new Error("db password=hunter2 at /srv/app/secret.ts");
      })(),
    });
    build.mockResolvedValue({ startTurn } as never);
    const res = await handleAssistantPost(
      post('{"message":"hi"}'),
      "lawyer",
      null,
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("secret.ts");
  });

  it("a mid-stream failure ends with the error marker", async () => {
    const startTurn = vi.fn().mockResolvedValue({
      conversation: { id: "c" },
      stream: (async function* () {
        yield "partial";
        throw new Error("boom");
      })(),
    });
    build.mockResolvedValue({ startTurn } as never);
    const res = await handleAssistantPost(
      post('{"message":"hi"}'),
      "lawyer",
      null,
    );
    expect(await res.text()).toBe(`partial${ASSISTANT_STREAM_ERROR_MARKER}`);
  });

  it("sets Retry-After on rate limiting", async () => {
    build.mockResolvedValue({
      startTurn: vi.fn().mockRejectedValue(new RateLimitError("slow", 42)),
    } as never);
    const res = await handleAssistantPost(
      post('{"message":"hi"}'),
      "lawyer",
      null,
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
  });

  it("GET lists conversations, or messages when conversationId is given, with no-store", async () => {
    const svc = {
      listConversations: vi.fn().mockResolvedValue([{ id: "1" }]),
      listMessages: vi.fn().mockResolvedValue([{ id: "m" }]),
    };
    build.mockResolvedValue(svc as never);
    const a = await handleAssistantGet(
      new NextRequest("http://localhost/api/assistant/firm/f"),
      "firm",
      "f",
    );
    expect((await a.json()).data).toEqual([{ id: "1" }]);
    expect(a.headers.get("Cache-Control")).toContain("no-store");
    expect(svc.listConversations).toHaveBeenCalledWith("firm", "f");
    await handleAssistantGet(
      new NextRequest("http://localhost/x?conversationId=abc"),
      "firm",
      "f",
    );
    expect(svc.listMessages).toHaveBeenCalledWith("firm", "f", "abc");
  });
});
