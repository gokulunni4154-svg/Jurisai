-- Migration: convert audit_log.actor_type to a real Postgres enum
--
-- CLOSES the flagged gap from the Audit Log session's own addendum:
-- actor_type was a CHECK-constrained `text` column, not a real Postgres
-- enum, so database.types.ts compiles it as plain `string` rather than a
-- literal `'user' | 'system' | 'webhook'` union — cosmetic/type-safety
-- only at the time, since the live CHECK already enforced real validity,
-- but flagged as "would require converting the column to a real Postgres
-- enum type to fix, not attempted." This migration is that fix.
--
-- SOURCE-VERIFIED, THIS SESSION — the live constraint, confirmed via
-- direct SQL against the real DB (not assumed):
--   audit_log_actor_type_check: CHECK ((actor_type = ANY
--     (ARRAY['user'::text, 'system'::text, 'webhook'::text])))
-- All three values below match that exactly, including order — no new
-- value introduced, no existing value dropped.
--
-- CONVENTION — this project already creates real Postgres enums this way
-- for other status/provider columns (confirmed via
-- 20260714081335_create_document_analyses_table.sql's own
-- `create type document_analysis_status as enum (...)` /
-- `create type ai_provider_name as enum (...)` pattern). This migration
-- follows that same shape rather than inventing a new one — a plain
-- `create type ... as enum (...)` followed by an `alter column ... type
-- ... using ...` cast, since audit_log's table already exists (unlike
-- the document_analyses precedent, which created its enum types inline
-- with a brand-new table).
--
-- NOT ATTEMPTED HERE, FLAGGED: dropping audit_log_actor_type_check
-- itself. Once the column's type is a real enum, Postgres enforces valid
-- values at the type level — the CHECK constraint becomes redundant,
-- not incorrect. Dropped below explicitly as a real, structural
-- cleanup rather than left in place as dead, silently-duplicate
-- enforcement.
--
-- FLAGGED, NOT DECIDED HERE: AuditLogRepository's recordUserAction() /
-- recordSystemAction() / recordWebhookAction() (audit-log.repository.ts)
-- currently pass actor_type as a plain string literal
-- ('user' / 'system' / 'webhook') into `.create()`. Those calls should
-- still type-check fine against the new enum once database.types.ts is
-- regenerated (a string literal narrows to a matching enum member
-- automatically), but that regeneration is a separate step — see the
-- note below. Not verified against the real repository file in this
-- session's context beyond what was already pasted in the prior
-- session; re-paste and re-check if this migration is applied.
--
-- REQUIRED FOLLOW-UP, NOT DONE BY THIS FILE: database.types.ts must be
-- regenerated (e.g. via the Supabase CLI's real type-generation command
-- against the live schema) after this migration is applied, so
-- audit_log.Row/Insert/Update's actor_type field picks up the new
-- 'user' | 'system' | 'webhook' literal union. Hand-editing that
-- generated file instead of regenerating it was deliberately not done
-- here — database.types.ts is a generated artifact everywhere else in
-- this project's pasted source, and hand-patching just this one field
-- risks drifting from whatever the CLI would actually emit for enum
-- naming/shape.
--
-- TIMESTAMP FLAGGED — 20260729000000 is a placeholder continuing this
-- project's existing YYYYMMDDHHMMSS convention one day after the last
-- confirmed migration (20260728000000_add_webhook_actor_type.sql, prior
-- session). Adjust to match whatever your real migration tooling expects
-- if it differs from a simple next-day increment.
--
-- FIXED, ORDER — a first attempt at this migration ran the ALTER COLUMN
-- TYPE before dropping the CHECK constraint, and failed at apply time
-- with `operator does not exist: audit_log_actor_type = text
-- (SQLSTATE 42883)`. Root cause: Postgres re-validates every constraint
-- still attached to a column at the moment its type changes, and
-- audit_log_actor_type_check's own definition
-- (`actor_type = ANY (ARRAY['user'::text, ...])`) compares against
-- text — there is no `=` operator between the new enum type and text,
-- so the mid-statement re-validation fails. The constraint must be
-- dropped BEFORE the type change, not after, so nothing text-typed is
-- left comparing against the column while its type is in flux. Order
-- corrected below.

create type audit_log_actor_type as enum ('user', 'system', 'webhook');

alter table audit_log
  drop constraint audit_log_actor_type_check;

alter table audit_log
  alter column actor_type type audit_log_actor_type
  using actor_type::audit_log_actor_type;