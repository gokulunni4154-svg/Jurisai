// src/app/page.tsx
// REPLACES the earlier placeholder (plain redirect to /sign-in) now
// that a real homepage is being built section by section. Sections not
// yet built (Problems We Solve, AI Capabilities, Platform Modules, Why
// JurisAI, Features Timeline, Testimonials, Pricing Preview, FAQ, Final
// CTA) are not included yet — this file will grow as each is delivered.
//
// Server Component — no 'use client' needed here; interactivity lives
// inside individual section components where required.

import { Hero } from '@/shared/components/marketing/hero';
import { TrustedBy } from '@/shared/components/marketing/trusted-by';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <Hero />
      <TrustedBy />
    </main>
  );
}