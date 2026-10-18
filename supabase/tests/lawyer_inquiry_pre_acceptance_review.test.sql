-- DB-level regression test for pre-acceptance inquiry review
-- (migrations 20261017000000 + 20261017000001). Run on a LOCAL / scratch
-- Postgres that has the Supabase auth schema and all migrations applied:
--
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/lawyer_inquiry_pre_acceptance_review.test.sql
--
-- Everything runs in one transaction and is rolled back; any failed
-- assertion aborts with an exception. Never run against production.
-- Two-session concurrency is covered separately by
-- supabase/tests/lawyer_inquiry_concurrency.sh (a single transaction cannot
-- race itself).
begin;

create or replace function pg_temp.as_user(p_uid uuid, p_role text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('role', p_role))::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.as_service() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role service_role';
end $$;

create or replace function pg_temp.as_trusted() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL: %', p_label; end if;
end $$;

-- Expect a statement to fail with a message containing p_msg.
create or replace function pg_temp.expect_error(p_sql text, p_msg text, p_label text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_msg in sqlerrm) > 0 then return; end if;
    raise exception 'FAIL (wrong error) %: wanted [%] got [%]', p_label, p_msg, sqlerrm;
  end;
  raise exception 'FAIL (expected error [%]): %', p_msg, p_label;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- people
--   c1  client (sender)            l1  solo lawyer (owner of solo firm F_SOLO)
--   l9  lawyer of an unrelated firm F_OTHER (owner)
--   fo  owner of F_FIRM            fa  admin of F_FIRM     fe  employee of F_FIRM
--   fl2 / fl3  lawyers of F_FIRM   x1  admin of F_OTHER (outsider to F_FIRM)
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000c001', 'c1@t'),
  ('aaaaaaaa-0000-0000-0000-00000000a001', 'l1@t'),
  ('aaaaaaaa-0000-0000-0000-00000000a009', 'l9@t'),
  ('aaaaaaaa-0000-0000-0000-0000000000f0', 'fo@t'),
  ('aaaaaaaa-0000-0000-0000-0000000000fa', 'fa@t'),
  ('aaaaaaaa-0000-0000-0000-0000000000fe', 'fe@t'),
  ('aaaaaaaa-0000-0000-0000-000000000f02', 'fl2@t'),
  ('aaaaaaaa-0000-0000-0000-000000000f03', 'fl3@t'),
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'x1@t');
insert into public.profiles (id) select id from auth.users;

insert into public.firms (id, name) values
  ('bbbbbbbb-0000-0000-0000-00000000f501', 'solo'),
  ('bbbbbbbb-0000-0000-0000-00000000f001', 'firm'),
  ('bbbbbbbb-0000-0000-0000-00000000f009', 'other');
insert into public.firm_members (firm_id, profile_id, role) values
  ('bbbbbbbb-0000-0000-0000-00000000f501', 'aaaaaaaa-0000-0000-0000-00000000a001', 'owner'),
  ('bbbbbbbb-0000-0000-0000-00000000f009', 'aaaaaaaa-0000-0000-0000-00000000a009', 'owner'),
  ('bbbbbbbb-0000-0000-0000-00000000f009', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'admin'),
  ('bbbbbbbb-0000-0000-0000-00000000f001', 'aaaaaaaa-0000-0000-0000-0000000000f0', 'owner'),
  ('bbbbbbbb-0000-0000-0000-00000000f001', 'aaaaaaaa-0000-0000-0000-0000000000fa', 'admin'),
  ('bbbbbbbb-0000-0000-0000-00000000f001', 'aaaaaaaa-0000-0000-0000-0000000000fe', 'employee'),
  ('bbbbbbbb-0000-0000-0000-00000000f001', 'aaaaaaaa-0000-0000-0000-000000000f02', 'lawyer'),
  ('bbbbbbbb-0000-0000-0000-00000000f001', 'aaaaaaaa-0000-0000-0000-000000000f03', 'lawyer');
insert into public.teams (id, firm_id) values
  ('cccccccc-0000-0000-0000-0000000000a1', 'bbbbbbbb-0000-0000-0000-00000000f009');

