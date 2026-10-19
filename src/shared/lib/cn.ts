import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Class-name combiner for the shared UI primitives (clsx + tailwind-merge).
 *
 * tailwind-merge does not know our opt-in type scale (`text-ui`, `text-meta`,
 * ...). Without the extension below it would treat those as text *colors* and
 * drop a conflicting `text-primary-foreground`, so they are registered as
 * font-size utilities.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "page-title",
            "section",
            "subsection",
            "body",
            "ui",
            "legal",
            "meta",
            "caption",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
