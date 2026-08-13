// src/shared/components/marketing/hero.tsx
// NEW FILE — homepage Hero section (Section 1 of the landing page brief).
//
// STYLE CONVENTIONS carried over from the real, pasted
// src/app/pricing/page.tsx: font-serif for headings, text-[13px]/[12px]/
// [11px] type scale, bg-primary/text-primary-foreground for the primary
// CTA button, border-border for outlined elements, Scale icon from
// lucide-react as the brand mark (same icon pricing/page.tsx uses in its
// header).
//
// FLAGGED, DELIBERATE CHOICE: no framer-motion. Nothing in any real,
// pasted file this project has produced so far (pricing/page.tsx,
// notifications-panel.tsx, hearing-reminder-status.tsx) uses it — all
// existing motion is plain Tailwind transitions plus the two keyframes
// already declared in tailwind.config.ts (fade-in, accordion-down/up).
// This file follows that same pattern rather than introducing a new
// animation paradigm unprompted. The "animated dashboard preview" and
// "floating cards" called for in the brief are built as a static
// illustrative composition with CSS-only fade-in/hover treatment, not a
// scroll-triggered animation library.
//
// Server Component (no 'use client') — no interactivity needed beyond
// CSS hover states and native <Link> navigation.

import Link from 'next/link';
import { ArrowRight, Scale, Sparkles } from 'lucide-react';

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      {/* Subtle background wash — restrained, matches "not flashy" brief
          direction while still giving the section some depth. */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent"
        aria-hidden="true"
      />

      <div className="container relative mx-auto grid grid-cols-1 items-center gap-16 py-24 lg:grid-cols-2 lg:py-32">
        {/* Left: headline, subhead, CTAs */}
        <div className="flex flex-col items-start">
          <div className="mb-6 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 animate-fade-in">
            <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />
            <span className="text-[12px] font-medium text-muted-foreground">
              Built for Indian law firms &amp; legal teams
            </span>
          </div>

          <h1 className="font-serif text-[40px] leading-[1.1] text-foreground sm:text-[48px] lg:text-[56px]">
            India&rsquo;s AI Legal
            <br />
            Operating System
          </h1>

          <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-muted-foreground sm:text-[16px]">
            JurisAI brings case management, document intelligence, and
            AI-powered legal analysis into one platform — built for the way
            Indian lawyers and firms actually work.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/sign-in"
              className="flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-3 text-[14px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Get started
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </Link>
            <Link
              href="/pricing"
              className="flex items-center justify-center rounded-md border border-border bg-card px-6 py-3 text-[14px] font-medium text-foreground transition-colors hover:bg-muted/50"
            >
              View pricing
            </Link>
          </div>

          <p className="mt-6 text-[12px] text-muted-foreground/70">
            No credit card required to get started.
          </p>
        </div>

        {/* Right: illustrative dashboard preview with floating cards */}
        <div className="relative animate-fade-in">
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
                  <Scale className="h-[14px] w-[14px] text-primary" strokeWidth={1.75} />
                </div>
                <span className="text-[12px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Case Overview
                </span>
              </div>
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                On track
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {[
                { label: 'Active cases', value: '24' },
                { label: 'Hearings this week', value: '6' },
                { label: 'Documents analyzed', value: '312' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="flex items-center justify-between rounded-md bg-muted/40 px-4 py-3"
                >
                  <span className="text-[13px] text-muted-foreground">{stat.label}</span>
                  <span className="font-serif text-[18px] text-foreground">{stat.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Floating card — top right */}
          <div className="absolute -right-6 -top-6 hidden w-48 rounded-lg border border-border bg-card p-4 shadow-md sm:block">
            <div className="mb-2 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                AI Insight
              </span>
            </div>
            <p className="text-[12px] leading-relaxed text-foreground">
              Missing indemnity clause detected in Contract #4021.
            </p>
          </div>

          {/* Floating card — bottom left */}
          <div className="absolute -bottom-8 -left-6 hidden w-44 rounded-lg border border-border bg-card p-4 shadow-md sm:block">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Legal Health
              </span>
              <span className="text-[11px] font-medium text-success">92%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-[92%] rounded-full bg-success" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}