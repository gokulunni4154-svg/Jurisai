-- 20260811000001_add_role_to_team_members.sql
--
-- TIMESTAMP CONFIRMED — sequenced directly after the real latest
-- migration in the repo, 20260811000000_widen_notifications_for_lawyer_
-- inquiries.sql (confirmed this session). Previous revision used a
-- provisional/fictional timestamp (20260808000001) not checked against
-- real repo state — corrected here. This is now Open Item #67, closed.
--
-- Reopens CASE_ACCESS_GRANTS_SCOPING.md §4.4 / team-member.service.ts's
-- decision #4 ("no team-level role... moot without roles") — a real
-- reversal on an already-shipped table, not a clean addition.
--
-- text + named CHECK constraint, NOT a Postgres enum — matching the
-- corrected convention already applied to case_status/case_access_level
-- this session (firm_members.role / firm_invitations.status /
-- team_invitations.status are the real precedent for this shape).
--
-- Multiple leads per team allowed — no uniqueness constraint on
-- role = 'lead'. No last-lead protection is enforced here or at the
-- service layer; a team may validly reach zero leads for v1 (see
-- team-member.service.ts's changeRole() doc comment).

alter table public.team_members
  add column role text not null default 'member'
  constraint team_members_role_check check (role in ('member', 'lead'));