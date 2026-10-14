-- ============================================================================
-- Migration: fix_rls_cross_firm_isolation   (P2-03)
-- ============================================================================
-- FORWARD-ONLY. Does not edit any historical migration. Idempotent: every
-- object is create-or-replace / drop-if-exists + create, so it can be re-run.
--
-- WHY THIS FILE ALSO RE-ASSERTS SOME EXISTING POLICIES (section 2):
-- replaying the repository's migrations from scratch does NOT reproduce the
-- live schema. 20260813043503 calls has_case_grant(uuid) before
-- 20260912000000 creates it, so on a fresh database 20260813043503,
-- 20260818071705, 20260910000001 and 20260914000000 all fail, and
-- is_firm_case_manager() never exists. Re-asserting the intended final
-- definition of those policies here makes the end state deterministic on both
-- the live database and a fresh one. The definitions are copied verbatim from
-- those migrations; nothing is widened.
--
-- THREAT MODEL: a signed-in user holds the public anon key and a valid JWT, so
-- they can call PostgREST directly and skip the Next.js service layer. RLS and
-- these triggers are therefore the real tenant boundary, not a backstop.
--
-- Triggers that guard end-user writes return early when auth.uid() is NULL,
-- which is the trusted service-role path (admin client). The service layer
-- remains responsible for authorizing those writes. The two exceptions are
-- case_access_grants and the hearing/task firm-consistency checks, which are
-- enforced for every caller because the service layer is their only writer.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SECURITY DEFINER helpers (explicit search_path, auth.uid() only)
-- ----------------------------------------------------------------------------
create or replace function public.is_firm_case_manager(p_firm_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.firm_members fm
    where fm.firm_id = p_firm_id
      and fm.profile_id = auth.uid()
      and fm.role in ('owner', 'admin')
  );
$$;

-- Verified membership of the CALLER in a firm (firm_members, never
-- profiles.firm_id).
create or replace function public.is_firm_member(p_firm_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.firm_members fm
    where fm.firm_id = p_firm_id
      and fm.profile_id = auth.uid()
  );
$$;

-- Caller may write to the case: owner or active read_write grantee.
create or replace function public.is_case_writer(p_case_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.cases c
    where c.id = p_case_id
      and (
        c.owner_id = auth.uid()
        or exists (
          select 1 from public.case_access_grants g
          where g.case_id = c.id
            and g.grantee_id = auth.uid()
            and g.revoked_at is null
            and g.access_level = 'read_write'
        )
      )
  );
$$;

-- Caller owns the document. Bypasses documents RLS on purpose so the answer
-- does not depend on which SELECT policies happen to be stacked on documents.
create or replace function public.is_document_owner(p_document_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_document_id
      and d.owner_id = auth.uid()
  );
$$;

-- Least privilege: only signed-in users (and the service role) may execute
-- the helpers. They only ever answer questions about auth.uid(), so an
-- arbitrary p_* id cannot be used to probe someone else's access.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.is_case_owner(uuid)',
    'public.has_case_grant(uuid, boolean)',
    'public.is_firm_case_manager(uuid)',
    'public.is_case_client(uuid)',
    'public.is_firm_member(uuid)',
    'public.is_case_writer(uuid)',
    'public.is_document_owner(uuid)'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public, anon', fn);
      execute format('grant execute on function %s to authenticated, service_role', fn);
    end if;
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. Re-assert effective SELECT policies (verbatim from earlier migrations)
-- ----------------------------------------------------------------------------
drop policy if exists cases_select on public.cases;
create policy cases_select
  on public.cases
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    or public.has_case_grant(id)
    or public.is_firm_case_manager(firm_id)
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

drop policy if exists case_documents_select on public.case_documents;
create policy case_documents_select
  on public.case_documents
  for select
  to authenticated
  using (
    exists (
      select 1 from public.cases c
      where c.id = case_documents.case_id
        and (
          c.owner_id = auth.uid()
          or exists (
            select 1 from public.case_access_grants g
            where g.case_id = c.id
              and g.grantee_id = auth.uid()
              and g.revoked_at is null
          )
          or public.is_firm_case_manager(c.firm_id)
        )
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

drop policy if exists documents_select_via_firm_manager on public.documents;
create policy documents_select_via_firm_manager
  on public.documents
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.case_documents cd
      join public.cases c on c.id = cd.case_id
      where cd.document_id = documents.id
        and public.is_firm_case_manager(c.firm_id)
    )
  );

