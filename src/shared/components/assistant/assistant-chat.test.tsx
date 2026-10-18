import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantChat } from "./assistant-chat";

const props = {
  endpoint: "/api/assistant/lawyer",
  heading: "AI Assistant",
  contextLabel: "ctx",
  suggestions: ["Summarize my upcoming hearings."],
  disclaimer: "disc",
};

function streamResponse(text: string, headers: Record<string, string> = {}) {
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers });
}

const fetchMock = vi.fn();

afterEach(() => cleanup());

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("AssistantChat", () => {
  it("shows suggestions and sends only the message (no role/terminal/firm fields)", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? streamResponse("Hi there", { "X-Conversation-Id": "c1" })
        : new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    render(<AssistantChat {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Summarize my upcoming hearings." }),
    );
    await waitFor(() =>
      expect(screen.getByText("Hi there")).toBeInTheDocument(),
    );
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST")!;
    expect(JSON.parse(post[1].body)).toEqual({
      message: "Summarize my upcoming hearings.",
    });
  });

  it("Enter sends, Shift+Enter does not", async () => {
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
      init?.method === "POST"
        ? streamResponse("ok")
        : new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    render(<AssistantChat {...props} />);
    const box = screen.getByLabelText("Message the assistant");
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "POST")).toBe(
      false,
    );
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => c[1]?.method === "POST")).toBe(
        true,
      ),
    );
  });

  it("shows a friendly error with retry on failure", async () => {
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response("{}", { status: 429 })
        : new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    render(<AssistantChat {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Summarize my upcoming hearings." }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/too quickly/i);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("flags an interrupted stream", async () => {
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
      init?.method === "POST"
        ? streamResponse("partial\n[[JURISAI_STREAM_ERROR]]")
        : new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    render(<AssistantChat {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Summarize my upcoming hearings." }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/interrupted/i);
    expect(screen.queryByText(/JURISAI_STREAM_ERROR/)).toBeNull();
  });
});
