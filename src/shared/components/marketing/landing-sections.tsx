import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CalendarClock,
  FileSearch,
  FolderKanban,
  Inbox,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

import { buttonVariants } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/cn";

/**
 * Every statement below was checked against the codebase (modules, API
 * routes and terminal pages) rather than written from the product brief.
 */

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-caption font-semibold uppercase tracking-[0.12em] text-primary">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-balance text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground sm:text-[2rem]">
        {title}
      </h2>
      {description ? (
        <p className="mt-3 text-body text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

interface Capability {
  icon: LucideIcon;
  title: string;
  body: string;
}

const CAPABILITIES: readonly Capability[] = [
  {
    icon: Briefcase,
    title: "Matters and case files",
    body: "Keep each matter’s notes, timeline, documents and assignments in one place.",
  },
  {
    icon: CalendarClock,
    title: "Hearings, tasks and deadlines",
    body: "Track upcoming hearings and tasks, with notifications and hearing reminders.",
  },
  {
    icon: FolderKanban,
    title: "Document workflows",
    body: "Upload documents, extract their text, and organise related files into document sets.",
  },
  {
    icon: FileSearch,
    title: "AI-assisted document review",
    body: "Clause classification, missing-clause, risk and compliance checks, plus a legal health score for general users.",
  },
  {
    icon: Sparkles,
    title: "AI assistant",
    body: "An assistant available in the lawyer, firm and general-user workspaces.",
  },
  {
    icon: Users,
    title: "Firm collaboration",
    body: "Teams, invitations, client records, case assignment and an audit log for law firms.",
  },
];

export function Capabilities() {
  return (
    <section
      id="capabilities"
      className="scroll-mt-20 border-b border-border py-16 sm:py-20"
    >
      <div className="container">
        <SectionHeading
          eyebrow="Capabilities"
          title="What you can do in JurisAI today"
          description="Features vary by account type. See who each experience is for below."
        />
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="rounded-xl border border-border bg-card p-5 shadow-xs"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
                <Icon
                  className="h-[18px] w-[18px] text-primary"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </span>
              <h3 className="mt-4 text-subsection text-foreground">{title}</h3>
              <p className="mt-1.5 text-ui text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const STEPS = [
  {
    title: "Create your account",
    body: "Sign up as a general user, an individual lawyer or a law firm. Email confirmation is required where it is enabled.",
  },
  {
    title: "Land in the right workspace",
    body: "After sign-in you are taken to the workspace for your account type.",
  },
  {
    title: "Work with your matters and documents",
    body: "Manage matters, hearings and tasks, or upload documents for AI-assisted review.",
  },
] as const;

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="scroll-mt-20 border-b border-border bg-muted/40 py-16 sm:py-20"
    >
      <div className="container">
        <SectionHeading
          eyebrow="How it works"
          title="From sign-up to your workspace"
        />
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="relative rounded-xl border border-border bg-card p-5"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-ui font-semibold text-primary-foreground">
                {index + 1}
              </span>
              <h3 className="mt-4 text-subsection text-foreground">
                {step.title}
              </h3>
              <p className="mt-1.5 text-ui text-muted-foreground">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const AUDIENCES = [
  {
    icon: Inbox,
    title: "General users",
    body: "Upload documents for AI-assisted review, see a legal health overview, and send inquiries to lawyers and firms.",
  },
  {
    icon: Briefcase,
    title: "Individual lawyers",
    body: "Manage matters, hearings, tasks and document sets, and respond to inquiries. Lawyer accounts are verified manually before approval.",
  },
  {
    icon: Users,
    title: "Law firms",
    body: "Run a firm workspace with teams, clients, inquiries, firm-wide tasks, reports and an audit log.",
  },
] as const;

export function Audiences() {
  return (
    <section
      id="audiences"
      className="scroll-mt-20 border-b border-border py-16 sm:py-20"
    >
      <div className="container">
        <SectionHeading
          eyebrow="Who it’s for"
          title="Three distinct experiences"
          description="Each account type has its own workspace and its own access. They are not interchangeable."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {AUDIENCES.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="rounded-xl border border-border bg-card p-5 shadow-xs"
            >
              <Icon
                className="h-5 w-5 text-primary"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <h3 className="mt-3 text-subsection text-foreground">{title}</h3>
              <p className="mt-1.5 text-ui text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ResponsibleAi() {
  return (
    <section
      id="responsible-ai"
      className="scroll-mt-20 border-b border-border bg-muted/40 py-16 sm:py-20"
    >
      <div className="container">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-xs sm:flex-row sm:p-8">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
            <ShieldCheck
              className="h-5 w-5 text-primary"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </span>
          <div>
            <h2 className="text-section text-foreground">
              AI assistance, not legal advice
            </h2>
            <p className="mt-2 text-body text-muted-foreground">
              AI-generated analysis can be incomplete or wrong. JurisAI is a
              tool to support legal work. It does not replace a qualified
              lawyer, and its output should be reviewed by a professional before
              you rely on it.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="py-16 sm:py-20">
      <div className="container">
        <div className="mx-auto max-w-3xl rounded-2xl bg-sidebar px-6 py-12 text-center sm:px-10">
          <h2 className="text-balance text-[1.75rem] font-semibold leading-tight tracking-tight text-sidebar-foreground sm:text-[2rem]">
            Ready to set up your workspace?
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-body text-sidebar-muted">
            Create an account to get started, or sign in if you already have
            one.
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-11 bg-sidebar-foreground px-6 text-sidebar hover:bg-sidebar-foreground/90",
              )}
            >
              Create an account
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex h-11 items-center justify-center rounded-md border border-sidebar-border px-6 text-ui font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