drop policy if exists tasks_select on public.tasks;
create policy tasks_select
  on public.tasks
  for select
  to authenticated
  using (
    assignee_profile_id = auth.uid()
    or (
      case_id is not null
      and exists (
        select 1 from public.cases c
        where c.id = tasks.case_id
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
    )
    or (
      case_id is null
      and exists (
        select 1 from public.firm_members fm
        where fm.firm_id = tasks.firm_id
          and fm.profile_id = auth.uid()
      )
    )
    or public.is_firm_case_manager(firm_id)
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

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

drop policy if exists case_notes_select on public.case_notes;
create policy case_notes_select
  on public.case_notes
  for select
  to authenticated
  using (
    exists (
      select 1 from public.cases c
      where c.id = case_notes.case_id
        and (
          c.owner_id = auth.uid()
          or public.is_firm_case_manager(c.firm_id)
        )
    )
    or exists (
      select 1 from public.case_access_grants g
      where g.case_id = case_notes.case_id
        and g.grantee_id = auth.uid()
        and g.revoked_at is null
        and g.access_level = 'read_write'
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

-- ----------------------------------------------------------------------------
-- 3. cases: tenant-bound INSERT, explicit UPDATE ... WITH CHECK
-- ----------------------------------------------------------------------------
-- BEFORE: cases_insert never looked at firm_id, so any signed-in user could
-- create a case inside ANOTHER firm (visible to that firm's owners/admins via
-- is_firm_case_manager). cases_update had no WITH CHECK, so Postgres reused
-- USING as the check; a read_write grantee could therefore set owner_id to
-- themselves (takeover) and anyone who could update could change firm_id.
drop policy if exists cases_insert on public.cases;
create policy cases_insert
  on public.cases
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and (
      (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
      or (
        public.is_firm_member(firm_id)
        and (
          team_id is null
          or exists (
            select 1 from public.team_members tm
            where tm.team_id = cases.team_id
              and tm.profile_id = auth.uid()
              and tm.role = 'lead'
          )
        )
      )
    )
  );

drop policy if exists cases_update on public.cases;
create policy cases_update
  on public.cases
  for update
  to authenticated
  using (
    owner_id = auth.uid()
    or public.has_case_grant(id, true)
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  )
  with check (
    owner_id = auth.uid()
    or public.has_case_grant(id, true)
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

create or replace function public.enforce_case_integrity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support'), false);
begin
  if v_uid is null then
    return new; -- trusted service-role path
  end if;

  if tg_op = 'UPDATE' then
    if new.firm_id is distinct from old.firm_id then
      raise exception 'cases.firm_id is immutable' using errcode = '42501';
    end if;
    -- Ownership changes are an admin/support operation only. (A read_write
    -- grantee could previously set owner_id to themselves.)
    if new.owner_id is distinct from old.owner_id and not v_is_admin then
      raise exception 'cases.owner_id cannot be changed' using errcode = '42501';
    end if;
  end if;

  if new.team_id is not null and (tg_op = 'INSERT' or new.team_id is distinct from old.team_id) then
    if not exists (select 1 from public.teams t where t.id = new.team_id and t.firm_id = new.firm_id) then
      raise exception 'team does not belong to the case firm' using errcode = '42501';
    end if;
  end if;

  if new.client_id is not null and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id) then
    if not exists (select 1 from public.clients c where c.id = new.client_id and c.firm_id = new.firm_id) then
      raise exception 'client does not belong to the case firm' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists cases_enforce_integrity on public.cases;
create trigger cases_enforce_integrity
  before insert or update on public.cases
  for each row execute function public.enforce_case_integrity();

-- ----------------------------------------------------------------------------
-- 4. case_documents: you may only attach documents you own
-- ----------------------------------------------------------------------------
-- BEFORE: case_documents_insert checked write access to the CASE only. Anyone
-- with write access to any case could link ANY document id to it, and a firm
-- owner/admin then read that document (documents_select_via_firm_manager) and
-- its file (storage policy keyed on "a visible documents row has this path").
-- CaseService.addDocumentToCase already requires document ownership; this
-- brings the database in line so PostgREST cannot skip it.
drop policy if exists case_documents_insert on public.case_documents;
create policy case_documents_insert
  on public.case_documents
  for insert
  to authenticated
  with check (
    public.is_case_writer(case_id)
    and public.is_document_owner(document_id)
  );

-- ----------------------------------------------------------------------------
-- 5. documents: owner_id and storage_path are fixed at creation
-- ----------------------------------------------------------------------------
-- BEFORE: documents_update_own and documents_update_via_case_grant (read_write
-- grantee) both reuse USING as WITH CHECK, so the row's owner_id and
-- storage_path were freely writable. Pointing storage_path at another user's
-- object makes the storage SELECT policy (any visible documents row with that
-- path) hand over that file; a grantee could also set owner_id to themselves.
create or replace function public.enforce_document_integrity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return new; -- trusted service-role path
  end if;

  if tg_op = 'INSERT' then
    if split_part(new.storage_path, '/', 1) is distinct from new.owner_id::text then
      raise exception 'documents.storage_path must be inside the owner folder' using errcode = '42501';
    end if;
  else
    if new.owner_id is distinct from old.owner_id then
      raise exception 'documents.owner_id is immutable' using errcode = '42501';
    end if;
    if new.storage_path is distinct from old.storage_path then
      raise exception 'documents.storage_path is immutable' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists documents_enforce_integrity on public.documents;
create trigger documents_enforce_integrity
  before insert or update on public.documents
  for each row execute function public.enforce_document_integrity();

-- ----------------------------------------------------------------------------
-- 6. case_access_grants: enforce the firm boundary in the database
-- ----------------------------------------------------------------------------
-- Grants are written only by CaseAccessGrantService through the admin client,
-- and its issueGrant() deliberately did not validate the grantee ("FLAGGED,
-- NOT VALIDATED"). This trigger enforces, for every writer:
--   * grantee is a firm_members row of the CASE'S firm, or a client of that
--     firm (clients.firm_id + profile_id) so client-portal grants still work;
--   * granted_by is the case owner, an owner/admin of the case's firm, or a
--     lead of the case's team (the same rule as requireGrantManageAccess);
--   * case_id / grantee_id / granted_by never change, and a revoked grant is
--     never re-activated (issue a new, re-validated grant instead).
-- Revoking, and changing access_level, of existing (even legacy cross-firm)
-- grants remains possible.
create or replace function public.enforce_case_grant_integrity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_case public.cases%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.case_id is distinct from old.case_id
       or new.grantee_id is distinct from old.grantee_id
       or new.granted_by is distinct from old.granted_by then
      raise exception 'case_access_grants case/grantee/granter are immutable' using errcode = '42501';
    end if;
    if old.revoked_at is not null and new.revoked_at is null then
      raise exception 'a revoked grant cannot be re-activated' using errcode = '42501';
    end if;
    return new;
  end if;

  select * into v_case from public.cases where id = new.case_id;
  if not found then
    raise exception 'case not found' using errcode = '23503';
  end if;

  if not (
    exists (
      select 1 from public.firm_members fm
      where fm.firm_id = v_case.firm_id and fm.profile_id = new.grantee_id
    )
    or exists (
      select 1 from public.clients cl
      where cl.firm_id = v_case.firm_id and cl.profile_id = new.grantee_id
    )
  ) then
    raise exception 'grantee does not belong to the case firm' using errcode = '42501';
  end if;

  if not (
    v_case.owner_id = new.granted_by
    or exists (
      select 1 from public.firm_members fm
      where fm.firm_id = v_case.firm_id
        and fm.profile_id = new.granted_by
        and fm.role in ('owner', 'admin')
    )
    or (
      v_case.team_id is not null
      and exists (
        select 1 from public.team_members tm
        where tm.team_id = v_case.team_id
          and tm.profile_id = new.granted_by
          and tm.role = 'lead'
      )
    )
  ) then
    raise exception 'granter is not authorized to grant access to this case' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists case_access_grants_enforce_integrity on public.case_access_grants;
create trigger case_access_grants_enforce_integrity
  before insert or update on public.case_access_grants
  for each row execute function public.enforce_case_grant_integrity();

-- ----------------------------------------------------------------------------
-- 7. hearings / tasks / case_notes: keep rows inside the case's firm
-- ----------------------------------------------------------------------------
-- hearings.firm_id and tasks.firm_id are denormalised copies of cases.firm_id
-- with no constraint, and is_firm_case_manager(firm_id) trusts the copy. A
-- writer could stamp a row on their own case with ANOTHER firm's id and
-- surface it to that firm's owners/admins. Enforced for every caller.
create or replace function public.enforce_hearing_integrity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_case_firm uuid;
begin
  select c.firm_id into v_case_firm from public.cases c where c.id = new.case_id;
  if v_case_firm is distinct from new.firm_id then
    raise exception 'hearings.firm_id must equal the case firm_id' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists hearings_enforce_integrity on public.hearings;
create trigger hearings_enforce_integrity
  before insert or update on public.hearings
  for each row execute function public.enforce_hearing_integrity();

create or replace function public.enforce_task_integrity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support'), false);
  v_case_firm uuid;
begin
  if new.case_id is not null then
    select c.firm_id into v_case_firm from public.cases c where c.id = new.case_id;
    if v_case_firm is distinct from new.firm_id then
      raise exception 'tasks.firm_id must equal the case firm_id' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and v_uid is not null then
    if new.firm_id is distinct from old.firm_id then
      raise exception 'tasks.firm_id is immutable' using errcode = '42501';
    end if;
    -- tasks_update reuses USING as WITH CHECK, so an assignee could re-point
    -- their task at any case. Moving a task needs write access to the target.
    if new.case_id is not null
       and new.case_id is distinct from old.case_id
       and not v_is_admin
       and not exists (
         select 1 from public.cases c
         where c.id = new.case_id
           and (
             c.owner_id = v_uid
             or exists (
               select 1 from public.case_access_grants g
               where g.case_id = c.id
                 and g.grantee_id = v_uid
                 and g.revoked_at is null
                 and g.access_level = 'read_write'
             )
           )
       ) then
      raise exception 'no write access to the target case' using errcode = '42501';
    end if;
  end if;

  -- An assignee must belong to the task's firm (staff or that firm's client).
  if new.assignee_profile_id is not null
     and (tg_op = 'INSERT' or new.assignee_profile_id is distinct from old.assignee_profile_id) then
    if not (
      exists (
        select 1 from public.firm_members fm
        where fm.firm_id = new.firm_id and fm.profile_id = new.assignee_profile_id
      )
      or exists (
        select 1 from public.clients cl
        where cl.firm_id = new.firm_id and cl.profile_id = new.assignee_profile_id
      )
    ) then
      raise exception 'assignee does not belong to the task firm' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_enforce_integrity on public.tasks;
create trigger tasks_enforce_integrity
  before insert or update on public.tasks
  for each row execute function public.enforce_task_integrity();

-- case_notes_update's WITH CHECK only pins author_id, so an author could move
-- a note into ANY case by editing case_id.
create or replace function public.enforce_case_note_integrity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is not null and new.case_id is distinct from old.case_id then
    raise exception 'case_notes.case_id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists case_notes_enforce_integrity on public.case_notes;
create trigger case_notes_enforce_integrity
  before update on public.case_notes
  for each row execute function public.enforce_case_note_integrity();

-- ----------------------------------------------------------------------------
-- 8. profiles.firm_id: a pointer, never proof of membership
-- ----------------------------------------------------------------------------
-- profiles_update_own lets a user write any firm id into their own row. No SQL
-- policy trusts it today, but it must not be settable to a firm the user does
-- not belong to. Multi-firm membership is unaffected: the pointer may name
-- any firm the caller really is a firm_members row of, or be cleared.
create or replace function public.enforce_profile_firm_pointer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is not null
     and new.firm_id is not null
     and new.firm_id is distinct from old.firm_id
     and not exists (
       select 1 from public.firm_members fm
       where fm.firm_id = new.firm_id and fm.profile_id = new.id
     ) then
    raise exception 'profiles.firm_id must reference a firm you belong to' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_enforce_firm_pointer on public.profiles;
create trigger profiles_enforce_firm_pointer
  before update on public.profiles
  for each row execute function public.enforce_profile_firm_pointer();
