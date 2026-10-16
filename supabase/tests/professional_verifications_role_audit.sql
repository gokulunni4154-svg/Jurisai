-- Read-only audit for professional_verifications (run against a local /
-- non-production DB, or a production DB ONLY via a read-only session you
-- have approved). Changes nothing.
--
-- Rows returned need ADMINISTRATIVE REVIEW: the migration
-- 20261016000000_harden_professional_verification_lifecycle.sql only
-- backfills role from auth.users.raw_app_meta_data->>'role' and refuses to
-- guess otherwise.

-- A. Rows still without a role (backfill could not establish one).
select pv.id, pv.profile_id, pv.status, pv.registration_number,
       u.raw_app_meta_data ->> 'role' as auth_role,
       (u.id is null) as auth_user_missing
from public.professional_verifications pv
left join auth.users u on u.id = pv.profile_id
where pv.role is null
order by pv.status, pv.created_at;

-- B. Rows whose mirrored role disagrees with the auth source of truth.
select pv.id, pv.profile_id, pv.status, pv.role as stored_role,
       u.raw_app_meta_data ->> 'role' as auth_role
from public.professional_verifications pv
join auth.users u on u.id = pv.profile_id
where pv.role is not null
  and pv.role is distinct from u.raw_app_meta_data ->> 'role';

-- C. Verified rows that the Find a Lawyer directory will NOT list, and why.
select pv.id, pv.profile_id, pv.role,
       case when pv.role is null then 'role missing'
            else 'role is ' || pv.role || ' (not lawyer)' end as reason
from public.professional_verifications pv
where pv.status = 'verified' and pv.role is distinct from 'lawyer';
