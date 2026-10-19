import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationsPanel } from "./notifications-panel";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const row = (id: string, readAt: string | null) => ({
  id,
  user_id: "u1",
  document_id: "d1",
  type: "hearing_reminder",
  title: `Title ${id}`,
  message: `Message ${id}`,
  hearing_date_snapshot: "2026-11-01",
  read_at: readAt,
  created_at: new Date().toISOString(),
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  push.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => cleanup());

describe("NotificationsPanel", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <NotificationsPanel isOpen={false} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists notifications, marks unread ones, and reports the unread count", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            notifications: [row("1", null), row("2", "2026-01-01")],
            total: 2,
            limit: 20,
            offset: 0,
          },
        }),
        { status: 200 },
      ),
    );
    const onCount = vi.fn();
    render(
      <NotificationsPanel
        isOpen
        onClose={() => {}}
        onUnreadCountChange={onCount}
      />,
    );
    expect(await screen.findByText("Title 1")).toBeInTheDocument();
    expect(screen.getAllByText("Unread:")).toHaveLength(1);
    await waitFor(() => expect(onCount).toHaveBeenCalledWith(1));
  });

  it("shows an error with a working Retry", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { notifications: [], total: 0, limit: 20, offset: 0 },
          }),
          { status: 200 },
        ),
      );
    render(<NotificationsPanel isOpen onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText("No notifications yet."),
    ).toBeInTheDocument();
  });

  it("closes and routes to the full list", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { notifications: [], total: 0, limit: 20, offset: 0 },
        }),
        { status: 200 },
      ),
    );
    const onClose = vi.fn();
    render(<NotificationsPanel isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    expect(onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/lawyer/notifications");
    fireEvent.click(
      screen.getByRole("button", { name: "Close notifications" }),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape only while open", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { notifications: [], total: 0, limit: 20, offset: 0 },
        }),
        { status: 200 },
      ),
    );
    const onClose = vi.fn();
    const { rerender } = render(
      <NotificationsPanel isOpen={true} onClose={onClose} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<NotificationsPanel isOpen={false} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("announces loading as a status and failures as an alert", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "boom" } }), {
        status: 500,
      }),
    );
    render(<NotificationsPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("gives unread notifications a text cue, not just a dot", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            notifications: [row("1", null), row("2", "2026-01-01")],
            total: 2,
            limit: 20,
            offset: 0,
          },
        }),
        { status: 200 },
      ),
    );
    render(<NotificationsPanel isOpen={true} onClose={() => {}} />);
    await screen.findByText("Title 1");
    expect(screen.getAllByText("Unread:")).toHaveLength(1);
  });
});
