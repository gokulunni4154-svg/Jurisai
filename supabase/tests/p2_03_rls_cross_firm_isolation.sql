-- ============================================================================
-- P2-03 RLS / cross-firm isolation regression suite (plain SQL, no pgTAP).
-- Run against a LOCAL / disposable database that already has the migrations
-- applied, e.g.:  psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f this_file.sql
-- Everything (fixtures, helper schema p203) lives inside ONE transaction that
-- is ROLLED BACK at the end, so nothing persists. NEVER point it at a shared
-- or production database. Exits non-zero (psql -v ON_ERROR_STOP=1) if any
-- check fails.
-- ============================================================================
begin;
create schema p203;
grant usage on schema p203 to public;
create table p203.results (n serial, label text, ok boolean, detail text);
grant all on p203.results to public;
grant usage, select on sequence p203.results_n_seq to public;

create function p203.as_user(uid uuid, app_role text default 'lawyer') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated',
    'app_metadata', json_build_object('role', app_role))::text, true);
  execute 'set local role authenticated';
end $$;

create function p203.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;

-- visible row count equals expected
create function p203.rows_eq(lbl text, q text, expected bigint) returns void language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || q || ') s' into n;
  insert into p203.results(label, ok, detail) values (lbl, n = expected, 'got ' || n || ', expected ' || expected);
exception when others then
  insert into p203.results(label, ok, detail) values (lbl, expected = 0 and sqlstate = '42501', 'error ' || sqlstate || ' ' || sqlerrm);
end $$;

