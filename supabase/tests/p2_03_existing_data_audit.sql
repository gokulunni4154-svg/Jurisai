-- ============================================================================
-- P2-03 existing-data audit. READ-ONLY (SELECT only). Run against a database
-- you are allowed to inspect, as a role that bypasses RLS (e.g. the Supabase
-- SQL editor as postgres). The new migration only guards FUTURE writes; any
-- row returned here was created under the old, permissive policies and needs a
-- human decision (do NOT bulk-delete).
-- ============================================================================

-- 1. Active grants whose grantee is neither a member nor a client of the case's firm
select g.id as grant_id, g.case_id, g.grantee_id, g.granted_by, g.access_level, c.firm_id as case_firm
from public.case_access_grants g
join public.cases c on c.id = g.case_id
where g.revoked_at is null
  and not exists (select 1 from public.firm_members fm where fm.firm_id = c.firm_id and fm.profile_id = g.grantee_id)
  and not exists (select 1 from public.clients cl where cl.firm_id = c.firm_id and cl.profile_id = g.grantee_id);

-- 2. Active grants issued by someone with no authority over the case
select g.id as grant_id, g.case_id, g.granted_by
from public.case_access_grants g
join public.cases c on c.id = g.case_id
where g.revoked_at is null
  and c.owner_id <> g.granted_by
  and not exists (select 1 from public.firm_members fm where fm.firm_id = c.firm_id and fm.profile_id = g.granted_by and fm.role in ('owner','admin'))
  and not (c.team_id is not null and exists (select 1 from public.team_members tm where tm.team_id = c.team_id and tm.profile_id = g.granted_by and tm.role = 'lead'));

-- 3. Documents attached to a case by someone other than the document owner,
--    where the owner is not a member of the case's firm (cross-firm attachment)
select cd.case_id, cd.document_id, d.owner_id as document_owner, c.firm_id as case_firm
from public.case_documents cd
join public.documents d on d.id = cd.document_id
join public.cases c on c.id = cd.case_id
where not exists (select 1 from public.firm_members fm where fm.firm_id = c.firm_id and fm.profile_id = d.owner_id);

-- 4. Cases that are not internally consistent with their firm
select c.id as case_id, c.firm_id, 'team in another firm' as problem
from public.cases c join public.teams t on t.id = c.team_id where t.firm_id <> c.firm_id
union all
select c.id, c.firm_id, 'client in another firm'
from public.cases c join public.clients cl on cl.id = c.client_id where cl.firm_id <> c.firm_id
union all
select c.id, c.firm_id, 'owner is not a member of the case firm'
from public.cases c
where not exists (select 1 from public.firm_members fm where fm.firm_id = c.firm_id and fm.profile_id = c.owner_id);

-- 5. Hearings / tasks whose denormalised firm_id differs from their case's firm
select 'hearing' as kind, h.id, h.case_id, h.firm_id as row_firm, c.firm_id as case_firm
from public.hearings h join public.cases c on c.id = h.case_id where h.firm_id <> c.firm_id
union all
select 'task', t.id, t.case_id, t.firm_id, c.firm_id
from public.tasks t join public.cases c on c.id = t.case_id where t.firm_id <> c.firm_id;

-- 6. Tasks assigned to someone outside the task's firm
select t.id as task_id, t.firm_id, t.assignee_profile_id
from public.tasks t
where t.assignee_profile_id is not null
  and not exists (select 1 from public.firm_members fm where fm.firm_id = t.firm_id and fm.profile_id = t.assignee_profile_id)
  and not exists (select 1 from public.clients cl where cl.firm_id = t.firm_id and cl.profile_id = t.assignee_profile_id);

-- 7. profiles.firm_id pointing at a firm the profile does not belong to
select p.id as profile_id, p.firm_id
from public.profiles p
where p.firm_id is not null
  and not exists (select 1 from public.firm_members fm where fm.firm_id = p.firm_id and fm.profile_id = p.id);

-- 8. Documents whose storage_path is not inside the owner's folder
select d.id as document_id, d.owner_id, d.storage_path
from public.documents d
where split_part(d.storage_path, '/', 1) <> d.owner_id::text;

-- 9. Case notes by an author who is not owner, grantee or firm manager of the case
select n.id as note_id, n.case_id, n.author_id
from public.case_notes n join public.cases c on c.id = n.case_id
where c.owner_id <> n.author_id
  and not exists (select 1 from public.case_access_grants g where g.case_id = n.case_id and g.grantee_id = n.author_id)
  and not exists (select 1 from public.firm_members fm where fm.firm_id = c.firm_id and fm.profile_id = n.author_id and fm.role in ('owner','admin'));

-- 10. Verify which policies / helper privileges are ACTUALLY live (do this FIRST:
--     the repo's migration history does not replay to the live schema).
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where tablename in ('cases','case_documents','case_access_grants','documents','hearings','tasks','case_notes','profiles','firm_members','clients')
order by tablename, policyname;

select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer,
       p.proconfig as config, has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('is_case_owner','has_case_grant','is_firm_case_manager','is_case_client');
