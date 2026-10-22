import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { AuthField, PasswordField } from "./auth-ui";

afterEach(() => cleanup());

describe("PasswordField", () => {
  it("is hidden by default and toggles visibility with an accurate accessible name", async () => {
    const user = userEvent.setup();
    render(
      <PasswordField
        id="password"
        label="Password"
        value="secret"
        onChange={() => {}}
      />,
    );
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: "Hide password" }),
    ).toBeInTheDocument();
  });

  it("keeps the toggle out of form submission (type=button)", () => {
    render(
      <PasswordField
        id="password"
        label="Password"
        value=""
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Show password" }),
    ).toHaveAttribute("type", "button");
  });
});

describe("AuthField", () => {
  it("links the error to the control without creating a live alert", () => {
    render(
      <AuthField id="email" label="Email" error="Enter your email address." />,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "email-error");
    expect(screen.getByText("Enter your email address.")).toHaveAttribute(
      "id",
      "email-error",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
