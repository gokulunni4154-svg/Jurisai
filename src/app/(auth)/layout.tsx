import Link from "next/link";
import { Check } from "lucide-react";

import { ThemeSwitcher } from "@/shared/components/layout/theme-switcher";
import { BrandMark } from "@/shared/components/marketing/brand-mark";

/**
 * Shared shell for the pages in the `(auth)` route group (sign-in, sign-up,
 * request-password-reset, update-password). `(auth)` is a route group, so
 * these live at /sign-in, /sign-up etc. with no `/auth` prefix; that is what
 * route-protection.ts's PUBLIC_ROUTES lists. Do not rename the group without
 * updating that list.
 *
 * Theme state comes from the root layout's ThemeProvider; the navy panel
 * uses the existing sidebar tokens, so nothing new is introduced.
 */
const POINTS = [
  "Separate workspaces for general users, individual lawyers and law firms.",
  "AI-assisted document review that supports, and never replaces, legal advice.",
] as const;

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <BrandMark tone="inverse" />
        <div className="max-w-md space-y-6">
          <h2 className="text-balance text-[2rem] font-semibold leading-tight tracking-tight">
            An AI-assisted legal workspace, built for India.
          </h2>
          <ul className="space-y-3">
            {POINTS.map((point) => (
              <li
                key={point}
                className="flex items-start gap-3 text-body text-sidebar-muted"
              >
                <Check
                  className="mt-1 h-4 w-4 shrink-0 text-sidebar-ring"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-caption text-sidebar-muted">
          &copy; {new Date().getFullYear()} JurisAI
        </p>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between px-4 py-4 sm:px-8">
          <div className="lg:invisible">
            <BrandMark />
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-md text-ui font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Back to home
            </Link>
            <ThemeSwitcher />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 pb-12 pt-4 sm:px-8">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
