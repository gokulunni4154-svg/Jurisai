#!/usr/bin/env bash
# Concurrency check for accept_lawyer_inquiry / decline_lawyer_inquiry.
# A single SQL transaction cannot race itself, so this opens parallel psql
# sessions. It COMMITS fixtures, so run it ONLY against a LOCAL / scratch
# database that already has all migrations applied. Never against production.
#
#   LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
#     bash supabase/tests/lawyer_inquiry_concurrency.sh
set -euo pipefail
: "${LOCAL_DB_URL:?set LOCAL_DB_URL to a scratch database}"
case "$LOCAL_DB_URL" in *supabase.co*) echo "refusing to run against a hosted project"; exit 2;; esac
q() { psql "$LOCAL_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

U_CLIENT=cccccccc-1111-0000-0000-000000000001
U_LAW=cccccccc-1111-0000-0000-000000000002
FIRM=cccccccc-1111-0000-0000-0000000000f1
I_ACCEPT=cccccccc-1111-0000-0000-0000000000a1
I_RACE=cccccccc-1111-0000-0000-0000000000a2

cleanup() {
  q "delete from public.audit_log where firm_id = '$FIRM';
     delete from public.lawyer_inquiries where id in ('$I_ACCEPT','$I_RACE');
     delete from public.cases where firm_id = '$FIRM';
     delete from public.firm_members where firm_id = '$FIRM';
     delete from public.firms where id = '$FIRM';
     delete from public.profiles where id in ('$U_CLIENT','$U_LAW');
     delete from auth.users where id in ('$U_CLIENT','$U_LAW');" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

q "insert into auth.users (id, email) values ('$U_CLIENT','cc@t'), ('$U_LAW','cl@t');
   insert into public.profiles (id) values ('$U_CLIENT'), ('$U_LAW');
   insert into public.firms (id, name) values ('$FIRM', 'race firm');
   insert into public.firm_members (firm_id, profile_id, role) values ('$FIRM', '$U_LAW', 'owner');
   insert into public.lawyer_inquiries (id, client_profile_id, target_profile_id, target_firm_id, document_storage_path, analysis_result)
     values ('$I_ACCEPT','$U_CLIENT','$U_LAW','$FIRM','anon/t/x/a.pdf','{}'), ('$I_RACE','$U_CLIENT','$U_LAW','$FIRM','anon/t/y/b.pdf','{}');
   insert into public.lawyer_inquiry_documents (inquiry_id, storage_path, file_name, analysis_state, analysis_snapshot)
     values ('$I_ACCEPT','anon/t/x/a.pdf','a.pdf','complete','{}'), ('$I_RACE','anon/t/y/b.pdf','b.pdf','complete','{}');"

fail() { echo "FAIL: $1"; exit 1; }
tmp=$(mktemp -d)

# Race 1: 8 simultaneous accepts of the same inquiry.
for i in $(seq 1 8); do
  ( psql "$LOCAL_DB_URL" -X -q -At -c "set role service_role; select public.accept_lawyer_inquiry('$I_ACCEPT','$U_LAW',null,null,'Race $i');" >"$tmp/a$i" 2>&1 || true ) &
done
wait
cases=$(q "select count(*) from public.cases where firm_id = '$FIRM' and id = (select case_id from public.lawyer_inquiries where id = '$I_ACCEPT')")
total=$(q "select count(*) from public.cases where firm_id = '$FIRM'")
grants=$(q "select count(*) from public.case_access_grants where case_id = (select case_id from public.lawyer_inquiries where id = '$I_ACCEPT') and revoked_at is null")
fresh=$(grep -l '"already_accepted": false' "$tmp"/a* 2>/dev/null | wc -l | tr -d ' ')
replays=$(grep -l '"already_accepted": true' "$tmp"/a* 2>/dev/null | wc -l | tr -d ' ')
[ "$cases" = "1" ] || fail "expected the inquiry's case to exist once, got $cases"
[ "$total" = "1" ] || fail "expected exactly 1 case for the firm after 8 parallel accepts, got $total"
[ "$grants" = "1" ] || fail "expected exactly 1 active grant, got $grants"
[ "$fresh" = "1" ] || fail "expected exactly 1 session to create the case, got $fresh"
[ "$replays" = "7" ] || fail "expected 7 idempotent replays, got $replays"
echo "ok  8 parallel accepts -> 1 case, 1 grant, 7 replays"

# Race 2: 6 accepts racing 6 declines on one inquiry. Exactly one terminal state.
for i in $(seq 1 6); do
  ( psql "$LOCAL_DB_URL" -X -q -At -c "set role service_role; select public.accept_lawyer_inquiry('$I_RACE','$U_LAW',null,null,'Race B $i');" >"$tmp/b$i" 2>&1 || true ) &
  ( psql "$LOCAL_DB_URL" -X -q -At -c "set role service_role; select public.decline_lawyer_inquiry('$I_RACE','$U_LAW',null);" >"$tmp/d$i" 2>&1 || true ) &
done
wait
state=$(q "select status from public.lawyer_inquiries where id = '$I_RACE'")
case_id=$(q "select coalesce(case_id::text,'') from public.lawyer_inquiries where id = '$I_RACE'")
cases_b=$(q "select count(*) from public.cases where firm_id = '$FIRM' and title like 'Race B %'")
case "$state" in
  accepted) [ -n "$case_id" ] && [ "$cases_b" = "1" ] || fail "accepted but cases=$cases_b case_id=$case_id";;
  declined) [ -z "$case_id" ] && [ "$cases_b" = "0" ] || fail "declined but cases=$cases_b case_id=$case_id";;
  *) fail "unexpected terminal state $state";;
esac
echo "ok  accept/decline race -> $state, cases=$cases_b (no contradictory state)"
rm -rf "$tmp"
