-- ============================================================================
-- Pre-acceptance inquiry review, step 1 of 2: add the 'declined' status.
--
-- Declining an inquiry used to delete the row (no audit trail). It is now a
-- soft decline, so the status enum needs a 'declined' value.
--
-- Kept in its OWN migration on purpose: a value added with ALTER TYPE ... ADD
-- VALUE cannot be referenced (CHECK constraints, partial indexes, DML) in the
-- same transaction that added it. The next migration
-- (20261017000001_pre_acceptance_inquiry_review.sql) uses it.
-- ============================================================================

alter type public.lawyer_inquiry_status add value if not exists 'declined';
