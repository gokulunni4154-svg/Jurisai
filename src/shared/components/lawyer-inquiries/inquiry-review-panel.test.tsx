import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InquiryReviewPanel } from "./inquiry-review-panel";

const review = {
  inquiry: {
    id: "inq-1",
    status: "pending",
    targetProfileId: null,
    caseId: null,
    createdAt: "2026-10-01T00:00:00.000Z",
  },
  stage: "pre_acceptance",
  capacity: "firm_reviewer",
  reviewExpiresAt: "2026-10-08T00:00:00.000Z",
  canDecide: true,
  requiresAssignee: true,
  documents: [
    {
      id: "d1",
      fileName: "lease.pdf",
      analysisState: "processing",
      report: null,
    },
  ],
};

const roster = [
  {
    profile_id: "p-lawyer",
    role: "lawyer",
    profile: { full_name: "Asha Menon" },
  },
  {
    profile_id: "p-emp",
    role: "employee",
    profile: { full_name: "Not Eligible" },
  },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/review"))
      return { ok: true, json: async () => ({ data: review }) } as Response;
    if (url.endsWith("/members/roster"))
      return { ok: true, json: async () => ({ data: roster }) } as Response;
    return { ok: true, json: async () => ({ data: {} }) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InquiryReviewPanel decision form", () => {
  it("keeps every field labelled, filters the roster and shows the analysis state badge", async () => {
    render(
      <InquiryReviewPanel
        inquiryId="inq-1"
        backHref="/firm/f1/inquiries"
        firmId="f1"
      />,
    );
    expect(
      await screen.findByText("Analysis still processing"),
    ).toBeInTheDocument();
    const assignee = screen.getByLabelText(
      "Assign to (required to accept for the firm)",
    );
    expect(assignee.tagName).toBe("SELECT");
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: /Asha Menon/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("option", { name: /Not Eligible/ })).toBeNull();
    expect(screen.getByLabelText("Case title (optional)")).toHaveAttribute(
      "maxlength",
      "255",
    );
    expect(
      screen.getByLabelText(
        "Note if declining (optional, private to reviewers)",
      ),
    ).toHaveAttribute("maxlength", "1000");
  });

  it("accept is blocked client-side until an assignee is chosen, then posts the same body as before", async () => {
    render(<InquiryReviewPanel inquiryId="inq-1" backHref="/b" firmId="f1" />);
    await screen.findByText("Your decision");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(
      screen.getByText("Choose the lawyer this inquiry should be assigned to."),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).endsWith("/accept")),
    ).toBe(false);

    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: /Asha Menon/ }),
      ).toBeInTheDocument(),
    );
    await userEvent.selectOptions(
      screen.getByLabelText(/Assign to/),
      "p-lawyer",
    );
    await userEvent.type(
      screen.getByLabelText("Case title (optional)"),
      "  Lease dispute  ",
    );
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));

    const call = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith("/accept"),
    )!;
    expect(call[0]).toBe("/api/lawyer-inquires/inq-1/accept");
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      title: "Lease dispute",
      assigneeProfileId: "p-lawyer",
    });
    expect(await screen.findByText(/Inquiry accepted\./)).toBeInTheDocument();
  });

  it("decline posts the trimmed note and does not require an assignee", async () => {
    render(<InquiryReviewPanel inquiryId="inq-1" backHref="/b" firmId="f1" />);
    await screen.findByText("Your decision");
    await userEvent.type(
      screen.getByLabelText(/Note if declining/),
      " out of scope ",
    );
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    const call = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith("/decline"),
    )!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      note: "out of scope",
    });
    expect(await screen.findByText(/Inquiry declined\./)).toBeInTheDocument();
  });
});
