-- ============================================================================
-- Pre-acceptance document review for Contact-a-Lawyer inquiries, step 2 of 2.
--
-- FORWARD-ONLY. NOT applied to production by the author. Test on a local
-- Supabase stack / scratch Postgres first (see
-- supabase/tests/lawyer_inquiry_pre_acceptance_review.test.sql).
--
-- WHAT THIS ADDS
--   1. lawyer_inquiries: decision audit columns (decision, decided_by,
--      decided_at, decision_note) and review_expires_at (7-day window).
--   2. lawyer_inquiry_documents: the exact document(s) and AI report attached
--      to an inquiry. Before this, an inquiry only held one storage path and a
--      jsonb snapshot, with no document id and no report id.
--   3. lawyer_inquiry_reviews: one row per reviewer per inquiry, created on the
--      first authorized open. Ends (revoked_at) when the inquiry is decided.
--   4. accept_lawyer_inquiry(): ONE transaction that locks the inquiry, creates
--      (or returns) the case, links the inquiry's documents, issues the case
--      access grant, ends review access and writes audit rows.
--   5. decline_lawyer_inquiry(): soft decline with reviewer + timestamp, ends
--      review access, creates no case and no grant.
--   6. open_lawyer_inquiry_review(): the single authorization decision for
--      pre-acceptance preview/download.
--   7. Column-level SELECT hardening so analysis_result / document_storage_path
--      cannot be read straight through PostgREST.
--
-- AUTHORIZATION MODEL (mirrors the existing service rules, not a new one)
--   * Inquiry targeted at a lawyer (target_profile_id set): only that lawyer
--     may review, accept or decline. Unchanged from LawyerInquiryService.
--   * Firm-routed inquiry (target_profile_id null): firm owner/admin of
--     target_firm_id may review, accept-and-assign, or decline.
--   * No other firm member (employee, lawyer) and no other firm.
--   The functions are SECURITY DEFINER and executable by service_role only;
--   the service layer still authorizes first, the functions re-check.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. lawyer_inquiries: decision audit + review window
-- ----------------------------------------------------------------------------
alter table public.lawyer_inquiries
  add column if not exists decision text,
  add column if not exists decided_by uuid references auth.users (id) on delete set null,
  add column if not exists decided_at timestamptz,
  add column if not exists decision_note text,
  add column if not exists review_expires_at timestamptz not null default (now() + interval '7 days');

-- Existing rows: pending ones get a fresh 7-day window from migration time;
-- every other row keeps a window anchored at its own creation (informational).
update public.lawyer_inquiries
   set review_expires_at = created_at + interval '7 days'
 where status <> 'pending';

-- Existing accepted / converted rows were accepted by their target lawyer.
update public.lawyer_inquiries
   set decision = 'accepted',
       decided_by = target_profile_id,
       decided_at = updated_at
 where status in ('accepted', 'converted_to_case')
   and decision is null;

alter table public.lawyer_inquiries
  add constraint lawyer_inquiries_decision_note_len
    check (decision_note is null or char_length(decision_note) <= 1000),
  add constraint lawyer_inquiries_decision_consistent check (
    (status = 'pending'  and decision is null and decided_at is null)
    or (status = 'declined' and decision = 'declined' and decided_at is not null and case_id is null)
    or (status in ('accepted', 'converted_to_case') and decision = 'accepted' and decided_at is not null)
  );

comment on column public.lawyer_inquiries.review_expires_at is
  'End of the pre-acceptance review window (created_at + 7 days). Preview/download is refused after this instant. Accepting after expiry is refused; declining is still allowed.';
comment on column public.lawyer_inquiries.decision is
  'accepted | declined. Null while pending. status = declined is terminal; an accepted inquiry carries its case_id.';

-- ----------------------------------------------------------------------------
-- 2. lawyer_inquiry_documents: the exact documents + reports behind an inquiry
-- ----------------------------------------------------------------------------
create table public.lawyer_inquiry_documents (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.lawyer_inquiries (id) on delete cascade,

  -- Null for an anonymous-origin upload (anon/{token}/... has no documents row).
  document_id uuid references public.documents (id) on delete set null,
  storage_path text not null,
  file_name text not null,

  -- The document_analyses row the report came from (null for anonymous-origin).
  analysis_id uuid references public.document_analyses (id) on delete set null,
  analysis_state text not null
    constraint lawyer_inquiry_documents_state_check
    check (analysis_state in ('complete', 'processing', 'unavailable')),
  -- Frozen at send time. Never regenerated, never re-associated.
  analysis_snapshot jsonb,

  created_at timestamptz not null default now(),

  constraint lawyer_inquiry_documents_complete_has_report
    check (analysis_state <> 'complete' or analysis_snapshot is not null),
  constraint lawyer_inquiry_documents_unique_path unique (inquiry_id, storage_path)
);

