import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { cn } from "@/shared/lib/cn";

import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";
import { FieldError, Label } from "./label";
import { Input, Select, Textarea } from "./input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

beforeAll(() => {
  // Radix (tooltip/dialog positioning) needs ResizeObserver; jsdom lacks it.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(cleanup);

describe("cn", () => {
  it("keeps a text color alongside the custom type scale (text-ui)", () => {
    expect(cn("text-ui", "text-primary-foreground")).toBe(
      "text-ui text-primary-foreground",
    );
  });
  it("still lets a later size/color override an earlier one", () => {
    expect(cn("text-ui", "text-meta")).toBe("text-meta");
    expect(cn("bg-primary", "bg-destructive")).toBe("bg-destructive");
  });
});

describe("Button", () => {
  it("does not force a type (native default is preserved)", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute(
      "type",
    );
  });
  it("applies variant and size and merges className", () => {
    render(
      <Button variant="destructive" size="sm" className="w-full">
        Delete
      </Button>,
    );
    const el = screen.getByRole("button", { name: "Delete" });
    expect(el).toHaveClass("bg-destructive", "h-8", "w-full", "text-meta");
  });
  it("asChild renders the child element, not a nested button", () => {
    render(
      <Button asChild>
        <a href="/x">Go</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Go" });
    expect(link).toHaveAttribute("href", "/x");
    expect(link).toHaveClass("bg-primary");
  });
  it("disabled buttons do not fire onClick", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        No
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("form controls", () => {
  it("Label is associated with Input and Textarea", () => {
    render(
      <>
        <Label htmlFor="a">Name</Label>
        <Input id="a" aria-invalid="true" aria-describedby="e" />
        <FieldError id="e">Required</FieldError>
        <Label htmlFor="b">Notes</Label>
        <Textarea id="b" />
      </>,
    );
    const input = screen.getByLabelText("Name");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Required");
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
    expect(screen.getByLabelText("Notes").tagName).toBe("TEXTAREA");
  });
  it("Select is a native select with the shared field styling", async () => {
    render(
      <>
        <Label htmlFor="s">Role</Label>
        <Select id="s" defaultValue="">
          <option value="">Pick…</option>
          <option value="a">Admin</option>
        </Select>
      </>,
    );
    const sel = screen.getByLabelText("Role");
    expect(sel.tagName).toBe("SELECT");
    expect(sel).toHaveClass("border-input", "text-ui");
    await userEvent.selectOptions(sel, "a");
    expect(sel).toHaveValue("a");
  });
});

describe("Card, Badge, Table", () => {
  it("Card renders a heading and content", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Open cases</CardTitle>
        </CardHeader>
        <CardContent>body</CardContent>
      </Card>,
    );
    expect(
      screen.getByRole("heading", { level: 3, name: "Open cases" }),
    ).toBeInTheDocument();
  });
  it("Badge uses the solid subtle pair, not a translucent background", () => {
    render(<Badge variant="warning">Due soon</Badge>);
    const el = screen.getByText("Due soon");
    expect(el).toHaveClass(
      "bg-warning-subtle",
      "text-warning-subtle-foreground",
    );
    expect(el.className).not.toMatch(/bg-[a-z-]+\/\d+/);
  });
  it("Table keeps native semantics and scrolls inside its own wrapper", () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Case</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>State v. Rao</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(
      screen.getByRole("columnheader", { name: "Case" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "State v. Rao" }),
    ).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("overflow-x-auto");
  });
});

describe("Tooltip", () => {
  it("opens on keyboard focus and exposes the label", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">Trigger</button>
          </TooltipTrigger>
          <TooltipContent>Helpful text</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    await userEvent.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Helpful text",
    );
  });
});

describe("Dialog", () => {
  it("is a labelled modal dialog, closes on Escape and via the close button", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Upload</DialogTitle>
          <DialogDescription>Pick a file</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Upload" });
    expect(dialog).toHaveAccessibleDescription("Pick a file");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });
  it("hideClose removes the built-in close button", () => {
    render(
      <Dialog open>
        <DialogContent hideClose>
          <DialogTitle>Busy</DialogTitle>
          <DialogDescription>Please wait</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});
