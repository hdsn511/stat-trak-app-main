-- Per-user SportQuery quota. Anonymous users: period 'lifetime'. Signed-in users: period 'YYYY-MM'.
-- The all-zero uuid with period 'YYYY-MM-DD' is the global daily spend cap.
create table if not exists sportquery_usage (
  user_id uuid not null,
  period text not null,
  count integer not null default 0,
  primary key (user_id, period)
);

alter table sportquery_usage enable row level security;
revoke all on sportquery_usage from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'sportquery_reader') then
    revoke all on sportquery_usage from sportquery_reader;
  end if;
end $$;

-- Atomically spends one query. allowed=false when the limit is already reached.
create or replace function sportquery_consume(p_user uuid, p_period text, p_limit integer)
returns table(allowed boolean, used integer)
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into sportquery_usage as u (user_id, period, count) values (p_user, p_period, 1)
  on conflict (user_id, period) do update set count = u.count + 1 where u.count < p_limit
  returning u.count into v;
  if v is null then
    select u.count into v from sportquery_usage u where u.user_id = p_user and u.period = p_period;
    return query select false, v;
    return;
  end if;
  return query select true, v;
end $$;

revoke all on function sportquery_consume(uuid, text, integer) from public, anon, authenticated;