create index lawyer_inquiry_documents_inquiry_id_idx on public.lawyer_inquiry_documents (inquiry_id);
create index lawyer_inquiry_documents_document_id_idx on public.lawyer_inquiry_documents (document_id);

-- Backfill: one row per existing inquiry, from the columns it already holds.
insert into public.lawyer_inquiry_documents
  (inquiry_id, document_id, storage_path, file_name, analysis_state, analysis_snapshot)
select li.id,
       (select d.id from public.documents d
         where d.storage_path = li.document_storage_path
           and d.owner_id = li.client_profile_id
         limit 1),
       li.document_storage_path,
       coalesce(nullif(regexp_replace(li.document_storage_path, '^.*/', ''), ''), 'document'),
       'complete',
       li.analysis_result
  from public.lawyer_inquiries li
on conflict do nothing;

alter table public.lawyer_inquiry_documents enable row level security;

-- Reviewers have NO policy here on purpose: their access is decided by
-- open_lawyer_inquiry_review() and served by the server (admin client). The
-- sender may read the rows of their own inquiry.
create policy lawyer_inquiry_documents_select_client
  on public.lawyer_inquiry_documents for select
  to authenticated
  using (
    exists (
      select 1 from public.lawyer_inquiries li
      where li.id = lawyer_inquiry_documents.inquiry_id
        and li.client_profile_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 3. lawyer_inquiry_reviews: who may preview, and until when
-- ----------------------------------------------------------------------------
create table public.lawyer_inquiry_reviews (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.lawyer_inquiries (id) on delete cascade,
  reviewer_id uuid not null references auth.users (id) on delete cascade,
  firm_id uuid not null references public.firms (id) on delete cascade,
  reviewer_capacity text not null
    constraint lawyer_inquiry_reviews_capacity_check
    check (reviewer_capacity in ('assigned_lawyer', 'firm_reviewer')),
  granted_at timestamptz not null default now(),
  -- Always the inquiry's own review_expires_at: re-opening never extends it.
  expires_at timestamptz not null,
  revoked_at timestamptz,
  ended_reason text
    constraint lawyer_inquiry_reviews_reason_check
    check (ended_reason in ('accepted', 'declined', 'revoked')),
  constraint lawyer_inquiry_reviews_revoked_pair
    check ((revoked_at is null) = (ended_reason is null))
);

create unique index lawyer_inquiry_reviews_active_unique
  on public.lawyer_inquiry_reviews (inquiry_id, reviewer_id)
  where revoked_at is null;
create index lawyer_inquiry_reviews_reviewer_idx on public.lawyer_inquiry_reviews (reviewer_id);

alter table public.lawyer_inquiry_reviews enable row level security;
-- Deliberately no policies: server-only (admin client), fail-closed for every
-- client role, same posture as anonymous_analysis_sessions.

-- ----------------------------------------------------------------------------
-- 4. Authorization helper
-- ----------------------------------------------------------------------------
create or replace function public.lawyer_inquiry_reviewer_capacity(
  p_target_profile_id uuid,
  p_firm_id uuid,
  p_profile_id uuid
)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when p_profile_id is null then null
    when p_target_profile_id is not null then
      case when p_target_profile_id = p_profile_id then 'assigned_lawyer' end
    when exists (
      select 1 from public.firm_members fm
      where fm.firm_id = p_firm_id
        and fm.profile_id = p_profile_id
        and fm.role in ('owner', 'admin')
    ) then 'firm_reviewer'
  end
$$;

-- ----------------------------------------------------------------------------
-- 5. open_lawyer_inquiry_review: the one pre-acceptance access decision
-- ----------------------------------------------------------------------------
create or replace function public.open_lawyer_inquiry_review(
  p_inquiry_id uuid,
  p_reviewer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inq public.lawyer_inquiries%rowtype;
  v_capacity text;
  v_review public.lawyer_inquiry_reviews%rowtype;
begin
  select * into v_inq from public.lawyer_inquiries where id = p_inquiry_id;
  if not found then
    raise exception 'inquiry_not_found' using errcode = 'P0002';
  end if;

  v_capacity := public.lawyer_inquiry_reviewer_capacity(v_inq.target_profile_id, v_inq.target_firm_id, p_reviewer_id);
  if v_capacity is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_inq.status <> 'pending' then
    raise exception 'review_not_available' using errcode = '55000';
  end if;

  if v_inq.review_expires_at <= now() then
    raise exception 'review_window_expired' using errcode = '55000';
  end if;

  select * into v_review
    from public.lawyer_inquiry_reviews
   where inquiry_id = p_inquiry_id and reviewer_id = p_reviewer_id
   order by granted_at desc
   limit 1;

  if found then
    if v_review.revoked_at is not null then
      raise exception 'review_access_revoked' using errcode = '55000';
    end if;
    if v_review.expires_at <= now() then
      raise exception 'review_window_expired' using errcode = '55000';
    end if;
  else
    insert into public.lawyer_inquiry_reviews
      (inquiry_id, reviewer_id, firm_id, reviewer_capacity, expires_at)
    values
      (p_inquiry_id, p_reviewer_id, v_inq.target_firm_id, v_capacity, v_inq.review_expires_at)
    returning * into v_review;
  end if;

  return jsonb_build_object(
    'review_id', v_review.id,
    'inquiry_id', p_inquiry_id,
    'capacity', v_review.reviewer_capacity,
    'expires_at', v_review.expires_at
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. accept_lawyer_inquiry: atomic accept + case + documents + grant + audit
-- ----------------------------------------------------------------------------
-- Idempotent: a repeat call by whoever decided (or the assigned lawyer)
-- returns the existing case and writes nothing. Concurrent calls serialize on
-- the row lock, so exactly one creates the case.
--
-- Case-creation authority mirrors CaseService#requireCaseCreateAccess: team
-- lead of the team, firm owner/admin, or (no team) any firm member.
--
-- The case OWNER is the assigned lawyer. The assignee also receives a 'read'
-- grant, because documents_select_via_case_grant keys on grants, not
-- ownership: without it the owner could not open the client's document.
-- 'read' (not read_write) so the lawyer cannot rewrite the client's document
-- rows. Firm owners/admins already see case documents through
-- is_firm_case_manager(); nothing extra is granted to them or to other members.
--
-- Documents are linked only when the client owns them (a forged document_id on
-- an inquiry document row cannot pull in someone else's file). Anonymous-
-- origin files have no documents row and cannot be linked; they stay readable
-- through the server's inquiry-document endpoint while the caller holds an
-- active grant on the resulting case.
create or replace function public.accept_lawyer_inquiry(
  p_inquiry_id uuid,
  p_actor_id uuid,
  p_assignee_id uuid,
  p_team_id uuid,
  p_title text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inq public.lawyer_inquiries%rowtype;
  v_capacity text;
  v_replay boolean;
  v_assignee uuid;
  v_assignee_role text;
  v_actor_role text;
  v_team uuid;
  v_is_lead boolean := false;
  v_title text := btrim(coalesce(p_title, ''));
  v_case_id uuid;
  v_grant_id uuid;
  v_total int;
  v_linked int;
begin
  select * into v_inq from public.lawyer_inquiries where id = p_inquiry_id for update;
  if not found then
    raise exception 'inquiry_not_found' using errcode = 'P0002';
  end if;

  v_replay := coalesce(
    v_inq.decision = 'accepted'
    and p_actor_id is not null
    and p_actor_id in (v_inq.decided_by, v_inq.target_profile_id),
    false);

  if not v_replay then
    v_capacity := public.lawyer_inquiry_reviewer_capacity(v_inq.target_profile_id, v_inq.target_firm_id, p_actor_id);
    if v_capacity is null then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
  end if;

  if v_inq.status = 'declined' then
    raise exception 'inquiry_declined' using errcode = '55000';
  end if;

  if v_inq.decision = 'accepted' and v_inq.case_id is not null then
    return jsonb_build_object(
      'inquiry_id', v_inq.id,
      'case_id', v_inq.case_id,
      'already_accepted', true,
      'assignee_id', v_inq.target_profile_id,
      'linked_documents', 0,
      'unlinked_documents', 0);
  end if;

  if v_inq.status = 'pending' and v_inq.review_expires_at <= now() then
    raise exception 'review_window_expired' using errcode = '55000';
  end if;

  -- Assignee ----------------------------------------------------------------
  if v_inq.target_profile_id is not null then
    if p_assignee_id is not null and p_assignee_id <> v_inq.target_profile_id then
      raise exception 'assignee_not_permitted' using errcode = '22023';
    end if;
    v_assignee := v_inq.target_profile_id;
  else
    if p_assignee_id is null then
      raise exception 'assignee_required' using errcode = '22023';
    end if;
    v_assignee := p_assignee_id;
  end if;

  select fm.role into v_assignee_role
    from public.firm_members fm
   where fm.firm_id = v_inq.target_firm_id and fm.profile_id = v_assignee
   limit 1;
  if v_assignee_role is null then
    raise exception 'assignee_not_firm_member' using errcode = '22023';
  end if;
  if v_inq.target_profile_id is null and v_assignee_role = 'employee' then
    raise exception 'assignee_not_lawyer' using errcode = '22023';
  end if;

  -- Team ----------------------------------------------------------------------
  v_team := coalesce(p_team_id, v_inq.team_id);
  if v_team is not null then
    if not exists (select 1 from public.teams t where t.id = v_team and t.firm_id = v_inq.target_firm_id) then
      raise exception 'team_not_in_firm' using errcode = '22023';
    end if;
    select exists (
      select 1 from public.team_members tm
       where tm.team_id = v_team and tm.profile_id = p_actor_id and tm.role = 'lead'
    ) into v_is_lead;
  end if;

  -- Case-creation authority (mirrors CaseService#requireCaseCreateAccess) ----
  select fm.role into v_actor_role
    from public.firm_members fm
   where fm.firm_id = v_inq.target_firm_id and fm.profile_id = p_actor_id
   limit 1;
  if not (
    v_is_lead
    or v_actor_role in ('owner', 'admin')
    or (v_team is null and v_actor_role is not null)
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if char_length(v_title) not between 1 and 255 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;

  -- Case + documents + grant --------------------------------------------------
  insert into public.cases (firm_id, team_id, owner_id, title)
  values (v_inq.target_firm_id, v_team, v_assignee, v_title)
  returning id into v_case_id;

  select count(*) into v_total
    from public.lawyer_inquiry_documents where inquiry_id = p_inquiry_id;

  with ins as (
    insert into public.case_documents (case_id, document_id)
    select v_case_id, lid.document_id
      from public.lawyer_inquiry_documents lid
      join public.documents d
        on d.id = lid.document_id and d.owner_id = v_inq.client_profile_id
     where lid.inquiry_id = p_inquiry_id
    on conflict do nothing
    returning 1
  )
  select count(*) into v_linked from ins;

  insert into public.case_access_grants (case_id, grantee_id, granted_by, access_level)
  values (v_case_id, v_assignee, p_actor_id, 'read')
  on conflict (case_id, grantee_id) where revoked_at is null do nothing
  returning id into v_grant_id;

  -- Inquiry ---------------------------------------------------------------------
  update public.lawyer_inquiries
     set status = 'accepted',
         decision = 'accepted',
         decided_by = coalesce(v_inq.decided_by, p_actor_id),
         decided_at = coalesce(v_inq.decided_at, now()),
         target_profile_id = v_assignee,
         assigned_by = case when v_inq.target_profile_id is null then p_actor_id else v_inq.assigned_by end,
         assigned_at = case when v_inq.target_profile_id is null then now() else v_inq.assigned_at end,
         team_id = v_team,
         case_id = v_case_id
   where id = p_inquiry_id;

  -- Pre-acceptance access ends; ongoing access is the case grant above.
  update public.lawyer_inquiry_reviews
     set revoked_at = now(), ended_reason = 'accepted'
   where inquiry_id = p_inquiry_id and revoked_at is null;

  -- Audit -----------------------------------------------------------------------
  insert into public.audit_log (actor_type, actor_id, firm_id, case_id, action, resource_type, resource_id, metadata)
  values
    ('user', p_actor_id, v_inq.target_firm_id, v_case_id, 'lawyer_inquiry.accept', 'lawyer_inquiry', v_inq.id,
     jsonb_build_object('assigneeId', v_assignee, 'teamId', v_team, 'capacity', v_capacity,
                        'linkedDocuments', v_linked, 'totalDocuments', v_total)),
    ('user', p_actor_id, v_inq.target_firm_id, v_case_id, 'case.create', 'case', v_case_id,
     jsonb_build_object('title', v_title, 'teamId', v_team, 'source', 'lawyer_inquiry', 'inquiryId', v_inq.id));

  if v_grant_id is not null then
    insert into public.audit_log (actor_type, actor_id, firm_id, case_id, action, resource_type, resource_id, metadata)
    values ('user', p_actor_id, v_inq.target_firm_id, v_case_id, 'case.access_grant.issue', 'case_access_grant', v_grant_id,
            jsonb_build_object('granteeId', v_assignee, 'accessLevel', 'read', 'source', 'lawyer_inquiry'));
  end if;

  return jsonb_build_object(
    'inquiry_id', v_inq.id,
    'case_id', v_case_id,
    'already_accepted', false,
    'assignee_id', v_assignee,
    'linked_documents', v_linked,
    'unlinked_documents', v_total - v_linked);
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. decline_lawyer_inquiry: soft decline, no case, no grant
-- ----------------------------------------------------------------------------
create or replace function public.decline_lawyer_inquiry(
  p_inquiry_id uuid,
  p_actor_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inq public.lawyer_inquiries%rowtype;
  v_capacity text;
  v_replay boolean;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_inq from public.lawyer_inquiries where id = p_inquiry_id for update;
  if not found then
    raise exception 'inquiry_not_found' using errcode = 'P0002';
  end if;

  v_replay := coalesce(v_inq.decision = 'declined' and p_actor_id = v_inq.decided_by, false);
  if not v_replay then
    v_capacity := public.lawyer_inquiry_reviewer_capacity(v_inq.target_profile_id, v_inq.target_firm_id, p_actor_id);
    if v_capacity is null then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
  end if;

  if v_inq.status = 'declined' then
    return jsonb_build_object('inquiry_id', v_inq.id, 'already_declined', true);
  end if;

  if v_inq.decision = 'accepted' then
    raise exception 'inquiry_already_accepted' using errcode = '55000';
  end if;

  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'invalid_note' using errcode = '22023';
  end if;

  update public.lawyer_inquiries
     set status = 'declined',
         decision = 'declined',
         decided_by = p_actor_id,
         decided_at = now(),
         decision_note = v_note
   where id = p_inquiry_id;

  update public.lawyer_inquiry_reviews
     set revoked_at = now(), ended_reason = 'declined'
   where inquiry_id = p_inquiry_id and revoked_at is null;

  insert into public.audit_log (actor_type, actor_id, firm_id, action, resource_type, resource_id, metadata)
  values ('user', p_actor_id, v_inq.target_firm_id, 'lawyer_inquiry.decline', 'lawyer_inquiry', v_inq.id,
          jsonb_build_object('capacity', v_capacity, 'hasNote', v_note is not null));

  return jsonb_build_object('inquiry_id', v_inq.id, 'already_declined', false);
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Privileges
-- ----------------------------------------------------------------------------
-- The functions take the actor id as a parameter, so they must never be
-- callable with a user's own session: service_role only.
revoke all on function public.lawyer_inquiry_reviewer_capacity(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.open_lawyer_inquiry_review(uuid, uuid) from public, anon, authenticated;
revoke all on function public.accept_lawyer_inquiry(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.decline_lawyer_inquiry(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.lawyer_inquiry_reviewer_capacity(uuid, uuid, uuid) to service_role;
grant execute on function public.open_lawyer_inquiry_review(uuid, uuid) to service_role;
grant execute on function public.accept_lawyer_inquiry(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.decline_lawyer_inquiry(uuid, uuid, text) to service_role;

revoke all on table public.lawyer_inquiry_reviews from anon, authenticated;
revoke all on table public.lawyer_inquiry_documents from anon, authenticated;
grant select on table public.lawyer_inquiry_documents to authenticated;

-- ----------------------------------------------------------------------------
-- 9. Column-level hardening of lawyer_inquiries (TIGHTENS, never widens)
-- ----------------------------------------------------------------------------
-- The existing row-level SELECT policies let the target lawyer and firm
-- owners/admins read the whole row through PostgREST, including the report
-- snapshot and the storage path, at any time and after a decline, bypassing
-- the review window. RLS cannot hide columns, so the two sensitive columns are
-- removed from the authenticated role's column grants (decision_note, the
-- reviewer's private note, is withheld too). Every app read goes
-- through the admin client, so no application path changes; a direct
-- `select=*` from a user session now fails instead of leaking.
revoke select on table public.lawyer_inquiries from anon, authenticated;
grant select (
  id, client_profile_id, target_profile_id, target_firm_id, assigned_by, assigned_at,
  status, case_id, created_at, updated_at, team_id,
  decision, decided_by, decided_at, review_expires_at
) on table public.lawyer_inquiries to authenticated;
