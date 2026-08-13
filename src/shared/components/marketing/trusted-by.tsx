// src/shared/components/marketing/trusted-by.tsx
// NEW FILE — homepage "Trusted By" section (Section 2 of the landing
// page brief).
//
// FLAGGED, DELIBERATE SCOPE BOUNDARY: the brief calls for "animated
// logos placeholder" — no real customer logos exist yet (this is a
// pre-launch/early product, per the rest of this project's own
// PROJECT_PROGRESS.md history). Built as labeled category placeholders
// (segment names, not fabricated company names/logos) rather than
// inventing fake customer logos, which would misrepresent real
// adoption. Swap in real logos here once they exist.
//
// Server Component — static content only.

const SEGMENTS = [
  'Law Firms',
  'Startups',
  'Corporate Legal Teams',
  'SMEs',
  'Individual Advocates',
] as const;

export function TrustedBy() {
  return (
    <section className="border-b border-border bg-muted/20 py-12">
      <div className="container mx-auto">
        <p className="mb-8 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Built for how Indian legal teams work
        </p>

        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
          {SEGMENTS.map((segment) => (
            <span
              key={segment}
              className="text-[14px] font-medium text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            >
              {segment}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}