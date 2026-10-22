import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
let currentSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

import { SignInForm } from "./sign-in-form";

function mockFetch(body: unknown, status: number) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function submit(email: string, password: string) {
  const user = userEvent.setup();
  render(<SignInForm />);
  if (email) await user.type(screen.getByLabelText("Email"), email);
  if (password) await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("SignInForm behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearch = "";
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows inline field errors (not an alert) and sends nothing when fields are empty", async () => {
    const fetchMock = mockFetch({}, 200);
    await submit("", "");
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("flags a malformed email inline", async () => {
    const fetchMock = mockFetch({}, 200);
    await submit("not-an-email", "pw");
    expect(
      screen.getByText("Enter a valid email address."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server authentication error in the single alert region", async () => {
    mockFetch({ error: { message: "Invalid email or password." } }, 401);
    await submit("a@b.co", "wrong-password");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid email or password.",
    );
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("falls back to a generic message when the server error is unreadable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 500 })),
    );
    await submit("a@b.co", "pw");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /unable to sign in/i,
    );
  });

  it("routes to the server-resolved destination on success", async () => {
    mockFetch({ data: {}, redirectTo: "/lawyer/dashboard" }, 200);
    await submit("a@b.co", "pw");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/lawyer/dashboard"));
    expect(refresh).toHaveBeenCalled();
  });

  it("prefers ?redirectTo, and never follows an off-site or protocol-relative target", async () => {
    currentSearch = "redirectTo=//evil.example";
    mockFetch({ data: {}, redirectTo: "/lawyer/dashboard" }, 200);
    await submit("a@b.co", "pw");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("links to sign-up and password reset", () => {
    render(<SignInForm />);
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/sign-up",
    );
    expect(
      screen.getByRole("link", { name: "Forgot password?" }),
    ).toHaveAttribute("href", "/request-password-reset");
    cleanup();
  });
});
