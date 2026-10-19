import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";

import { cn } from "@/shared/lib/cn";

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "text-ui font-medium text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";

/** Help text under a field. Link it with `aria-describedby`. */
export function FieldHint({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-meta text-muted-foreground", className)}
      {...props}
    />
  );
}

/** Validation message under a field. Pair with `aria-invalid` on the control. */
export function FieldError({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      role="alert"
      className={cn("text-meta font-medium text-destructive", className)}
      {...props}
    />
  );
}
