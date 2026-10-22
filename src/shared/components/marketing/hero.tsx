import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  FileSearch,
  Scale,
  Sparkles,
} from "lucide-react";

import { buttonVariants } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/cn";

/**
 * Hero. The product preview is a clearly-labelled ILLUSTRATION built from
 * placeholder bars: it contains no figures, case names or "insights", so
 * nothing on it can be mistaken for live data or a performance claim.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-primary/5 to-transparent"
        aria-hidden="true"
      />
      <div className="container relative grid items-center gap-14 py-16 sm:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
        <div className="flex flex-col items-start">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-caption font-medium text-muted-foreground">
            <Sparkles
              className="h-3.5 w-3.5 text-primary"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            AI-assisted legal workspace, built for India
          </p>

          <h1 className="text-balance text-[2.25rem] font-semibold leading-[1.1] tracking-tight text-foreground sm:text-[2.75rem] lg:text-[3.25rem]">
            One workspace for legal matters, documents and AI-assisted analysis
          </h1>

          <p className="mt-5 max-w-xl text-body text-muted-foreground sm:text-[1.0625rem] sm:leading-7">
            JurisAI brings matter management, hearing and task tracking,
            document analysis and an AI assistant together, with separate
            experiences for individuals, lawyers and law firms.
          </p>

          <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link
              href="/sign-up"
              className={cn(buttonVariants({ size: "lg" }), "h-11 px-6")}
            >
              Create an account
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/sign-in"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-11 px-6",
              )}
            >
              Sign in
            </Link>
          </div>
        </div>

        <figure className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div
            aria-hidden="true"
            className="rounded-xl border border-border bg-card p-4 shadow-md sm:p-5"
          >
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-sidebar">
                <Scale
                  className="h-3.5 w-3.5 text-sidebar-accent-foreground"
                  strokeWidth={1.75}
                />
              </span>
              <span className="h-2.5 w-24 rounded-full bg-muted" />
              <span className="ml-auto h-2.5 w-10 rounded-full bg-accent" />
            </div>

            <div className="mt-4 space-y-2.5">
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5"
                >
                  <span className="h-8 w-8 shrink-0 rounded-md bg-muted" />
                  <span className="flex-1 space-y-1.5">
                    <span className="block h-2.5 w-3/5 rounded-full bg-muted" />
                    <span className="block h-2 w-2/5 rounded-full bg-muted/70" />
                  </span>
                  <span className="h-5 w-12 rounded-full bg-accent" />
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border p-3">
                <CalendarClock
                  className="mb-2 h-4 w-4 text-primary"
                  strokeWidth={1.75}
                />
                <span className="block h-2.5 w-2/3 rounded-full bg-muted" />
                <span className="mt-1.5 block h-2 w-1/2 rounded-full bg-muted/70" />
              </div>
              <div className="rounded-lg border border-border p-3">
                <FileSearch
                  className="mb-2 h-4 w-4 text-primary"
                  strokeWidth={1.75}
                />
                <span className="block h-2.5 w-2/3 rounded-full bg-muted" />
                <span className="mt-1.5 block h-2 w-1/2 rounded-full bg-muted/70" />
              </div>
            </div>
          </div>
          <figcaption className="mt-3 text-center text-caption text-muted-foreground">
            Illustrative layout only. Not live data.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
