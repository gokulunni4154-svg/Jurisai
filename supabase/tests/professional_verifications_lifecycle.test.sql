-- DB-level regression test for the professional_verifications guard +
-- history triggers (migration 20261016000000). Run on a LOCAL / scratch
-- Postgres that has the Supabase auth schema and all migrations applied:
--
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/professional_verifications_lifecycle.test.sql
--
-- Everything runs in one transaction and is rolled back; any failed
-- assertion aborts with an exception. Never run against production.
begin;

create or replace function pg_temp.as_user(p_uid uuid, p_role text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('role', p_role))::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.as_trusted() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.expect_denied(p_sql text, p_label text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'FAIL (expected denial): %', p_label;
end $$;

insert into auth.users (id, email, raw_app_meta_data) values
  ('11111111-0000-0000-0000-000000000001', 'law@t', '{"role":"lawyer"}'),
  ('11111111-0000-0000-0000-000000000002', 'ind@t', '{"role":"individual"}'),
  ('11111111-0000-0000-0000-000000000003', 'adm@t', '{"role":"admin"}'),
  ('11111111-0000-0000-0000-000000000004', 'cli@t', '{"role":"client"}');

-- 1. lawyer inserts pending: role comes from the JWT, not the client.
select pg_temp.as_user('11111111-0000-0000-0000-000000000001', 'lawyer');
insert into public.professional_verifications (profile_id, registration_number)
values ('11111111-0000-0000-0000-000000000001', 'BAR/1');
do $$ begin
  if (select role from public.professional_verifications
      where profile_id = '11111111-0000-0000-0000-000000000001') is distinct from 'lawyer'
  then raise exception 'FAIL: lawyer role not stamped on insert'; end if;
end $$;

-- 2. non-lawyer supported role still works.
select pg_temp.as_user('11111111-0000-0000-0000-000000000002', 'individual');
insert into public.professional_verifications (profile_id, registration_number)
values ('11111111-0000-0000-0000-000000000002', 'IND/1');
do $$ begin
  if (select role from public.professional_verifications
      where profile_id = '11111111-0000-0000-0000-000000000002') is distinct from 'individual'
  then raise exception 'FAIL: individual role not stamped'; end if;
end $$;

-- 3. self-approval / crafted inserts are denied.
select pg_temp.as_user('11111111-0000-0000-0000-000000000004', 'client');
select pg_temp.expect_denied($q$insert into public.professional_verifications (profile_id, registration_number)
  values ('11111111-0000-0000-0000-000000000004','C/1')$q$, 'client role cannot submit');

select pg_temp.as_user('11111111-0000-0000-0000-000000000001', 'lawyer');
select pg_temp.expect_denied($q$update public.professional_verifications set status='verified'
  where profile_id='11111111-0000-0000-0000-000000000001'$q$, 'user self-approves via update');
select pg_temp.expect_denied($q$update public.professional_verifications set role='admin'
  where profile_id='11111111-0000-0000-0000-000000000001'$q$, 'user edits own role');
select pg_temp.as_trusted();
delete from public.professional_verifications where profile_id='11111111-0000-0000-0000-000000000002';
select pg_temp.as_user('11111111-0000-0000-0000-000000000002', 'individual');
select pg_temp.expect_denied($q$insert into public.professional_verifications
  (profile_id, registration_number, status, role)
  values ('11111111-0000-0000-0000-000000000002','X','verified','lawyer')$q$, 'crafted verified insert');

-- 4. a non-admin cannot review someone else's row (RLS hides it: 0 rows).
select pg_temp.as_user('11111111-0000-0000-0000-000000000002', 'individual');
do $$ declare n int; begin
  update public.professional_verifications set status='verified'
   where profile_id='11111111-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user touched another user''s row'; end if;
end $$;

-- 5. admin approves: reviewed_by/at are server-set, role preserved.
select pg_temp.as_user('11111111-0000-0000-0000-000000000003', 'admin');
update public.professional_verifications
   set status='verified', reviewed_by='11111111-0000-0000-0000-000000000001',
       reviewed_at='2000-01-01'
 where profile_id='11111111-0000-0000-0000-000000000001';
do $$ declare r record; begin
  select * into r from public.professional_verifications
   where profile_id='11111111-0000-0000-0000-000000000001';
  if r.status <> 'verified' or r.role <> 'lawyer'
     or r.reviewed_by <> '11111111-0000-0000-0000-000000000003'
     or r.reviewed_at < now() - interval '1 minute'
  then raise exception 'FAIL: admin approval audit fields wrong: %', r; end if;
end $$;
select pg_temp.expect_denied($q$update public.professional_verifications set role='individual'
  where profile_id='11111111-0000-0000-0000-000000000001'$q$, 'admin cannot change role');
select pg_temp.expect_denied($q$update public.professional_verifications set status='rejected'
  where profile_id='11111111-0000-0000-0000-000000000001'$q$, 'closed row cannot be re-decided');

-- 6. admin cannot verify a role-less row.
select pg_temp.as_trusted();
insert into public.professional_verifications (profile_id, registration_number, status)
values ('11111111-0000-0000-0000-000000000004', 'LEGACY/1', 'pending');
select pg_temp.as_user('11111111-0000-0000-0000-000000000003', 'admin');
select pg_temp.expect_denied($q$update public.professional_verifications set status='verified'
  where profile_id='11111111-0000-0000-0000-000000000004'$q$, 'verify role-less row');

-- 7. rejection -> resubmission keeps history and clears live review fields.
update public.professional_verifications set status='rejected'
 where profile_id='11111111-0000-0000-0000-000000000004';
select pg_temp.as_user('11111111-0000-0000-0000-000000000004', 'client');
select pg_temp.expect_denied($q$update public.professional_verifications
  set status='resubmitted' where profile_id='11111111-0000-0000-0000-000000000004'$q$,
  'client cannot resubmit');
select pg_temp.as_trusted();
update public.professional_verifications set role = null where profile_id='11111111-0000-0000-0000-000000000001';
update public.professional_verifications set status='rejected', role='lawyer',
  reviewed_by='11111111-0000-0000-0000-000000000003', reviewed_at=now()
 where profile_id='11111111-0000-0000-0000-000000000001';
select pg_temp.as_user('11111111-0000-0000-0000-000000000001', 'lawyer');
update public.professional_verifications set registration_number='BAR/2', status='resubmitted'
 where profile_id='11111111-0000-0000-0000-000000000001';
do $$ declare r record; h int; begin
  select * into r from public.professional_verifications
   where profile_id='11111111-0000-0000-0000-000000000001';
  if r.status <> 'resubmitted' or r.role <> 'lawyer'
     or r.reviewed_by is not null or r.reviewed_at is not null
  then raise exception 'FAIL: resubmission state wrong: %', r; end if;
  select count(*) into h from public.professional_verification_history
   where verification_id = r.id and status = 'rejected' and registration_number = 'BAR/1';
  if h <> 1 then raise exception 'FAIL: rejection not archived (count %)', h; end if;
end $$;

-- 8. history is read-only for clients.
select pg_temp.expect_denied($q$insert into public.professional_verification_history
  (verification_id, profile_id, registration_number, status)
  select id, profile_id, 'x', 'verified' from public.professional_verifications limit 1$q$,
  'client writes history');

rollback;
select 'professional_verifications lifecycle test: PASS' as result;
