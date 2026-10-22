// Public home page. Server Component; the only client code is the
// mobile-menu disclosure inside MarketingHeader.

import { Hero } from "@/shared/components/marketing/hero";
import {
  Audiences,
  Capabilities,
  FinalCta,
  HowItWorks,
  ResponsibleAi,
} from "@/shared/components/marketing/landing-sections";
import { MarketingFooter } from "@/shared/components/marketing/marketing-footer";
import { MarketingHeader } from "@/shared/components/marketing/marketing-header";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <MarketingHeader />
      <main className="flex-1">
        <Hero />
        <Capabilities />
        <HowItWorks />
        <Audiences />
        <ResponsibleAi />
        <FinalCta />
      </main>
      <MarketingFooter />
    </div>
  );
}
