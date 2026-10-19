import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UploadAnalyzeModal } from "./upload-analyze-modal";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// Never resolves: keeps the modal in its busy (uploading) state.
const uploadDocument = vi.fn(() => new Promise<{ id: string }>(() => {}));
vi.mock("@/core/storage/document-upload", () => ({
  uploadDocument: (...args: unknown[]) =>
    (uploadDocument as (...a: unknown[]) => unknown)(...args),
  validateFile: vi.fn(),
  UploadValidationError: class extends Error {},
}));

beforeEach(() => {
  push.mockClear();
  uploadDocument.mockClear();
});
afterEach(cleanup);

async function selectFile(name = "nda.pdf") {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await userEvent.upload(
    input,
    new File(["x"], name, { type: "application/pdf" }),
  );
}

describe("UploadAnalyzeModal (Dialog)", () => {
  it("is a labelled modal dialog and Cancel calls onClose", async () => {
    const onClose = vi.fn();
    render(<UploadAnalyzeModal onClose={onClose} />);
    expect(
      screen.getByRole("dialog", { name: "Upload a legal document" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and via the Close button while idle", async () => {
    const onClose = vi.fn();
    render(<UploadAnalyzeModal onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not close on a backdrop click (previous behavior preserved)", () => {
    const onClose = vi.fn();
    render(<UploadAnalyzeModal onClose={onClose} />);
    const overlay = document.querySelector(
      '[data-state="open"].fixed.inset-0',
    ) as HTMLElement;
    expect(overlay).not.toBeNull();
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Upload & Analyze is disabled until a file is chosen", async () => {
    render(<UploadAnalyzeModal onClose={vi.fn()} />);
    const go = screen.getByRole("button", { name: "Upload & Analyze" });
    expect(go).toBeDisabled();
    await selectFile();
    expect(go).toBeEnabled();
    expect(screen.getByText("nda.pdf")).toBeInTheDocument();
  });

  it("while uploading: no Close button and Escape cannot dismiss the dialog", async () => {
    const onClose = vi.fn();
    render(<UploadAnalyzeModal onClose={onClose} />);
    await selectFile();
    await userEvent.click(
      screen.getByRole("button", { name: "Upload & Analyze" }),
    );
    expect(
      await screen.findByText("Uploading your document…"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("upload failure shows the error with Try again / Back to dashboard", async () => {
    uploadDocument.mockImplementationOnce(() =>
      Promise.reject(new Error("Storage unavailable")),
    );
    const onClose = vi.fn();
    render(<UploadAnalyzeModal onClose={onClose} />);
    await selectFile();
    await userEvent.click(
      screen.getByRole("button", { name: "Upload & Analyze" }),
    );
    expect(await screen.findByText("Storage unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      screen.getByRole("button", { name: "Upload & Analyze" }),
    ).toBeInTheDocument();
  });
});
