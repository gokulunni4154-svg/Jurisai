create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),

  -- Who/what performed the action. actor_id is nullable because not every
  -- event has a human actor (e.g. the cron-driven hearing-reminder job).
  -- actor_type disambiguates 'user' vs 'system' rather than inferring it
  -- from actor_id being null, so the intent is explicit at read time.
  actor_type text not null check (actor_type in ('user', 'system')),
  actor_id uuid references profiles(id) on delete set null,

  -- Captured opportunistically when the action occurred within a firm
  -- context (e.g. a Billing action). Deliberately NOT used for access
  -- control — BaseService#requireOwnership is documented as single-owner
  -- only, and firm-level authorization needs dedicated design, not a
  -- shortcut through this column. This column exists so that data is
  -- available once that design happens.
  firm_id uuid references firms(id) on delete set null,

  -- Dot-namespaced action identifier, e.g. 'billing.subscription.cancel',
  -- 'document.create'. Free text rather than an enum: an enum would need
  -- a migration for every new auditable action across every future
  -- module, which doesn't scale with a file-by-file build process.
  action text not null,

  -- What the action was performed on, if applicable. Both nullable since
  -- some actions (e.g. a failed login attempt) have no single resource.
  resource_type text,
  resource_id uuid,

  -- Free-form event detail (old/new values, request metadata, etc.).
  -- Shape is intentionally undefined at the schema level — each call
  -- site owns its own metadata contract.
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_actor_id on audit_log (actor_id);
create index if not exists idx_audit_log_firm_id on audit_log (firm_id) where firm_id is not null;
create index if not exists idx_audit_log_created_at on audit_log (created_at desc);
create index if not exists idx_audit_log_action on audit_log (action);

alter table audit_log enable row level security;

-- No RLS policy for direct client reads is created here. Every existing
-- module's own notification/document repositories are RLS-scoped to
-- `auth.uid()`, but Audit Log intentionally has no such policy yet:
-- write access should go through AuditLogRepository using the
-- RLS-bypassing admin client (per base.repository.ts's documented
-- client-choice pattern), and read access needs a real access-control
-- decision (self-only? firm-owner? admin-only?) before any policy is
-- written — flagged as open, not decided here.