-- statement must be REJECTED (RLS / privilege / trigger); effects never persist
create function p203.denied(lbl text, q text) returns void language plpgsql as $$
begin
  begin
    execute q;
    raise exception 'P203_WAS_ALLOWED';
  exception when others then
    if sqlerrm = 'P203_WAS_ALLOWED' then
      insert into p203.results(label, ok, detail) values (lbl, false, 'statement was ALLOWED');
    elsif sqlstate in ('42501', '23514') then
      insert into p203.results(label, ok, detail) values (lbl, true, 'rejected: ' || sqlstate);
    else
      insert into p203.results(label, ok, detail) values (lbl, false, 'unexpected error ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;
end $$;

-- statement must SUCCEED (and is rolled back afterwards)
create function p203.allowed(lbl text, q text) returns void language plpgsql as $$
begin
  begin
    execute q;
    raise exception 'P203_OK';
  exception when others then
    if sqlerrm = 'P203_OK' then
      insert into p203.results(label, ok, detail) values (lbl, true, 'allowed');
    else
      insert into p203.results(label, ok, detail) values (lbl, false, 'error ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;
end $$;

-- UPDATE/DELETE must affect exactly n visible rows (RLS can filter silently)
create function p203.affected(lbl text, q text, expected bigint) returns void language plpgsql as $$
declare n bigint;
begin
  begin
    execute q;
    get diagnostics n = row_count;
    insert into p203.results(label, ok, detail) values (lbl, n = expected, 'affected ' || n || ', expected ' || expected);
    raise exception 'P203_ROLLBACK';
  exception when others then
    if sqlerrm <> 'P203_ROLLBACK' then
      insert into p203.results(label, ok, detail) values (lbl, expected = 0 and sqlstate in ('42501','23514'), 'error ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;
end $$;

-- ----------------------------- fixtures (superuser) ------------------------

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'a_owner@p203.test');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000002', 'a_admin@p203.test');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000003', 'a_lawyer@p203.test');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000004', 'a_rw@p203.test');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000005', 'a_ro@p203.test');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000006', 'a_emp@p203.test');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000007', 'b_owner@p203.test');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000008', 'b_lawyer@p203.test');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000009', 'multi@p203.test');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'client@p203.test');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'outsider@p203.test');
insert into public.firms (id, name, owner_id) values ('10000000-0000-0000-0000-00000000000a', 'FA', '00000000-0000-0000-0000-000000000001');
insert into public.firms (id, name, owner_id) values ('10000000-0000-0000-0000-00000000000b', 'FB', '00000000-0000-0000-0000-000000000007');
insert into public.firms (id, name, owner_id) values ('10000000-0000-0000-0000-00000000000c', 'FC', '00000000-0000-0000-0000-00000000000b');
insert into public.firm_members (firm_id, profile_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'owner');
insert into public.firm_members (firm_id, profile_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000002', 'admin');
insert into public.firm_members (firm_id, profile_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'lawyer');
insert into public.firm_members (firm_id, profile_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'lawyer');
insert into public.firm_members (firm_id, profile_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000005', 'lawyer');
insert into public.firm_members (firm_id, profile_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000006', 'employee');
insert into public.firm_members (firm_id, profile_id, role) values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000007', 'owner');
insert into public.firm_members (firm_id, profile_id, role) values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000008', 'lawyer');
insert into public.firm_members (firm_id, profile_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000009', 'lawyer');
insert into public.firm_members (firm_id, profile_id, role) values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000009', 'lawyer');
insert into public.clients (id, firm_id, full_name, email, profile_id) values ('40000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Client A', 'client@p203.test', '00000000-0000-0000-0000-00000000000a');
insert into public.cases (id, firm_id, owner_id, title, client_id) values ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'A1', '40000000-0000-0000-0000-0000000000a1');
insert into public.cases (id, firm_id, owner_id, title) values ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000002', 'A2 (admin-owned)');
insert into public.cases (id, firm_id, owner_id, title) values ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000008', 'B1');
insert into public.case_access_grants (id, case_id, grantee_id, granted_by, access_level) values ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', 'read_write');
insert into public.case_access_grants (id, case_id, grantee_id, granted_by, access_level) values ('80000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000003', 'read');
insert into public.documents (id, owner_id, title, storage_path, mime_type, size_bytes) values ('30000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000003', 'dA', '00000000-0000-0000-0000-000000000003/x/a.pdf', 'application/pdf', 1);
insert into public.documents (id, owner_id, title, storage_path, mime_type, size_bytes) values ('30000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000008', 'dB', '00000000-0000-0000-0000-000000000008/x/b.pdf', 'application/pdf', 1);
insert into public.documents (id, owner_id, title, storage_path, mime_type, size_bytes) values ('30000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000003', 'dA2', '00000000-0000-0000-0000-000000000003/x/a2.pdf', 'application/pdf', 1);
insert into public.case_documents (case_id, document_id) values ('20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a1');
insert into public.case_documents (case_id, document_id) values ('20000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-0000000000b1');
insert into public.hearings (id, case_id, firm_id, hearing_date, created_by) values ('50000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', now() + interval '1 day', '00000000-0000-0000-0000-000000000003');
insert into public.hearings (id, case_id, firm_id, hearing_date, created_by) values ('50000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', now() + interval '1 day', '00000000-0000-0000-0000-000000000008');
insert into public.tasks (id, case_id, firm_id, title, created_by, assignee_profile_id) values ('60000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'tA', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000006');
insert into public.tasks (id, case_id, firm_id, title, created_by) values ('60000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'tB', '00000000-0000-0000-0000-000000000008');
insert into public.case_notes (id, case_id, author_id, content) values ('70000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000003', 'nA');
insert into public.case_notes (id, case_id, author_id, content) values ('70000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000008', 'nB');
update public.profiles set firm_id = '10000000-0000-0000-0000-00000000000a' where id = '00000000-0000-0000-0000-000000000003';

-- ===== A. cross-firm READ isolation =====
select p203.as_user('00000000-0000-0000-0000-000000000003', 'lawyer');
select p203.rows_eq($t$A lawyer cannot read firm B case$t$, $t$select 1 from public.cases where id='20000000-0000-0000-0000-0000000000b1'$t$, 0);
select p203.rows_eq($t$A lawyer cannot read firm B case documents link$t$, $t$select 1 from public.case_documents where case_id='20000000-0000-0000-0000-0000000000b1'$t$, 0);
select p203.rows_eq($t$A lawyer cannot read firm B document$t$, $t$select 1 from public.documents where id='30000000-0000-0000-0000-0000000000b1'$t$, 0);
select p203.rows_eq($t$A lawyer cannot read firm B hearing$t$, $t$select 1 from public.hearings where id='50000000-0000-0000-0000-0000000000b1'$t$, 0);
select p203.rows_eq($t$A lawyer cannot read firm B task$t$, $t$select 1 from public.tasks where id='60000000-0000-0000-0000-0000000000b1'$t$, 0);
select p203.rows_eq($t$A lawyer cannot read firm B note$t$, $t$select 1 from public.case_notes where id='70000000-0000-0000-0000-0000000000b1'$t$, 0);
select p203.rows_eq($t$A lawyer (owner) still reads own case A1$t$, $t$select 1 from public.cases where id='20000000-0000-0000-0000-0000000000a1'$t$, 1);
select p203.as_user('00000000-0000-0000-0000-000000000008', 'lawyer');
select p203.rows_eq($t$B lawyer reads own case B1$t$, $t$select 1 from public.cases where id='20000000-0000-0000-0000-0000000000b1'$t$, 1);
select p203.rows_eq($t$B lawyer cannot read firm A case$t$, $t$select 1 from public.cases where id='20000000-0000-0000-0000-0000000000a1'$t$, 0);
select p203.as_user('00000000-0000-0000-0000-00000000000b', 'lawyer');
select p203.rows_eq($t$user in no firm sees no cases$t$, $t$select 1 from public.cases$t$, 0);
select p203.rows_eq($t$user in no firm sees no hearings$t$, $t$select 1 from public.hearings$t$, 0);
select p203.as_anon();
select p203.rows_eq($t$unauthenticated (anon) sees no cases$t$, $t$select 1 from public.cases$t$, 0);
select p203.rows_eq($t$unauthenticated (anon) sees no documents$t$, $t$select 1 from public.documents$t$, 0);
select p203.rows_eq($t$unauthenticated (anon) sees no grants$t$, $t$select 1 from public.case_access_grants$t$, 0);
reset role;

-- ===== B. legitimate access is preserved =====
select p203.as_user('00000000-0000-0000-0000-000000000002', 'lawyer');
select p203.rows_eq($t$firm admin sees firm case A1 (is_firm_case_manager)$t$, $t$select 1 from public.cases where id='20000000-0000-0000-0000-0000000000a1'$t$, 1);
select p203.rows_eq($t$firm admin sees firm case document via manager policy$t$, $t$select 1 from public.documents where id='30000000-0000-0000-0000-0000000000a1'$t$, 1);
select p203.rows_eq($t$firm admin sees firm hearing$t$, $t$select 1 from public.hearings where id='50000000-0000-0000-0000-0000000000a1'$t$, 1);
select p203.rows_eq($t$firm admin sees firm task$t$, $t$select 1 from public.tasks where id='60000000-0000-0000-0000-0000000000a1'$t$, 1);
select p203.rows_eq($t$firm admin sees firm note$t$, $t$select 1 from public.case_notes where id='70000000-0000-0000-0000-0000000000a1'$t$, 1);
select p203.rows_eq($t$firm admin cannot see firm B case$t$, $t$select 1 from public.cases where id='20000000-0000-0000-0000-0000000000b1'$t$, 0);
select p203.as_user('00000000-0000-0000-0000-000000000004', 'lawyer');
select p203.rows_eq($t$read_write grantee sees case A1$t$, $t$select 1 from public.cases where id='20000000-0000-0000-0000-0000000000a1'$t$, 1);
select p203.rows_eq($t$read_write grantee sees A1 hearing$t$, $t$select 1 from public.hearings where id='50000000-0000-0000-0000-0000000000a1'$t$, 1);
select p203.affected($t$read_write grantee can update case title$t$, $t$update public.cases set title='x' where id='20000000-0000-0000-0000-0000000000a1'$t$, 1);
select p203.allowed($t$read_write grantee can add a hearing$t$, $t$insert into public.hearings (case_id, firm_id, hearing_date, created_by) values ('20000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a', now(), '00000000-0000-0000-0000-000000000004')$t$);
select p203.as_user('00000000-0000-0000-0000-000000000005', 'lawyer');
select p203.rows_eq($t$read grantee sees case A1$t$, $t$select 1 from public.cases where id='20000000-0000-0000-0000-0000000000a1'$t$, 1);
select p203.affected($t$read grantee CANNOT update case$t$, $t$update public.cases set title='x' where id='20000000-0000-0000-0000-0000000000a1'$t$, 0);
select p203.rows_eq($t$read grantee does not see case notes$t$, $t$select 1 from public.case_notes where id='70000000-0000-0000-0000-0000000000a1'$t$, 0);
select p203.denied($t$read grantee cannot add a hearing$t$, $t$insert into public.hearings (case_id, firm_id, hearing_date, created_by) values ('20000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a', now(), '00000000-0000-0000-0000-000000000005')$t$);
select p203.as_user('00000000-0000-0000-0000-00000000000a', 'client');
select p203.rows_eq($t$client sees only own matter A1$t$, $t$select 1 from public.cases$t$, 1);
select p203.rows_eq($t$client sees own matter hearing$t$, $t$select 1 from public.hearings where id='50000000-0000-0000-0000-0000000000a1'$t$, 1);
select p203.rows_eq($t$client does not see firm B matter$t$, $t$select 1 from public.cases where id='20000000-0000-0000-0000-0000000000b1'$t$, 0);
select p203.rows_eq($t$client does not see case tasks$t$, $t$select 1 from public.tasks where case_id is not null and assignee_profile_id is distinct from auth.uid()$t$, 0);
select p203.rows_eq($t$client does not see case notes$t$, $t$select 1 from public.case_notes$t$, 0);
select p203.denied($t$client cannot create a hearing$t$, $t$insert into public.hearings (case_id, firm_id, hearing_date, created_by) values ('20000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a', now(), '00000000-0000-0000-0000-00000000000a')$t$);
select p203.as_user('00000000-0000-0000-0000-000000000009', 'lawyer');
select p203.rows_eq($t$multi-firm member sees firm A and firm B rows they hold grants/ownership for (none)$t$, $t$select 1 from public.cases$t$, 0);
select p203.allowed($t$multi-firm member can open a case in firm A$t$, $t$insert into public.cases (firm_id, owner_id, title) values ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000009','m-A')$t$);
select p203.allowed($t$multi-firm member can open a case in firm B$t$, $t$insert into public.cases (firm_id, owner_id, title) values ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000009','m-B')$t$);
select p203.as_user('00000000-0000-0000-0000-000000000003', 'lawyer');
select p203.allowed($t$owner can attach OWN document to own case$t$, $t$insert into public.documents (owner_id,title,storage_path,mime_type,size_bytes) values ('00000000-0000-0000-0000-000000000003','n','00000000-0000-0000-0000-000000000003/y/n.pdf','application/pdf',1)$t$);

-- ===== C. ownership / tenant reassignment =====
select p203.as_user('00000000-0000-0000-0000-000000000003', 'lawyer');
select p203.allowed($t$A lawyer can open a case in own firm$t$, $t$insert into public.cases (firm_id, owner_id, title) values ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000003','new')$t$);
select p203.denied($t$A lawyer CANNOT open a case inside firm B$t$, $t$insert into public.cases (firm_id, owner_id, title) values ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000003','plant')$t$);
select p203.denied($t$A lawyer cannot open a case inside an unrelated firm$t$, $t$insert into public.cases (firm_id, owner_id, title) values ('10000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-000000000003','plant')$t$);
select p203.denied($t$case owner cannot move own case to firm B (firm_id)$t$, $t$update public.cases set firm_id='10000000-0000-0000-0000-00000000000b' where id='20000000-0000-0000-0000-0000000000a1'$t$);
select p203.denied($t$case owner cannot hand ownership to someone else$t$, $t$update public.cases set owner_id='00000000-0000-0000-0000-000000000008' where id='20000000-0000-0000-0000-0000000000a1'$t$);
select p203.as_user('00000000-0000-0000-0000-000000000004', 'lawyer');
select p203.denied($t$read_write grantee CANNOT take over ownership of the case$t$, $t$update public.cases set owner_id='00000000-0000-0000-0000-000000000004' where id='20000000-0000-0000-0000-0000000000a1'$t$);
select p203.denied($t$read_write grantee cannot move the case to another firm$t$, $t$update public.cases set firm_id='10000000-0000-0000-0000-00000000000b' where id='20000000-0000-0000-0000-0000000000a1'$t$);
select p203.as_user('00000000-0000-0000-0000-000000000005', 'lawyer');
select p203.affected($t$read grantee cannot change owner (row not updatable)$t$, $t$update public.cases set owner_id='00000000-0000-0000-0000-000000000005' where id='20000000-0000-0000-0000-0000000000a1'$t$, 0);
select p203.as_user('00000000-0000-0000-0000-000000000008', 'lawyer');
select p203.affected($t$firm B lawyer cannot update firm A case at all$t$, $t$update public.cases set title='hax' where id='20000000-0000-0000-0000-0000000000a1'$t$, 0);

-- ===== D. case-document relationship integrity =====
select p203.as_user('00000000-0000-0000-0000-000000000003', 'lawyer');
select p203.denied($t$CANNOT attach firm B's document to own case$t$, $t$insert into public.case_documents (case_id, document_id) values ('20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000b1')$t$);
select p203.as_user('00000000-0000-0000-0000-000000000002', 'lawyer');
select p203.denied($t$firm admin CANNOT attach firm B's document to their own case$t$, $t$insert into public.case_documents (case_id, document_id) values ('20000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-0000000000b1')$t$);
select p203.rows_eq($t$firm admin still cannot read firm B document$t$, $t$select 1 from public.documents where id='30000000-0000-0000-0000-0000000000b1'$t$, 0);
select p203.as_user('00000000-0000-0000-0000-000000000004', 'lawyer');
select p203.denied($t$grantee cannot attach a document they do not own$t$, $t$insert into public.case_documents (case_id, document_id) values ('20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a2')$t$);
select p203.denied($t$grantee cannot take ownership of a case document$t$, $t$update public.documents set owner_id='00000000-0000-0000-0000-000000000004' where id='30000000-0000-0000-0000-0000000000a1'$t$);
select p203.as_user('00000000-0000-0000-0000-000000000003', 'lawyer');
select p203.denied($t$document owner cannot repoint storage_path at another user's file$t$, $t$update public.documents set storage_path='00000000-0000-0000-0000-000000000008/x/orphan.pdf' where id='30000000-0000-0000-0000-0000000000a1'$t$);
select p203.denied($t$cannot register a document row on another user's storage folder$t$, $t$insert into public.documents (owner_id,title,storage_path,mime_type,size_bytes) values ('00000000-0000-0000-0000-000000000003','steal','00000000-0000-0000-0000-000000000008/x/orphan.pdf','application/pdf',1)$t$);
select p203.allowed($t$owner can still rename own document$t$, $t$update public.documents set title='renamed' where id='30000000-0000-0000-0000-0000000000a1'$t$);

-- ===== E. case_access_grants integrity (service path = no JWT, trigger is the backstop) =====
reset role;
select p203.denied($t$grant to a profile of ANOTHER firm is rejected$t$, $t$insert into public.case_access_grants (case_id, grantee_id, granted_by, access_level) values ('20000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000003','read')$t$);
select p203.denied($t$grant to a profile in no firm is rejected$t$, $t$insert into public.case_access_grants (case_id, grantee_id, granted_by, access_level) values ('20000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000003','read')$t$);
select p203.denied($t$grant issued by a firm B user on a firm A case is rejected$t$, $t$insert into public.case_access_grants (case_id, grantee_id, granted_by, access_level) values ('20000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000007','read')$t$);
select p203.denied($t$grant issued by a plain employee (no authority) is rejected$t$, $t$insert into public.case_access_grants (case_id, grantee_id, granted_by, access_level) values ('20000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000006','read_write')$t$);
select p203.allowed($t$case owner may grant to a same-firm lawyer$t$, $t$insert into public.case_access_grants (case_id, grantee_id, granted_by, access_level) values ('20000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000003','read')$t$);
select p203.allowed($t$firm admin may grant to a same-firm lawyer$t$, $t$insert into public.case_access_grants (case_id, grantee_id, granted_by, access_level) values ('20000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000002','read_write')$t$);
select p203.allowed($t$client portal: grant to the firm's own client still works$t$, $t$insert into public.case_access_grants (case_id, grantee_id, granted_by, access_level) values ('20000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000003','read')$t$);
select p203.allowed($t$multi-firm member can be granted on either firm's case$t$, $t$insert into public.case_access_grants (case_id, grantee_id, granted_by, access_level) values ('20000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000008','read')$t$);
select p203.denied($t$a grant cannot be re-pointed at a different grantee$t$, $t$update public.case_access_grants set grantee_id='00000000-0000-0000-0000-000000000008' where id='80000000-0000-0000-0000-000000000002'$t$);
select p203.denied($t$a grant cannot be re-pointed at a different case$t$, $t$update public.case_access_grants set case_id='20000000-0000-0000-0000-0000000000b1' where id='80000000-0000-0000-0000-000000000002'$t$);
select p203.allowed($t$a grant can be revoked$t$, $t$update public.case_access_grants set revoked_at=now() where id='80000000-0000-0000-0000-000000000002'$t$);
select p203.allowed($t$a grant level can be changed in place (assignCase)$t$, $t$update public.case_access_grants set access_level='read_write' where id='80000000-0000-0000-0000-000000000002'$t$);
update public.case_access_grants set revoked_at=now() where id='80000000-0000-0000-0000-000000000002';
select p203.denied($t$a revoked grant cannot be re-activated$t$, $t$update public.case_access_grants set revoked_at=null where id='80000000-0000-0000-0000-000000000002'$t$);
select p203.as_user('00000000-0000-0000-0000-000000000004', 'lawyer');
select p203.denied($t$a signed-in user cannot write grants directly (no write policy)$t$, $t$insert into public.case_access_grants (case_id, grantee_id, granted_by, access_level) values ('20000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004','read_write')$t$);
select p203.affected($t$a signed-in user cannot edit grants directly$t$, $t$update public.case_access_grants set access_level='read_write' where id='80000000-0000-0000-0000-000000000002'$t$, 0);

-- ===== F. profiles.firm_id is not proof of membership =====
select p203.as_user('00000000-0000-0000-0000-00000000000b', 'lawyer');
select p203.denied($t$user cannot point profiles.firm_id at a firm they are not in$t$, $t$update public.profiles set firm_id='10000000-0000-0000-0000-00000000000a' where id='00000000-0000-0000-0000-00000000000b'$t$);
select p203.rows_eq($t$a forged profiles.firm_id grants no case visibility$t$, $t$select 1 from public.cases$t$, 0);
select p203.as_user('00000000-0000-0000-0000-000000000009', 'lawyer');
select p203.allowed($t$multi-firm member may point primary firm at either of their firms (A)$t$, $t$update public.profiles set firm_id='10000000-0000-0000-0000-00000000000a' where id='00000000-0000-0000-0000-000000000009'$t$);
select p203.allowed($t$multi-firm member may point primary firm at either of their firms (B)$t$, $t$update public.profiles set firm_id='10000000-0000-0000-0000-00000000000b' where id='00000000-0000-0000-0000-000000000009'$t$);
select p203.allowed($t$a user may clear their primary firm$t$, $t$update public.profiles set firm_id=null where id='00000000-0000-0000-0000-000000000009'$t$);

-- ===== G. hearings / tasks / case_notes =====
select p203.as_user('00000000-0000-0000-0000-000000000003', 'lawyer');
select p203.allowed($t$hearing with the case's own firm_id is accepted$t$, $t$insert into public.hearings (case_id, firm_id, hearing_date, created_by) values ('20000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a', now(), '00000000-0000-0000-0000-000000000003')$t$);
select p203.denied($t$hearing stamped with another firm's id is rejected$t$, $t$insert into public.hearings (case_id, firm_id, hearing_date, created_by) values ('20000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000b', now(), '00000000-0000-0000-0000-000000000003')$t$);
select p203.denied($t$cannot move a hearing onto a firm B case$t$, $t$update public.hearings set case_id='20000000-0000-0000-0000-0000000000b1' where id='50000000-0000-0000-0000-0000000000a1'$t$);
select p203.denied($t$cannot insert a hearing on a firm B case$t$, $t$insert into public.hearings (case_id, firm_id, hearing_date, created_by) values ('20000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b', now(), '00000000-0000-0000-0000-000000000003')$t$);
select p203.allowed($t$task for same-firm assignee is accepted$t$, $t$insert into public.tasks (case_id, firm_id, title, created_by, assignee_profile_id) values ('20000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a','t','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000006')$t$);
select p203.denied($t$task stamped with another firm's id is rejected$t$, $t$insert into public.tasks (case_id, firm_id, title, created_by) values ('20000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000b','t','00000000-0000-0000-0000-000000000003')$t$);
select p203.denied($t$task cannot be assigned to a profile outside the firm$t$, $t$insert into public.tasks (case_id, firm_id, title, created_by, assignee_profile_id) values ('20000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a','t','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000008')$t$);
select p203.denied($t$cannot create a task on a firm B case$t$, $t$insert into public.tasks (case_id, firm_id, title, created_by) values ('20000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','t','00000000-0000-0000-0000-000000000003')$t$);
select p203.as_user('00000000-0000-0000-0000-000000000006', 'lawyer');
select p203.allowed($t$assignee can still update the status of their own task$t$, $t$update public.tasks set status='done' where id='60000000-0000-0000-0000-0000000000a1'$t$);
select p203.denied($t$assignee cannot re-point their task at a firm B case$t$, $t$update public.tasks set case_id='20000000-0000-0000-0000-0000000000b1', firm_id='10000000-0000-0000-0000-00000000000b' where id='60000000-0000-0000-0000-0000000000a1'$t$);
select p203.denied($t$assignee cannot move their task to another firm$t$, $t$update public.tasks set firm_id='10000000-0000-0000-0000-00000000000b' where id='60000000-0000-0000-0000-0000000000a1'$t$);
select p203.as_user('00000000-0000-0000-0000-000000000003', 'lawyer');
select p203.denied($t$note author cannot move a note into another firm's case$t$, $t$update public.case_notes set case_id='20000000-0000-0000-0000-0000000000b1' where id='70000000-0000-0000-0000-0000000000a1'$t$);
select p203.allowed($t$note author can still edit own note$t$, $t$update public.case_notes set content='edited' where id='70000000-0000-0000-0000-0000000000a1'$t$);

-- ===== H. security-definer helpers cannot be abused =====
select p203.as_user('00000000-0000-0000-0000-000000000003', 'lawyer');
select p203.rows_eq($t$is_case_owner(firm B case) is false for A lawyer$t$, $t$select 1 where public.is_case_owner('20000000-0000-0000-0000-0000000000b1')$t$, 0);
select p203.rows_eq($t$has_case_grant(firm B case) is false for A lawyer$t$, $t$select 1 where public.has_case_grant('20000000-0000-0000-0000-0000000000b1')$t$, 0);
select p203.rows_eq($t$is_firm_case_manager(firm B) is false for A lawyer$t$, $t$select 1 where public.is_firm_case_manager('10000000-0000-0000-0000-00000000000b')$t$, 0);
select p203.rows_eq($t$is_case_writer(firm B case) is false for A lawyer$t$, $t$select 1 where public.is_case_writer('20000000-0000-0000-0000-0000000000b1')$t$, 0);
select p203.as_user('00000000-0000-0000-0000-000000000002', 'lawyer');
select p203.rows_eq($t$is_firm_case_manager(firm A) is true for A admin$t$, $t$select 1 where public.is_firm_case_manager('10000000-0000-0000-0000-00000000000a')$t$, 1);
select p203.rows_eq($t$is_firm_case_manager(firm B) is false for A admin$t$, $t$select 1 where public.is_firm_case_manager('10000000-0000-0000-0000-00000000000b')$t$, 0);
select p203.as_anon();
select p203.denied($t$anon cannot EXECUTE is_case_owner$t$, $t$select public.is_case_owner('20000000-0000-0000-0000-0000000000b1')$t$);
select p203.denied($t$anon cannot EXECUTE is_firm_case_manager$t$, $t$select public.is_firm_case_manager('10000000-0000-0000-0000-00000000000b')$t$);
select p203.denied($t$anon cannot EXECUTE has_case_grant$t$, $t$select public.has_case_grant('20000000-0000-0000-0000-0000000000b1')$t$);

-- ===== I. revocation and removal take effect =====
reset role;
update public.case_access_grants set revoked_at = now() where id = '80000000-0000-0000-0000-000000000001';
select p203.as_user('00000000-0000-0000-0000-000000000004', 'lawyer');
select p203.rows_eq($t$revoked grantee no longer sees the case$t$, $t$select 1 from public.cases where id='20000000-0000-0000-0000-0000000000a1'$t$, 0);
select p203.rows_eq($t$revoked grantee no longer sees the hearing$t$, $t$select 1 from public.hearings where id='50000000-0000-0000-0000-0000000000a1'$t$, 0);
reset role;
delete from public.firm_members where firm_id='10000000-0000-0000-0000-00000000000a' and profile_id='00000000-0000-0000-0000-000000000002';
select p203.as_user('00000000-0000-0000-0000-000000000002', 'lawyer');
select p203.rows_eq($t$removed firm admin no longer sees firm A case A1$t$, $t$select 1 from public.cases where id='20000000-0000-0000-0000-0000000000a1'$t$, 0);
select p203.rows_eq($t$removed firm admin no longer sees firm A document$t$, $t$select 1 from public.documents where id='30000000-0000-0000-0000-0000000000a1'$t$, 0);

reset role;
\echo
\echo ===== P2-03 RESULTS =====
select case when ok then 'PASS' else 'FAIL' end as result, label, detail from p203.results order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from p203.results;
select (count(*) filter (where not ok)) > 0 as has_failures from p203.results \gset
rollback;
\if :has_failures
  \echo 'P2-03 SUITE: FAILURES PRESENT'
  \quit 3
\else
  \echo 'P2-03 SUITE: ALL CHECKS PASSED'
\endif
