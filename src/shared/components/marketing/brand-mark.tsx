import Link from "next/link";
import { Scale } from "lucide-react";

import { cn } from "@/shared/lib/cn";

/**
 * JurisAI brand lockup (Scale mark + wordmark), matching the approved
 * terminal sidebar brand. `tone="inverse"` is for the navy (sidebar-token)
 * surfaces; `tone="default"` for the page background.
 */
export function BrandMark({
  tone = "default",
  className,
}: {
  tone?: "default" | "inverse";
  className?: string;
}) {
  const inverse = tone === "inverse";
  return (
    <Link
      href="/"
      aria-label="JurisAI home"
      className={cn("inline-flex items-center gap-2.5 rounded-md", className)}
    >
      <span
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg",
          inverse ? "bg-sidebar-accent" : "bg-sidebar",
        )}
      >
        <Scale
          className="h-[18px] w-[18px] text-sidebar-accent-foreground"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </span>
      <span
        className={cn(
          "text-body font-semibold tracking-tight",
          inverse ? "text-sidebar-foreground" : "text-foreground",
        )}
      >
        JurisAI
      </span>
    </Link>
  );
}
