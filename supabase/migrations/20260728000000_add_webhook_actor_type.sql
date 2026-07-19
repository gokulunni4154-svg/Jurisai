-- ============================================================================
-- Migration: add_webhook_actor_type
-- ============================================================================
-- Extends audit_log.actor_type with a third value, 'webhook', distinct
-- from 'system'.
--
-- REASONING, per 20260727000000_create_audit_log.sql's own header:
-- actor_type exists specifically to disambiguate WHO/WHAT performed an
-- action "rather than inferring it... so the intent is explicit at read
-- time." 'system' was introduced for the hearing-reminder cron — code
-- in this app proactively initiating an action with no human behind it.
-- A webhook-driven event (e.g. Cashfree reporting a subscription status
-- change) is a different thing entirely: this app did not initiate
-- anything, it is passively recording a fact reported by an external
-- system after independently verifying that report's signature at the
-- route layer. Collapsing both under 'system' would make actor_type lie
-- about which of those two happened for every future webhook-sourced
-- event, defeating the column's own stated purpose. Kept as a single
-- additional enum-like value rather than a broader remodel, since this
-- is the only concrete instance of the distinction mattering today —
-- widen further only when a second real webhook integration exists to
-- confirm the same need.
--
-- Constraint name assumed as audit_log_actor_type_check — Postgres'
-- default auto-generated name for an unnamed column-level CHECK
-- constraint (`<table>_<column>_check`), matching the original
-- migration's inline, unnamed `check (actor_type in ('user', 'system'))`.
-- NOT independently confirmed against the live database's actual
-- constraint name (e.g. via \d audit_log or a real information_schema
-- query) — flagged rather than silently assumed correct. If this
-- migration fails with a "constraint does not exist" error, that's the
-- reason; the real name should be pulled from the live DB and this
-- migration corrected before retrying.
-- ============================================================================

alter table audit_log
  drop constraint if exists audit_log_actor_type_check;

alter table audit_log
  add constraint audit_log_actor_type_check
  check (actor_type in ('user', 'system', 'webhook'));