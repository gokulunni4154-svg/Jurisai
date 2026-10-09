-- P2-02: shared (cross-instance) fixed-window rate-limit counters.
--
-- NOT APPLIED to any database by this change. Review, then apply through the
-- normal migration process. Until it is applied, POST /api/analysis/anonymous
-- FAILS CLOSED (HTTP 503) because the limiter cannot run.
--
-- Access model: RLS enabled with no policies, and all privileges revoked
-- from anon/authenticated. Only the service-role key (server-side) can call
-- consume_rate_limit(); nothing here is reachable from browser code.

create table public.rate_limit_counters (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

-- Supports the opportunistic cleanup DELETE below (otherwise a seq scan).
create index rate_limit_counters_window_start_idx
  on public.rate_limit_counters (window_start);

alter table public.rate_limit_counters enable row level security;
revoke all on table public.rate_limit_counters from public, anon, authenticated;

create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_count integer;
  v_start timestamptz;
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 200
     or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit arguments';
  end if;

  -- Atomic upsert: a single statement, so concurrent callers serialize on
  -- the row and cannot both observe the same pre-increment count.
  insert into public.rate_limit_counters as c (key, window_start, count)
  values (p_key, v_now, 1)
  on conflict (key) do update
    set window_start = case
          when c.window_start + make_interval(secs => p_window_seconds) <= v_now
            then v_now else c.window_start end,
        count = case
          when c.window_start + make_interval(secs => p_window_seconds) <= v_now
            then 1 else c.count + 1 end
  returning c.count, c.window_start into v_count, v_start;

  -- Opportunistic cleanup of long-dead counters (no cron is wired yet).
  if random() < 0.01 then
    delete from public.rate_limit_counters where window_start < v_now - interval '2 days';
  end if;

  allowed := v_count <= p_limit;
  retry_after_seconds := greatest(
    1,
    ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - v_now)))::integer
  );
  return next;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
