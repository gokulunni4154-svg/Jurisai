-- ============================================================================
-- Migration: support_multi_firm_membership
-- ============================================================================
-- Phase 4 — Enterprise & Collaboration. Product decision this session: a
-- profile may OWN at most one firm, but may be a MEMBER (any FirmRole) of
-- several. This directly supersedes 20260726000002_create_firms_table.sql's
-- own assumption #3 ("Multi-firm membership... is NOT supported -- flagged
-- as out of scope, not silently assumed acceptable"). That file is not
-- edited (migrations are historical record, not live documentation) --
-- this migration is the flagged, explicit supersession instead.
--
-- No table shape changes. 20260802000001_create_firm_members_table.sql's
-- own `firm_members` table already supports multi-firm structurally: its
-- unique constraint is on (firm_id, profile_id), not (profile_id) alone,
-- so nothing there ever blocked a second membership row. What DID assume
-- single-firm were two RLS policies reading `profiles.firm_id` (a single
-- scalar column) as if it were the full membership record:
--
--   1. firms_select_member (on `firms`)
--   2. firm_members_select_same_firm (on `firm_members`)
--
-- Both are dropped and recreated here to check `firm_members` instead.
--
-- FLAGGED ASSUMPTIONS -- new decisions this file:
--   1. profiles.firm_id is NOT dropped or altered. It is repurposed at
--      the application layer (firm.service.ts, amended this session) into
--      a "primary/default firm" convenience pointer -- set on a profile's
--      FIRST firm join only, never overwritten by later joins. This
--      migration makes no schema change enforcing that meaning; it is an
--      application-level convention only, flagged here so the column's
--      new, narrower meaning is on record next to the RLS change that
--      necessitated it.
--   2. The self-referential subquery in the recreated
--      firm_members_select_same_firm policy (firm_members querying
--      firm_members) is safe, not recursive in a problematic sense: the
--      inner subquery's own visibility is governed by
--      firm_members_select_own (profile_id = auth.uid()), which is
--      unconditional on firm_id and therefore always resolves without
--      depending on the outer policy's result. Same reasoning any
--      self-join RLS pattern relies on; not a novel risk introduced here.
--   3. ProfileRepository#findByFirmId() (Observability module, existing)
--      still queries `profiles.firm_id` directly, unchanged by this
--      migration. Per assumption #1 above, that method now returns
--      profiles whose PRIMARY firm is the given firmId -- NOT the full
--      roster (that's FirmMemberRepository#findByFirmId(), unaffected by
--      this migration and already firm_members-based). Any consumer of
--      ProfileRepository#findByFirmId() that implicitly assumed "everyone
--      in this firm" may now undercount non-primary members. FLAGGED,
--      NOT FIXED this session per the project's own "flagged-but-not-
--      fixed until all modules have had their own pass" convention --
--      Observability's own pass has not yet happened.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- firms.firms_select_member: firm_id membership -> firm_members membership
-- ----------------------------------------------------------------------------
drop policy if exists firms_select_member on public.firms;

create policy firms_select_member
  on public.firms
  for select
  to authenticated
  using (
    id in (select firm_id from public.firm_members where profile_id = auth.uid())
  );

comment on policy firms_select_member on public.firms is
  'Multi-firm-safe: checks firm_members, not profiles.firm_id. Superseded pre-multi-firm version dropped by 20260804000000_support_multi_firm_membership.sql -- see that migration header, assumption #3 in the original firms migration.';

-- ----------------------------------------------------------------------------
-- firm_members.firm_members_select_same_firm: same fix, same table
-- ----------------------------------------------------------------------------
drop policy if exists firm_members_select_same_firm on public.firm_members;

create policy firm_members_select_same_firm
  on public.firm_members
  for select
  to authenticated
  using (
    firm_id in (select firm_id from public.firm_members where profile_id = auth.uid())
  );

comment on policy firm_members_select_same_firm on public.firm_members is
  'Multi-firm-safe: self-referential membership check via firm_members, not profiles.firm_id. See this migration''s header, assumption #2, for why the self-reference is safe.';