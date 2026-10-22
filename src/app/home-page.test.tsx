import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import HomePage from "./page";

afterEach(() => cleanup());

function hrefsNamed(name: string | RegExp): (string | null)[] {
  return screen
    .getAllByRole("link", { name })
    .map((link) => link.getAttribute("href"));
}

describe("HomePage", () => {
  it("routes every registration CTA to /sign-up and every sign-in link to /sign-in", () => {
    render(<HomePage />);
    expect(
      hrefsNamed(/create an account|get started|^sign up$/i).every(
        (h) => h === "/sign-up",
      ),
    ).toBe(true);
    expect(hrefsNamed(/^sign in$/i).every((h) => h === "/sign-in")).toBe(true);
  });

  it("only links to routes that exist (anchors, /sign-in, /sign-up, /)", () => {
    render(<HomePage />);
    const allowed = /^(#[a-z-]+|\/sign-in|\/sign-up|\/)$/;
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").toMatch(allowed);
    }
  });

  it("every in-page nav anchor points at a section that exists", () => {
    const { container } = render(<HomePage />);
    for (const link of screen.getAllByRole("link")) {
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        expect(container.querySelector(href), href).not.toBeNull();
      }
    }
  });

  it("shows no fabricated metrics, customers or live-data claims", () => {
    const { container } = render(<HomePage />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Contract #\d+/);
    expect(text).not.toMatch(/\b\d{2,3}%/);
    expect(text).not.toMatch(/trusted by|testimonial|no credit card/i);
    expect(screen.getByText(/illustrative layout only/i)).toBeInTheDocument();
  });

  it("states that AI output is not legal advice", () => {
    render(<HomePage />);
    expect(
      screen.getByRole("heading", { name: /not legal advice/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not replace a qualified lawyer/i),
    ).toBeInTheDocument();
  });

  it("has exactly one h1", () => {
    render(<HomePage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("MarketingHeader mobile menu", () => {
  it("toggles aria-expanded, and Escape closes it and returns focus to the toggle", async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    const toggle = screen.getByRole("button", { name: "Open menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("navigation", { name: "Mobile" }),
    ).not.toBeInTheDocument();

    await user.click(toggle);
    const nav = screen.getByRole("navigation", { name: "Mobile" });
    expect(screen.getByRole("button", { name: "Close menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      within(nav).getByRole("link", { name: "Capabilities" }),
    ).toHaveAttribute("href", "#capabilities");

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("navigation", { name: "Mobile" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveFocus();
  });
});
