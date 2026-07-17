import Link from 'next/link';

/**
 * Shared shell for every page under /auth/* (sign-in, sign-up,
 * request-password-reset, and — once built — update-password).
 *
 * NAMING NOTE, important: this lives at `src/app/auth/layout.tsx`, a
 * real URL segment, NOT `src/app/(auth)/layout.tsx` (a route group,
 * which would be invisible in the URL). route-protection.ts's
 * PUBLIC_ROUTES does exact-match checks against literal paths like
 * `/auth/sign-in` — a route group would produce pages at `/sign-in`
 * instead, which is not in that list and would 404 under a redirect
 * loop. This segment name is load-bearing, not cosmetic; do not
 * "clean it up" into a route group later without updating
 * route-protection.ts (and middleware.ts's matcher, if it ever
 * becomes segment-aware) in the same change.
 *
 * Deliberately does NOT re-wrap ThemeProvider or set the font variable
 * — both already come from the root layout (File 6), which wraps this
 * one. This file only adds the auth-specific visual shell.
 *
 * Deliberately does NOT use Shadcn UI primitives (Button/Card/etc.) —
 * whether Shadcn has actually been initialized in this project
 * (components.json / src/components/ui/) is still an open question,
 * not confirmed. Plain Tailwind classes only, using the CSS custom
 * properties already defined in globals.css (File 5) via their mapped
 * token classes (bg-background, bg-card, text-muted-foreground,
 * border-border, text-primary). If Shadcn is confirmed set up later,
 * swapping the card wrapper for <Card> is a small, isolated follow-up,
 * not a rebuild.
 *
 * Individual pages (src/app/auth/sign-in/page.tsx etc., not yet built)
 * are responsible for their own form content and are expected to
 * render inside the <main> card below — this layout only supplies the
 * centered shell, brand header, and consistent max-width.
 */
interface AuthLayoutProps {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <Link
            href="/"
            className="text-xl font-semibold tracking-tight text-foreground"
          >
            Juris<span className="text-primary">AI</span>
          </Link>
          <p className="text-sm text-muted-foreground">
            India&rsquo;s AI Legal Operating System
          </p>
        </div>

        <main className="rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}