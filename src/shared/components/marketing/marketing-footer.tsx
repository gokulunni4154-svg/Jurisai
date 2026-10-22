import Link from "next/link";

import { BrandMark } from "./brand-mark";

/**
 * Footer lists only routes that exist and are public (see
 * route-protection.ts PUBLIC_ROUTES). No contact details, policy pages or
 * social links are shown because none exist in the product yet.
 */
export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="container flex flex-col gap-8 py-10 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xs space-y-3">
          <BrandMark />
          <p className="text-meta text-muted-foreground">
            An AI-assisted legal workspace for individuals, lawyers and law
            firms in India.
          </p>
        </div>

        <nav aria-label="Footer" className="flex gap-12">
          <div className="space-y-2">
            <p className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
              Product
            </p>
            <ul className="space-y-1.5 text-ui">
              <li>
                <a
                  href="#capabilities"
                  className="text-foreground hover:text-primary"
                >
                  Capabilities
                </a>
              </li>
              <li>
                <a
                  href="#responsible-ai"
                  className="text-foreground hover:text-primary"
                >
                  Responsible AI
                </a>
              </li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
              Account
            </p>
            <ul className="space-y-1.5 text-ui">
              <li>
                <Link
                  href="/sign-in"
                  className="text-foreground hover:text-primary"
                >
                  Sign in
                </Link>
              </li>
              <li>
                <Link
                  href="/sign-up"
                  className="text-foreground hover:text-primary"
                >
                  Sign up
                </Link>
              </li>
            </ul>
          </div>
        </nav>
      </div>
      <div className="border-t border-border">
        <p className="container py-4 text-caption text-muted-foreground">
          &copy; {new Date().getFullYear()} JurisAI. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