-- documents: d1 + d2 are the client's and attached to inquiries; d3 is the
-- client's but attached to nothing; d9 belongs to someone else.
insert into public.documents (id, owner_id, storage_path, name) values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001', 'aaaaaaaa-0000-0000-0000-00000000c001/d1/a.pdf', 'a.pdf'),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000c001', 'aaaaaaaa-0000-0000-0000-00000000c001/d2/b.pdf', 'b.pdf'),
  ('dddddddd-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000c001', 'aaaaaaaa-0000-0000-0000-00000000c001/d3/unrelated.pdf', 'unrelated.pdf'),
  ('dddddddd-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000a1/d9/other.pdf', 'other.pdf');
insert into public.document_analyses (id, document_id, status, result) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'completed', '{"score":71}'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000002', 'completed', '{"score":42}');

-- i1: targeted at solo lawyer l1.  i2: firm-routed to F_FIRM.  i3: firm-routed,
-- anonymous-origin file (no documents row).  i4: firm-routed, used for decline.
insert into public.lawyer_inquiries (id, client_profile_id, target_profile_id, target_firm_id, document_storage_path, analysis_result) values
  ('11111111-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001', 'aaaaaaaa-0000-0000-0000-00000000a001', 'bbbbbbbb-0000-0000-0000-00000000f501', 'aaaaaaaa-0000-0000-0000-00000000c001/d1/a.pdf', '{"score":71}'),
  ('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000c001', null, 'bbbbbbbb-0000-0000-0000-00000000f001', 'aaaaaaaa-0000-0000-0000-00000000c001/d2/b.pdf', '{"score":42}'),
  ('11111111-1111-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000c001', null, 'bbbbbbbb-0000-0000-0000-00000000f001', 'anon/tok/x/c.pdf', '{"score":10}'),
  ('11111111-1111-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-00000000c001', null, 'bbbbbbbb-0000-0000-0000-00000000f001', 'anon/tok/y/e.pdf', '{"score":5}');
insert into public.lawyer_inquiry_documents (inquiry_id, document_id, storage_path, file_name, analysis_id, analysis_state, analysis_snapshot) values
  ('11111111-1111-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001/d1/a.pdf', 'a.pdf', 'eeeeeeee-0000-0000-0000-000000000001', 'complete', '{"score":71}'),
  ('11111111-1111-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000c001/d2/b.pdf', 'b.pdf', 'eeeeeeee-0000-0000-0000-000000000002', 'complete', '{"score":42}'),
  ('11111111-1111-0000-0000-000000000003', null, 'anon/tok/x/c.pdf', 'c.pdf', null, 'complete', '{"score":10}'),
  ('11111111-1111-0000-0000-000000000004', null, 'anon/tok/y/e.pdf', 'e.pdf', null, 'unavailable', null);

-- ---------------------------------------------------------------------------
-- 1. Pre-acceptance review: who may open
-- ---------------------------------------------------------------------------
select pg_temp.as_service();

