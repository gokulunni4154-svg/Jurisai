-- ============================================================================
-- Migration: add_actioned_at_to_ai_recommendations
-- ============================================================================
-- RECONSTRUCTED. This migration is already applied on the live Supabase
-- project ("Juris", ref vmmlhxdnhpfmesdmppbf) as version 20260812044308,
-- but no matching file existed in this git repository -- it was applied
-- directly against the database at some point and never committed.
--
-- This file was written by introspecting the live database (column
-- definition + its comment, both confirmed present) so the repository's
-- migration history matches what's actually running. It is NOT guaranteed
-- byte-identical to whatever the original, uncommitted file contained --
-- only the resulting schema state is guaranteed to match, which is what
-- `supabase db push`/`db pull` reconciliation actually needs.
--
-- DO NOT apply this file directly with `supabase db push` unless you have
-- first confirmed (via `supabase migration list` or the Dashboard) that
-- version 20260812044308 is NOT already marked applied on your target
-- project -- on a project where it's already live (as it is on "Juris"),
-- this file's only job is to exist on disk with the right version+name so
-- the CLI's remote/local comparison stops flagging it as missing.
-- ============================================================================

alter table public.ai_recommendations
  add column actioned_at timestamptz;

comment on column public.ai_recommendations.actioned_at is
  'Set when the document owner marks this completed recommendation as reviewed/actioned from the dashboard AI Actions feed. NULL means still outstanding. Independent of completed_at (run finished) and status (lifecycle) -- a completed run can sit unactioned indefinitely.';
