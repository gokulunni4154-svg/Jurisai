// Stage 5 (Lawyer Firm Terminal) UI regression tests.
//
// 1. Behavior: the firm dashboard still renders its data and now surfaces
//    status, deadline (overdue) and assignment state as badges derived ONLY
//    from fields the API already returns; the 403 "owner/admin only" state is
//    unchanged; the firm to-dos page keeps its create validation and shows
//    overdue to-dos.
// 2. Token guard: firm pages must not reintroduce hardcoded palette classes,
//    translucent status backgrounds, font-serif or small pixel font sizes.
//
// These tests assert nothing about authorization: each API route enforces its
// own access rules (including firm-membership checks) and none was touched.

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

import FirmDashboardPage from "./dashboard/page";
import FirmToDosPage from "./tasks/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/firm/firm-1234567/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ firmId: "firm-1234567" }),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const FIRM_ID = "firm-1234567";
const DAY = 86_400_000;
const yesterday = new Date(Date.now() - DAY).toLocaleDateString("en-CA");
const nextWeek = new Date(Date.now() + 7 * DAY).toLocaleDateString("en-CA");
const nowIso = new Date().toISOString();

const baseTask = {
  firm_id: FIRM_ID,
  description: null,
  created_by: "p0",
  created_at: nowIso,
  updated_at: nowIso,
};

const DASHBOARD = {
  firmCases: [
    {
      id: "c1",
      firm_id: FIRM_ID,
      owner_id: "p0",
      title: "Sharma v. Patel",
      status: "open",
      team_id: null,
      created_at: nowIso,
      updated_at: nowIso,
    },
  ],
  firmTasks: [
    {
      ...baseTask,
      id: "t1",
      case_id: "c1",
      assignee_profile_id: null,
      title: "File written statement",
      status: "in_progress",
      due_date: yesterday,
    },
    {
      ...baseTask,
      id: "t2",
      case_id: "c1",
      assignee_profile_id: "p9",
      title: "Collect affidavits",
      status: "done",
      due_date: yesterday,
    },
    {
      ...baseTask,
      id: "t3",
      case_id: null,
      assignee_profile_id: "p9",
      title: "Renew office lease",
      status: "todo",
      due_date: nextWeek,
    },
  ],
  upcomingHearings: [],
};

function stubFetch(handler: (url: string) => Partial<Response> | undefined) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const res = handler(url);
      if (res) return res as Response;
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("firm dashboard", () => {
  it("shows status, overdue and assignment badges from existing fields", async () => {
    stubFetch((url) =>
      url === `/api/dashboard/firm/${FIRM_ID}`
        ? { ok: true, status: 200, json: async () => ({ data: DASHBOARD }) }
        : undefined,
    );

    render(<FirmDashboardPage params={{ firmId: FIRM_ID }} />);

    expect(await screen.findByText("Sharma v. Patel")).toBeTruthy();
    expect(screen.getByText("No team")).toBeTruthy();
    expect(screen.getByText("File written statement")).toBeTruthy();
    // Only the unfinished, past-due task is overdue (the done one is not).
    expect(screen.getAllByText("Overdue")).toHaveLength(1);
    expect(screen.getByText("Unassigned")).toBeTruthy();
    expect(screen.getByText("Standalone")).toBeTruthy();
    expect(screen.getByText("in_progress")).toBeTruthy();
    expect(screen.getByText("No upcoming hearings.")).toBeTruthy();
  });

  it("keeps the owner/admin-only message on a 403", async () => {
    stubFetch((url) =>
      url === `/api/dashboard/firm/${FIRM_ID}`
        ? { ok: false, status: 403, json: async () => ({}) }
        : undefined,
    );

    render(<FirmDashboardPage params={{ firmId: FIRM_ID }} />);

    expect(
      await screen.findByText(
        "The firm dashboard is only visible to this firm's owner or admins.",
      ),
    ).toBeTruthy();
  });
});

describe("firm to-dos", () => {
  const TODOS = [
    {
      id: "k1",
      firm_id: FIRM_ID,
      case_id: null,
      title: "Chase court registry",
      description: null,
      status: "todo",
      assignee_profile_id: null,
      due_date: yesterday,
      created_by: "p0",
      created_at: nowIso,
    },
  ];

  beforeEach(() => {
    stubFetch((url) =>
      url === `/api/firms/${FIRM_ID}/tasks`
        ? { ok: true, status: 200, json: async () => ({ data: TODOS }) }
        : undefined,
    );
  });

  it("lists to-dos and flags the overdue one", async () => {
    render(<FirmToDosPage />);

    expect(await screen.findByText("Chase court registry")).toBeTruthy();
    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.getByText("Unassigned")).toBeTruthy();
  });

  it("validates an empty title before calling the API", async () => {
    render(<FirmToDosPage />);
    await screen.findByText("Chase court registry");

    fireEvent.click(screen.getByRole("button", { name: "New to-do" }));
    fireEvent.click(screen.getByRole("button", { name: "Create to-do" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Title cannot be empty.",
      );
    });
    const fetchMock = vi.mocked(fetch);
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(false);
  });
});

describe("firm pages design-token guard", () => {
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

  it("finds the firm pages", () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
  });

  it.each([
    [
      "hardcoded palette classes",
      /\b(?:bg|text|border|ring|divide)-(?:slate|gray|zinc|red|emerald|amber|green|blue)-\d{2,3}\b/,
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
