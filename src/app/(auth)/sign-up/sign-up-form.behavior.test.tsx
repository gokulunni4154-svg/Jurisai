import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { SignUpForm } from "./sign-up-form";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SignUpForm behavior", () => {
  it("blocks mismatched passwords with an inline error and sends nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Full name"), "Test User");
    await user.type(screen.getByLabelText("Email"), "test@example.com");
    await user.type(screen.getByLabelText("Password"), "SuperSecret123!");
    await user.type(
      screen.getByLabelText("Confirm password"),
      "Different123!!",
    );
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Confirm password")).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only adds the extra field its account type needs (no new required fields)", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);
    expect(screen.queryByLabelText("Firm name")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Bar registration number"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Lawyer firm" }));
    expect(screen.getByLabelText("Firm name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lawyer firm" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Individual lawyer" }));
    expect(
      screen.getByLabelText("Bar registration number"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Firm name")).not.toBeInTheDocument();
  });

  it("links back to sign-in", () => {
    render(<SignUpForm />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });
});
