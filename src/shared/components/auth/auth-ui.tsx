"use client";

import { useState, type ReactNode } from "react";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";

import { Input, type InputProps } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/lib/cn";

/** Touch-friendly sizing; 16px text on small screens avoids iOS focus-zoom. */
const FIELD_CLASS = "h-11 max-sm:text-base";

interface AuthFieldProps extends Omit<InputProps, "id"> {
  id: string;
  label: string;
  /** Field-validation message. Rendered inline, never as an alert. */
  error?: string | null;
  hint?: ReactNode;
  hintTone?: "muted" | "error";
}

/**
 * Label + input + hint/error with the aria wiring done once. Field-level
 * validation messages are deliberately NOT role="alert": the form-level
 * <AuthAlert> is the single live region for authentication/server errors, so
 * the two kinds of error stay distinct for assistive tech and in the UI.
 */
export function AuthField({
  id,
  label,
  error,
  hint,
  hintTone = "muted",
  className,
  ...props
}: AuthFieldProps) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(FIELD_CLASS, className)}
        {...props}
      />
      {error ? (
        <p
          id={`${id}-error`}
          className="text-meta font-medium text-destructive"
        >
          {error}
        </p>
      ) : null}
      {hint ? (
        <p
          id={`${id}-hint`}
          className={cn(
            "text-meta",
            hintTone === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** AuthField with a show/hide toggle. Defaults to hidden on every mount. */
export function PasswordField({
  label,
  className,
  ...props
}: Omit<AuthFieldProps, "type">) {
  const [visible, setVisible] = useState(false);
  const toggleLabel = `${visible ? "Hide" : "Show"} ${label.toLowerCase()}`;
  return (
    <div className="relative">
      <AuthField
        label={label}
        type={visible ? "text" : "password"}
        className={cn("pr-11", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={toggleLabel}
        title={toggleLabel}
        // Centred on the 44px input row: 20px label + 6px gap + (44-36)/2.
        className="absolute right-1 top-[30px] flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
      >
        {visible ? (
          <EyeOff className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

/** Form-level error/notice. The one role="alert" region in an auth form. */
export function AuthAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive-subtle px-3.5 py-3 text-ui text-destructive-subtle-foreground"
    >
      <AlertCircle
        className="mt-0.5 h-4 w-4 shrink-0"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <p>{children}</p>
    </div>
  );
}

export function SubmitButton({
  pending,
  idleLabel,
  pendingLabel,
}: {
  pending: boolean;
  idleLabel: string;
  pendingLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-ui font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : null}
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}

/** Heading block used by every auth state (form, success, check-email). */
export function AuthHeading({
  title,
  description,
}: {
  title: string;
  description?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <h1 className="text-page-title text-foreground">{title}</h1>
      {description ? (
        <p className="text-body text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