-- assigned lawyer opens their own inquiry
select pg_temp.check(
  (public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a001')->>'capacity') = 'assigned_lawyer',
  'assigned lawyer can open own inquiry');
-- firm owner and admin open the firm-routed inquiry
select pg_temp.check(
  (public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000fa')->>'capacity') = 'firm_reviewer',
  'firm admin can open firm inquiry');
select pg_temp.check(
  (public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000f0')->>'capacity') = 'firm_reviewer',
  'firm owner can open firm inquiry');

-- denied: unrelated lawyer, other firm's admin, employee, firm lawyer, the client, a stranger id
select pg_temp.expect_error($$select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a009')$$, 'not_authorized', 'unrelated lawyer denied (targeted)');
select pg_temp.expect_error($$select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000a1')$$, 'not_authorized', 'other firm admin denied');
select pg_temp.expect_error($$select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000fe')$$, 'not_authorized', 'employee denied');
select pg_temp.expect_error($$select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000f02')$$, 'not_authorized', 'plain firm lawyer denied');
select pg_temp.expect_error($$select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000c001')$$, 'not_authorized', 'sender is not a reviewer');
select pg_temp.expect_error($$select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000002', null)$$, 'not_authorized', 'null reviewer denied');
-- a firm owner/admin of an unrelated firm cannot review a lawyer-targeted inquiry
select pg_temp.expect_error($$select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a1')$$, 'not_authorized', 'outsider admin denied (targeted)');
select pg_temp.expect_error($$select public.open_lawyer_inquiry_review('99999999-9999-9999-9999-999999999999', 'aaaaaaaa-0000-0000-0000-0000000000f0')$$, 'inquiry_not_found', 'unknown inquiry id');

-- ---------------------------------------------------------------------------
-- 2. Review rows: created once, never extend the window
-- ---------------------------------------------------------------------------
select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a001');
select pg_temp.as_trusted();
select pg_temp.check((select count(*) from public.lawyer_inquiry_reviews
  where inquiry_id = '11111111-1111-0000-0000-000000000001') = 1, 'repeat open does not duplicate the review row');
select pg_temp.check((select r.expires_at = li.review_expires_at
  from public.lawyer_inquiry_reviews r join public.lawyer_inquiries li on li.id = r.inquiry_id
  where r.inquiry_id = '11111111-1111-0000-0000-000000000001'), 'review expiry equals the inquiry window');
select pg_temp.check((select review_expires_at > now() + interval '6 days 23 hours' and review_expires_at <= now() + interval '7 days'
  from public.lawyer_inquiries where id = '11111111-1111-0000-0000-000000000001'), 'new inquiries get a 7-day window');

-- ---------------------------------------------------------------------------
-- 3. Direct (PostgREST-style) access cannot bypass the server
-- ---------------------------------------------------------------------------
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-00000000a001', 'lawyer');
select pg_temp.expect_error($$select analysis_result from public.lawyer_inquiries$$, 'permission denied', 'report snapshot column not readable by a user session');
select pg_temp.expect_error($$select document_storage_path from public.lawyer_inquiries$$, 'permission denied', 'storage path column not readable by a user session');
select pg_temp.expect_error($$select * from public.lawyer_inquiry_reviews$$, 'permission denied', 'review table closed to user sessions');
select pg_temp.check((select count(*) from public.lawyer_inquiries) = 1, 'RLS still scopes the row to the assigned lawyer');
select pg_temp.check((select count(*) from public.lawyer_inquiry_documents) = 0, 'reviewer cannot read inquiry document rows directly');
select pg_temp.check((select count(*) from public.documents where id = 'dddddddd-0000-0000-0000-000000000001') = 0, 'attached document not readable before acceptance');
select pg_temp.check((select count(*) from public.documents where id in ('dddddddd-0000-0000-0000-000000000003','dddddddd-0000-0000-0000-000000000009')) = 0, 'unrelated documents never readable');
select pg_temp.expect_error($$select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a001', null, null, 't')$$, 'permission denied', 'accept RPC not callable with a user session');
select pg_temp.expect_error($$select public.decline_lawyer_inquiry('11111111-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a001', null)$$, 'permission denied', 'decline RPC not callable with a user session');
select pg_temp.expect_error($$select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a001')$$, 'permission denied', 'open RPC not callable with a user session');
do $$ begin
  begin update public.lawyer_inquiries set status = 'accepted' where id = '11111111-1111-0000-0000-000000000001'; exception when others then null; end;
end $$;
select pg_temp.as_trusted();
select pg_temp.check((select status = 'pending' from public.lawyer_inquiries where id = '11111111-1111-0000-0000-000000000001'), 'a user session cannot flip an inquiry to accepted');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-00000000c001', 'individual');
select pg_temp.check((select count(*) from public.lawyer_inquiry_documents) = 4, 'sender can read the document rows of their own inquiries');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1', 'lawyer');
select pg_temp.check((select count(*) from public.lawyer_inquiry_documents) = 0, 'other firm sees no inquiry document rows');

-- ---------------------------------------------------------------------------
-- 4. Individual lawyer: atomic accept, idempotent, ongoing access via grant
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.expect_error($$select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a009', null, null, 'x')$$, 'not_authorized', 'unrelated lawyer cannot accept');
select pg_temp.expect_error($$select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-00000000a009', null, 'x')$$, 'assignee_not_permitted', 'targeted inquiry cannot be handed to someone else');

create temp table accept_i1 on commit drop as
  select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a001', null, null, 'Matter A') as r;
grant select on accept_i1 to public;
select pg_temp.as_trusted();
select pg_temp.check((select (r->>'already_accepted')::boolean = false and (r->>'linked_documents')::int = 1 and (r->>'unlinked_documents')::int = 0 from accept_i1), 'accept links the attached document');

select pg_temp.as_service();
create temp table accept_i1_again on commit drop as
  select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a001', null, null, 'Matter A (retry)') as r;
select pg_temp.as_trusted();
select pg_temp.check((select (b.r->>'already_accepted')::boolean and b.r->>'case_id' = a.r->>'case_id' from accept_i1 a, accept_i1_again b), 'repeat accept returns the same case');
select pg_temp.check((select count(*) from public.cases where owner_id = 'aaaaaaaa-0000-0000-0000-00000000a001') = 1, 'repeat accept creates no second case');
select pg_temp.check((select count(*) from public.case_access_grants g join accept_i1 a on g.case_id = (a.r->>'case_id')::uuid
  where g.revoked_at is null and g.grantee_id = 'aaaaaaaa-0000-0000-0000-00000000a001' and g.access_level = 'read') = 1, 'exactly one active read grant for the lawyer');
select pg_temp.check((select count(*) from public.case_documents cd join accept_i1 a on cd.case_id = (a.r->>'case_id')::uuid) = 1, 'exactly the attached document is linked');
select pg_temp.check((select count(*) from public.audit_log where action = 'lawyer_inquiry.accept' and resource_id = '11111111-1111-0000-0000-000000000001') = 1, 'one accept audit row, none for the replay');
select pg_temp.check((select li.status = 'accepted' and li.decision = 'accepted' and li.decided_by = 'aaaaaaaa-0000-0000-0000-00000000a001'
  and li.decided_at is not null and li.case_id = (a.r->>'case_id')::uuid from public.lawyer_inquiries li, accept_i1 a
  where li.id = '11111111-1111-0000-0000-000000000001'), 'inquiry records decision, reviewer, time and case');
select pg_temp.check((select ended_reason = 'accepted' and revoked_at is not null from public.lawyer_inquiry_reviews
  where inquiry_id = '11111111-1111-0000-0000-000000000001'), 'pre-acceptance review access ended on accept');
select pg_temp.as_service();
select pg_temp.expect_error($$select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a001')$$, 'review_not_available', 'no pre-acceptance access after accept');
select pg_temp.expect_error($$select public.decline_lawyer_inquiry('11111111-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a001', null)$$, 'inquiry_already_accepted', 'accepted inquiry cannot be declined');

-- ongoing access now exists through the case grant; unrelated documents stay closed
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-00000000a001', 'lawyer');
select pg_temp.check((select count(*) from public.documents where id = 'dddddddd-0000-0000-0000-000000000001') = 1, 'accepted lawyer reads the linked document via the case grant');
select pg_temp.check((select count(*) from public.documents where id in ('dddddddd-0000-0000-0000-000000000002','dddddddd-0000-0000-0000-000000000003','dddddddd-0000-0000-0000-000000000009')) = 0, 'other documents of the sender and strangers remain closed');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-00000000a009', 'lawyer');
select pg_temp.check((select count(*) from public.documents where id = 'dddddddd-0000-0000-0000-000000000001') = 0, 'unrelated lawyer gains nothing from the accept');

-- ---------------------------------------------------------------------------
-- 5. Firm terminal: owner/admin accept-and-assign
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.expect_error($$select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000fe', 'aaaaaaaa-0000-0000-0000-000000000f02', null, 'x')$$, 'not_authorized', 'employee cannot accept');
select pg_temp.expect_error($$select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000f03', 'aaaaaaaa-0000-0000-0000-000000000f02', null, 'x')$$, 'not_authorized', 'plain firm lawyer cannot accept on behalf of the firm');
select pg_temp.expect_error($$select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000f02', null, 'x')$$, 'not_authorized', 'other firm admin cannot accept');
select pg_temp.expect_error($$select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000fa', null, null, 'x')$$, 'assignee_required', 'firm accept needs an assignee');
select pg_temp.expect_error($$select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000fa', 'aaaaaaaa-0000-0000-0000-0000000000fe', null, 'x')$$, 'assignee_not_lawyer', 'employee cannot be assigned');
select pg_temp.expect_error($$select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000fa', 'aaaaaaaa-0000-0000-0000-0000000000a1', null, 'x')$$, 'assignee_not_firm_member', 'non-member cannot be assigned');
select pg_temp.expect_error($$select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000fa', 'aaaaaaaa-0000-0000-0000-000000000f02', 'cccccccc-0000-0000-0000-0000000000a1', 'x')$$, 'team_not_in_firm', 'team of another firm rejected');
select pg_temp.expect_error($$select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000fa', 'aaaaaaaa-0000-0000-0000-000000000f02', null, '   ')$$, 'invalid_title', 'blank title rejected');
select pg_temp.as_trusted();
select pg_temp.check((select count(*) from public.cases where firm_id = 'bbbbbbbb-0000-0000-0000-00000000f001') = 0, 'rejected accepts leave no case behind');
select pg_temp.check((select status = 'pending' from public.lawyer_inquiries where id = '11111111-1111-0000-0000-000000000002'), 'rejected accepts leave the inquiry pending');

select pg_temp.as_service();
create temp table accept_i2 on commit drop as
  select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000fa', 'aaaaaaaa-0000-0000-0000-000000000f02', null, 'Firm matter') as r;
grant select on accept_i2 to public;
select pg_temp.as_trusted();
select pg_temp.check((select c.firm_id = 'bbbbbbbb-0000-0000-0000-00000000f001' and c.owner_id = 'aaaaaaaa-0000-0000-0000-000000000f02'
  from public.cases c join accept_i2 a on c.id = (a.r->>'case_id')::uuid), 'case belongs to the firm and is owned by the assigned lawyer');
select pg_temp.check((select count(*) from public.case_access_grants g join accept_i2 a on g.case_id = (a.r->>'case_id')::uuid
  where g.revoked_at is null) = 1, 'one active grant on the firm case');
select pg_temp.check((select g.grantee_id = 'aaaaaaaa-0000-0000-0000-000000000f02' and g.granted_by = 'aaaaaaaa-0000-0000-0000-0000000000fa' and g.access_level = 'read'
  from public.case_access_grants g join accept_i2 a on g.case_id = (a.r->>'case_id')::uuid where g.revoked_at is null), 'grant goes to the assignee, granted by the admin, read only');
select pg_temp.check((select li.target_profile_id = 'aaaaaaaa-0000-0000-0000-000000000f02' and li.assigned_by = 'aaaaaaaa-0000-0000-0000-0000000000fa'
  and li.assigned_at is not null and li.decided_by = 'aaaaaaaa-0000-0000-0000-0000000000fa' from public.lawyer_inquiries li
  where li.id = '11111111-1111-0000-0000-000000000002'), 'inquiry records assignee, assigner and decider');
select pg_temp.check((select count(*) from public.lawyer_inquiry_reviews where inquiry_id = '11111111-1111-0000-0000-000000000002'
  and ended_reason = 'accepted' and revoked_at is not null) = 2, 'both firm reviewers lose pre-acceptance access');

select pg_temp.as_service();
select pg_temp.check((public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000fa', 'aaaaaaaa-0000-0000-0000-000000000f02', null, 'again')->>'already_accepted')::boolean, 'admin retry is idempotent');
select pg_temp.check((public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000f02', null, null, 'again')->>'already_accepted')::boolean, 'assigned lawyer retry is idempotent');
select pg_temp.expect_error($$select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000f0', 'aaaaaaaa-0000-0000-0000-000000000f03', null, 'steal')$$, 'not_authorized', 'a second admin cannot re-assign an accepted inquiry');
select pg_temp.expect_error($$select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000fa')$$, 'not_authorized', 'admin has no review access once the inquiry is assigned');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000f02', 'lawyer');
select pg_temp.check((select count(*) from public.documents where id = 'dddddddd-0000-0000-0000-000000000002') = 1, 'assigned firm lawyer reads the linked document');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000f03', 'lawyer');
select pg_temp.check((select count(*) from public.documents where id = 'dddddddd-0000-0000-0000-000000000002') = 0, 'other firm lawyers get no automatic access');
select pg_temp.as_trusted();
select pg_temp.check((select count(*) from public.cases) = 2 and (select count(*) from public.case_access_grants where revoked_at is null) = 2, 'exactly two cases and two grants so far');

-- ---------------------------------------------------------------------------
-- 6. Expiry and decline
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-0000000000f0');
select pg_temp.as_trusted();
update public.lawyer_inquiries set review_expires_at = now() - interval '1 second' where id = '11111111-1111-0000-0000-000000000003';
select pg_temp.as_service();
select pg_temp.expect_error($$select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-0000000000f0')$$, 'review_window_expired', 'expired window blocks preview/download');
select pg_temp.expect_error($$select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-0000000000fa')$$, 'review_window_expired', 'expired window blocks a reviewer who never opened it');
select pg_temp.expect_error($$select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-0000000000fa', 'aaaaaaaa-0000-0000-0000-000000000f02', null, 'late')$$, 'review_window_expired', 'cannot accept after the window closed');
select pg_temp.expect_error($$select public.decline_lawyer_inquiry('11111111-1111-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-0000000000fe', null)$$, 'not_authorized', 'employee cannot decline');
select pg_temp.expect_error($$select public.decline_lawyer_inquiry('11111111-1111-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-0000000000a1', null)$$, 'not_authorized', 'other firm admin cannot decline');
select pg_temp.expect_error($$select public.decline_lawyer_inquiry('11111111-1111-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-0000000000fa', repeat('x', 1001))$$, 'invalid_note', 'oversized note rejected');
select public.decline_lawyer_inquiry('11111111-1111-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-0000000000fa', 'not a fit');
select pg_temp.as_trusted();
select pg_temp.check((select status = 'declined' and decision = 'declined' and decided_by = 'aaaaaaaa-0000-0000-0000-0000000000fa'
  and decided_at is not null and decision_note = 'not a fit' and case_id is null
  from public.lawyer_inquiries where id = '11111111-1111-0000-0000-000000000003'), 'decline records reviewer, time, note and creates no case link');
select pg_temp.check((select ended_reason = 'declined' and revoked_at is not null from public.lawyer_inquiry_reviews
  where inquiry_id = '11111111-1111-0000-0000-000000000003'), 'decline ends the reviewer access');
select pg_temp.check((select count(*) from public.audit_log where action = 'lawyer_inquiry.decline' and resource_id = '11111111-1111-0000-0000-000000000003') = 1, 'decline is audited');
select pg_temp.check((select count(*) from public.cases) = 2 and (select count(*) from public.case_access_grants where revoked_at is null) = 2, 'decline created no case and no grant');
select pg_temp.as_service();
select pg_temp.check((public.decline_lawyer_inquiry('11111111-1111-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-0000000000fa', null)->>'already_declined')::boolean, 'decline is idempotent for the decider');
select pg_temp.check((public.decline_lawyer_inquiry('11111111-1111-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-0000000000f0', null)->>'already_declined')::boolean, 'decline is idempotent for another admin');
select pg_temp.expect_error($$select public.accept_lawyer_inquiry('11111111-1111-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-0000000000fa', 'aaaaaaaa-0000-0000-0000-000000000f02', null, 'x')$$, 'inquiry_declined', 'a declined inquiry cannot be accepted');
select pg_temp.expect_error($$select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-0000000000f0')$$, 'review_not_available', 'no review access after decline');

-- manual revocation is honoured
select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-0000000000f0');
select pg_temp.as_trusted();
update public.lawyer_inquiry_reviews set revoked_at = now(), ended_reason = 'revoked'
 where inquiry_id = '11111111-1111-0000-0000-000000000004';
select pg_temp.as_service();
select pg_temp.expect_error($$select public.open_lawyer_inquiry_review('11111111-1111-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-0000000000f0')$$, 'review_access_revoked', 'revoked review blocks new previews');

-- ---------------------------------------------------------------------------
-- 7. Status integrity
-- ---------------------------------------------------------------------------
select pg_temp.as_trusted();
select pg_temp.expect_error($$update public.lawyer_inquiries set case_id = (select id from public.cases limit 1) where id = '11111111-1111-0000-0000-000000000003'$$, 'lawyer_inquiries_decision_consistent', 'a declined inquiry cannot point at a case');
select pg_temp.expect_error($$update public.lawyer_inquiries set decision = 'accepted' where id = '11111111-1111-0000-0000-000000000004'$$, 'lawyer_inquiries_decision_consistent', 'pending inquiry cannot carry a decision');

rollback;
select 'lawyer_inquiry_pre_acceptance_review: all assertions passed' as result;
