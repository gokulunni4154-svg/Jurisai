-- Migration: add audit_log.case_id
--
-- BUILT FOR: Case Timeline / Activity History (Phase 4, new unscoped
-- sub-feature). REAL, CONFIRMED GAP this migration closes: audit_log
-- has no case_id column -- only resource_type/resource_id (one generic
-- resource per row) and firm_id. There is no way to query "everything
-- that happened on case X" without this column; a case's own id only
-- ever appears inside a grant event's `metadata` jsonb blob today, which
-- findByFilter() (audit-log.repository.ts) cannot filter on.
--
-- PATTERN, DELIBERATELY MATCHED -- this follows firm_id's own existing
-- shape on this table exactly (20260727000000_create_audit_log.sql):
-- nullable, captured OPPORTUNISTICALLY when the action occurred within a
-- case context, references cases(id) on delete set null (an audit
-- record should survive its case being deleted, same reasoning firm_id's
-- own header gives), and gets its own partial index (only indexed where
-- not null, same as idx_audit_log_firm_id).
--
-- NOT USED FOR ACCESS CONTROL, same explicit carve-out firm_id's own
-- column comment states -- CaseTimelineService (new module, this
-- session) does its own authorization via CaseRepository/
-- CaseAccessGrantRepository (case owner or active grantee), not by
-- trusting this column's presence/absence.
--
-- TIMESTAMP FLAGGED -- 20260801000000 is a placeholder continuing this
-- project's YYYYMMDDHHMMSS convention after the last confirmed
-- migration in this thread (20260729000000_convert_audit_log_actor_type_enum.sql).
-- Adjust to match whatever your real migration tooling expects if it
-- differs.
--
-- REQUIRED FOLLOW-UP, NOT DONE BY THIS FILE, SAME AS THE ACTOR_TYPE
-- ENUM MIGRATION'S OWN PRECEDENT: database.types.ts must be regenerated
-- (e.g. via the Supabase CLI's real type-generation command against the
-- live schema) after this migration is applied, so audit_log.Row/
-- Insert/Update picks up the new nullable case_id: string | null field.
-- Hand-editing that generated file was deliberately not done here, same
-- reasoning as that prior migration's own follow-up note -- it is a
-- generated artifact everywhere else in this project's pasted source.

alter table audit_log
  add column if not exists case_id uuid references cases(id) on delete set null;

create index if not exists idx_audit_log_case_id
  on audit_log (case_id)
  where case_id is not null;