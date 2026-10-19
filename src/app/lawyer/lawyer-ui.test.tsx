// Stage 4 (Individual Lawyer Terminal) UI regression tests.
//
// 1. Behavior: the dashboard still renders its data-derived briefing, grouped
//    tasks and status badges after the move to the shared primitives, and the
//    "New case" / "New matter" flows are now accessible dialogs that keep the
//    previous validation behavior.
// 2. Token guard: lawyer pages must not reintroduce hardcoded palette classes
//    (they do not adapt to dark mode), translucent status backgrounds (their
//    contrast depends on the surface) or arbitrary pixel font sizes.
//
// These tests assert nothing about authorization; each API route enforces its
// own access rules and none of them was touched.

import fs from "node:fs";
import path from "node:path";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MattersPage from "./cases/page";
import LawyerDashboardPage from "./dashboard/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/lawyer/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const now = new Date();
const yesterday = new Date(now.getTime() - 2 * 86_400_000);

const DASHBOARD = {
  myCases: [
    {
      id: "c1",
      title: "Sharma v. Patel",
      status: "open",
      updated_at: now.toISOString(),
    },
  ],
  myTasks: [
    {
      id: "t1",
      title: "File written statement",
      status: "in_progress",
      due_date: yesterday.toISOString(),
      case_id: "c1",
    },
  ],
  upcomingHearings: [
    {
      id: "h1",
      case_id: "c1",
      hearing_type: "arguments",
      hearing_date: now.toISOString(),
      court_name: "Delhi High Court",
      location: null,
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/dashboard/lawyer")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: DASHBOARD }),
        } as Response;
      }
      if (url.startsWith("/api/cases")) {
        // The matters page lists with GET /api/cases (an array in `data`).
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        } as Response;
      }
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("lawyer dashboard", () => {
  it("renders the data-derived briefing, grouped tasks and badges", async () => {
    render(<LawyerDashboardPage />);

    expect(
      await screen.findByText("You have 1 hearing and 1 pending task today."),
    ).toBeTruthy();
    expect(screen.getByText("Overdue (1)")).toBeTruthy();
    expect(screen.getByText("File written statement")).toBeTruthy();
    expect(screen.getByText("in_progress")).toBeTruthy();
    expect(screen.getByText("Sharma v. Patel")).toBeTruthy();
  });

  it("opens New case as a dialog, validates an empty title, and closes on Cancel", async () => {
    render(<LawyerDashboardPage />);
    await screen.findByText("Sharma v. Patel");

    const [newCaseButton] = screen.getAllByRole("button", { name: "New case" });
    if (!newCaseButton) throw new Error("New case button not found");
    fireEvent.click(newCaseButton);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(screen.getByLabelText("Case title")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create case" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Give the case a title.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("lawyer matters page", () => {
  it("opens New matter as a dialog and validates an empty title", async () => {
    render(<MattersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "New matter" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create matter" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Give the matter a title.",
    );
  });
});

describe("lawyer pages design-token guard", () => {
  const root = path.join(__dirname);

  function pageFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return pageFiles(p);
      return e.name === "page.tsx" ? [p] : [];
    });
  }

  const files = pageFiles(root);

  /** Source lines that are code (not // or block-comment lines). */
  function codeLines(file: string): string[] {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
      });
  }

  it("finds the lawyer pages", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each([
    [
      "hardcoded palette classes",
      /\b(?:bg|text|border|ring)-(?:slate|gray|zinc|red|emerald|amber|green|blue)-\d{2,3}\b/,
    ],
    [
      "translucent status backgrounds",
      /\b(?:bg|border)-(?:primary|destructive|success|warning|info)\/\d+\b/,
    ],
    ["font-serif headings", /\bfont-serif\b/],
    [
      "arbitrary pixel font sizes above 10px",
      /\btext-\[(?:1[1-9]|2\d)(?:\.\d+)?px\]/,
    ],
  ])("has no %s", (_label, pattern) => {
    const offenders = files.flatMap((f) =>
      codeLines(f)
        .filter((l) => pattern.test(l))
        .map((l) => `${path.relative(root, f)}: ${l.trim().slice(0, 100)}`),
    );
    expect(offenders).toEqual([]);
  });
});
