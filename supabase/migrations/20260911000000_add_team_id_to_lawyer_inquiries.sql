-- ============================================================================
-- Adds team_id to lawyer_inquiries.
--
-- Closes the gap flagged since lawyer-inquiry.service.ts's convertInquiry()
-- was first built: teamId was always hardcoded null when calling
-- CaseService#createCase(), because lawyer_inquiries had no column to
-- source a real team from -- meaning CaseService#requireCaseCreateAccess()'s
-- team-lead authorization path was permanently unreachable through
-- convertInquiry(), even though the confirmed product decision (scoping
-- doc §4.5) names "team head or firm admin" as the rule.
--
-- Set explicitly via assignInquiry() (§4.1) -- caller-supplied, same
-- "the caller decides, nothing is inferred" posture CaseService#createCase()
-- already establishes for its own teamId param. NOT auto-derived from the
-- assigned lawyer's team membership -- a lawyer may belong to multiple
-- teams or none, and no precedent in this project infers a team
-- assignment from membership alone.
--
-- FLAGGED, UNCONFIRMED: references public.teams(id) -- the real teams
-- table migration was never independently pasted this session; the table
-- name is inferred from TeamMemberRepository/case.factory.ts's real,
-- confirmed usage elsewhere. If the real table name or PK differs, only
-- this FK needs correcting, not the column's shape or nullability.
--
-- Nullable, `on delete set null` -- same posture as assigned_by and
-- target_profile_id above it in the original migration: a solo-firm
-- inquiry (no team involved) is a normal, valid state, and a team being
-- deleted later should not cascade-delete inquiry history tied to it.
-- ============================================================================

alter table public.lawyer_inquiries
  add column team_id uuid references public.teams (id) on delete set null;

create index lawyer_inquiries_team_id_idx on public.lawyer_inquiries (team_id);

comment on column public.lawyer_inquiries.team_id is
  'Caller-supplied at assignment time (assignInquiry, §4.1) -- never inferred from the assigned lawyer''s own team membership. Null for a solo-firm or no-team inquiry. Sourced into CaseService#createCase()''s teamId param at conversion time, closing the previously-permanent gap that made the team-lead conversion path unreachable.';