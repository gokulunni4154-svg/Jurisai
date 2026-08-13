-- ============================================================================
-- Migration: add_client_and_case_number_to_cases
-- ============================================================================
-- RECONSTRUCTED -- see 20260812044308_add_actioned_at_to_ai_recommendations.sql's
-- header for the full explanation of why this file exists as a
-- reconstruction rather than the original: this is already applied on the
-- live Supabase project as version 20260812052005, with no matching file
-- previously in this repository. Written from live introspection (column
-- definitions, their comments, the FK and CHECK constraints, confirmed via
-- pg_constraint) -- resulting schema state matches live exactly; original
-- file text is not guaranteed identical.
--
-- DO NOT apply this file directly with `supabase db push` unless you have
-- first confirmed version 20260812052005 is NOT already applied on your
-- target project.
-- ============================================================================

alter table public.cases
  add column client_id uuid references public.clients (id) on delete set null;

comment on column public.cases.client_id is
  'Optional link to the firm-scoped client this case is for. Null for cases with no client on file yet (e.g. pre-onboarding). Not FK-checked against cases.firm_id = clients.firm_id -- service-layer concern.';

alter table public.cases
  add column case_number text
    constraint cases_case_number_length check (
      case_number is null or char_length(case_number) <= 100
    );

comment on column public.cases.case_number is
  'Free-text filing/case number as used by the court (e.g. "CS (COMM) 123/2023", "WP(C) 2456/2024"). Not structured/validated beyond length -- formats vary too widely across case types and courts.';
