-- ============================================================================
-- Migration: widen_hearings_select_for_firm_managers
-- ============================================================================
-- Lawyer Terminal, Task 3 — Hearings & Calendar.
--
-- GENUINE RLS GAP FOUND DURING INSPECTION, documented per this task's own
-- Step 6/20 requirement before touching anything:
--
--   CURRENT BEHAVIOR: 20260813043503_add_firm_manager_case_visibility.sql
--   already widened `cases_select` so a firm's own owner/admin can see
--   every case belonging to their firm, via the SECURITY DEFINER helper
--   `is_firm_case_manager(firm_id)` — not just cases they own or hold an
--   explicit case_access_grants row for. `hearings_select`
--   (20260904000000_create_hearings_table.sql) was never given the
--   equivalent widening: it only allows a caller who is the case's
--   owner_id, or an active case_access_grants grantee (any level) on that
--   case. A firm owner/admin therefore can already open a case they don't
--   own via /cases/[id] (cases_select lets them), but every hearing on
--   that same case is invisible to them, on the Calendar or anywhere else
--   — RLS filters those rows out silently before HearingService ever sees
--   them. This is exactly the "firm admin can see the case but not its
--   hearings" scenario this task's Step 6 asked to check for by name.
--
--   DESIRED BEHAVIOR: a firm owner/admin should see every hearing
--   belonging to any case in their own firm on the Hearings & Calendar
--   page, consistent with the case-level visibility they already have —
--   otherwise the Calendar's firm-wide value for exactly the role that
--   most needs a full firm docket (an owner/admin, not a line lawyer
--   scoped to their own assigned cases) is broken relative to every other
--   part of the product they can already reach.
--
--   EXACT RLS CHANGE: add `or public.is_firm_case_manager(hearings.firm_id)`
--   to `hearings_select`'s USING clause, identical additional branch to
--   the one `cases_select` already carries, using the same existing
--   SECURITY DEFINER helper (no new function). `hearings.firm_id` is used
--   directly (denormalized column already on the table, see
--   20260904000000_create_hearings_table.sql's own header) rather than
--   joining back through `cases` — no schema change, no join, same
--   SECURITY DEFINER / no-recursion posture the helper was built for.
--
--   SECURITY IMPLICATIONS: SELECT-only. `hearings_insert` / `hearings_update`
--   / `hearings_delete` are deliberately left untouched — a firm
--   owner/admin gains read visibility into every hearing on their firm's
--   cases, but creating/editing/deleting a hearing still requires being
--   the case owner or holding an active read_write case_access_grants
--   grant on that specific case, exactly as before. This mirrors the
--   task's own guidance ("Never weaken authorization simply to make
--   create/edit buttons work") and matches the fact that Step 6 named
--   this as a visibility question, not a mutation question. No other
--   table, policy, or column is touched. A personal (non-firm) lawyer is
--   entirely unaffected: is_firm_case_manager() requires a firm_members
--   row for that firm, which a personal-organization case has none of in
--   the relevant sense for another user's session, so nothing here widens
--   personal-lawyer visibility.
-- ============================================================================

drop policy if exists hearings_select on public.hearings;

create policy hearings_select
  on public.hearings
  for select
  to authenticated
  using (
    exists (
      select 1 from public.cases c
      where c.id = hearings.case_id
        and (
          c.owner_id = auth.uid()
          or exists (
            select 1 from public.case_access_grants g
            where g.case_id = c.id
              and g.grantee_id = auth.uid()
              and g.revoked_at is null
          )
        )
    )
    or public.is_firm_case_manager(hearings.firm_id)
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );
